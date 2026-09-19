import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CALIBRATION_UNITS,
  ELEMENT_KINDS,
  MEASUREMENT_SOURCES,
  createElement,
  deleteElement,
  errorMessage,
  fetchPhotoBlob,
  listElements,
  saveMeasurements,
  setConference,
  updateElement,
  type CalibrationUnit,
  type ElementBox,
  type ElementKind,
  type Measurement,
  type MeasurementSource,
  type MeasurementsInput,
  type Photo,
  type SurveyElement,
} from '../api/client'
import SpecPicker from './SpecPicker'
import { Button, EmptyState, ErrorNotice, Field, Loading, inputClass } from '../components/ui'
import { useResource } from '../hooks/useResource'

/**
 * Elementos do levantamento — as peças a intervir marcadas sobre a foto
 * **original**, com medidas e conferência.
 *
 * O retângulo é desenhado num `<svg>` por cima de um `<img>`, com `viewBox` no
 * tamanho natural da foto: cada coordenada já nasce em pixel do original, igual
 * à calibração. Nada é escrito no arquivo — elemento é registro à parte.
 *
 * **Medida é informação humana.** Todo valor sai de um campo digitado e vai
 * acompanhado da origem que o usuário escolheu (medido em campo ou estimativa).
 * A sugestão pela escala que o servidor devolve entra no formulário já travada
 * em "estimativa": não existe caminho nesta tela que transforme número derivado
 * em medida de campo.
 */

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Vírgula é como se digita medida em português; o campo aceita as duas formas. */
function parseMeasurement(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

function toInput(value: number): string {
  return String(value).replace('.', ',')
}

/** Lado mínimo do retângulo, em pixels do original. Mesmo mínimo do servidor. */
const MIN_SIDE = 4

/** Folga de tela, em pixels: abaixo disso o ponteiro clicou, não arrastou. */
const CLICK_SLOP = 4

const DIMENSIONS = [
  { key: 'width', label: 'Largura' },
  { key: 'height', label: 'Altura' },
  { key: 'depth', label: 'Profundidade' },
] as const

type DimensionKey = (typeof DIMENSIONS)[number]['key']

/** Uma dimensão no formulário: o que foi digitado e a origem declarada. */
type DimensionDraft = { value: string; source: MeasurementSource }

type MeasurementDraft = { unit: CalibrationUnit } & Record<DimensionKey, DimensionDraft>

function emptyDraft(unit: CalibrationUnit = 'm'): MeasurementDraft {
  return {
    unit,
    width: { value: '', source: 'user_measured' },
    height: { value: '', source: 'user_measured' },
    depth: { value: '', source: 'user_measured' },
  }
}

function draftFrom(element: SurveyElement): MeasurementDraft {
  const unit = (element.measurements.unit as CalibrationUnit | null) ?? 'm'
  const draft = emptyDraft(unit)
  for (const { key } of DIMENSIONS) {
    const saved = element.measurements[key]
    if (saved) draft[key] = { value: toInput(saved.value), source: saved.source }
  }
  return draft
}

// ---------------------------------------------------------------------------

/** Valor + origem, sempre juntos. Estimativa nunca aparece sem o rótulo. */
function MeasurementLine({ label, measurement, unit }: {
  label: string
  measurement: Measurement
  unit: string | null
}) {
  const estimated = measurement.source === 'estimated'
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-neutral-200">
          {numberFormat.format(measurement.value)} {unit}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] ${
            estimated
              ? 'border-amber-700/70 bg-amber-950/40 text-amber-200'
              : 'border-neutral-700 text-neutral-400'
          }`}
        >
          {measurement.source_label}
        </span>
      </span>
    </div>
  )
}

function ConferenceBadge({ status }: { status: SurveyElement['conference']['status'] }) {
  const confirmed = status === 'conferido'
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] ${
        confirmed
          ? 'border-neutral-500 text-neutral-200'
          : 'border-dashed border-neutral-700 text-neutral-500'
      }`}
    >
      {confirmed ? 'Conferido' : 'Pendente'}
    </span>
  )
}

// ---------------------------------------------------------------------------

function Overlay({
  url,
  elements,
  selectedId,
  drawing,
  pending,
  onSelect,
  onDrawn,
}: {
  url: string
  elements: SurveyElement[]
  selectedId: string | null
  drawing: boolean
  pending: ElementBox | null
  onSelect: (id: string) => void
  onDrawn: (box: ElementBox) => void
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  // Pixels do original por pixel de tela: mantém traço e rótulo do mesmo
  // tamanho visual numa foto de 4032 px e numa de 640 px.
  const [scale, setScale] = useState(1)
  // Primeiro canto do retângulo. Vale para as duas formas de marcar: arrastar
  // (o canto é onde o arrasto começou) ou clicar canto a canto, como já se faz
  // na calibração — em foto grande, clicar dois cantos erra menos que arrastar.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const measure = useCallback(() => {
    const image = imageRef.current
    if (!image || !image.naturalWidth) return
    setNatural({ width: image.naturalWidth, height: image.naturalHeight })
    const rect = image.getBoundingClientRect()
    if (rect.width > 0) setScale(image.naturalWidth / rect.width)
  }, [])

  useEffect(() => {
    const image = imageRef.current
    if (!image) return
    if (image.complete) measure()
    const observer = new ResizeObserver(measure)
    observer.observe(image)
    return () => observer.disconnect()
  }, [measure, url])

  /** Converte a posição do ponteiro em coordenada de pixel do original. */
  function toOriginal(event: React.PointerEvent): { x: number; y: number } | null {
    const image = imageRef.current
    if (!image || !natural) return null
    const rect = image.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const x = ((event.clientX - rect.left) / rect.width) * natural.width
    const y = ((event.clientY - rect.top) / rect.height) * natural.height
    // Clamp: arrasto que sai da foto vira coordenada de borda, não coordenada
    // fora da imagem — o servidor recusaria, e com razão.
    return {
      x: Math.min(Math.max(x, 0), natural.width),
      y: Math.min(Math.max(y, 0), natural.height),
    }
  }

  function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): ElementBox {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    }
  }

  /** Encerra a marcação. Retângulo menor que um clique torto é descartado. */
  function finish(box: ElementBox) {
    setAnchor(null)
    setCursor(null)
    setDragging(false)
    if (box.width >= MIN_SIDE && box.height >= MIN_SIDE) onDrawn(box)
  }

  // Sair do modo marcação descarta o canto que ficou pendente. Ajuste durante
  // a renderização (e não num efeito): a mudança já chegou por props, e um
  // efeito só provocaria uma renderização a mais.
  const [drawingWas, setDrawingWas] = useState(drawing)
  if (drawingWas !== drawing) {
    setDrawingWas(drawing)
    if (!drawing) {
      setAnchor(null)
      setCursor(null)
      setDragging(false)
    }
  }

  const live = anchor && cursor ? boxBetween(anchor, cursor) : null
  const ghost = live ?? pending

  return (
    <div className="relative select-none overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <img
        ref={imageRef}
        src={url}
        alt="Foto original do levantamento"
        onLoad={measure}
        draggable={false}
        className="block h-auto max-h-[62vh] w-full object-contain"
      />

      {natural && (
        <svg
          viewBox={`0 0 ${natural.width} ${natural.height}`}
          preserveAspectRatio="xMidYMid meet"
          // A superfície de desenho é o controle principal desta tela: sem
          // role e nome ela não existe para leitor de tela nem aparece na
          // árvore de acessibilidade.
          role="application"
          aria-label={
            drawing
              ? 'Foto original: arraste ou clique nos dois cantos para marcar o elemento'
              : 'Foto original com os elementos marcados'
          }
          className={`absolute inset-0 h-full w-full ${drawing ? 'cursor-crosshair' : ''}`}
          onPointerDown={(event) => {
            // Com um canto já marcado por clique, quem fecha o retângulo é o
            // pointerup do segundo clique — aqui não se faz nada.
            if (!drawing || anchor) return
            const point = toOriginal(event)
            if (!point) return
            event.currentTarget.setPointerCapture?.(event.pointerId)
            setAnchor(point)
            setCursor(point)
            setDragging(true)
          }}
          onPointerMove={(event) => {
            if (!anchor) return
            const point = toOriginal(event)
            if (point) setCursor(point)
          }}
          onPointerUp={(event) => {
            if (!anchor) return
            const point = toOriginal(event) ?? cursor
            if (!point) return
            const box = boxBetween(anchor, point)
            // Soltar praticamente onde apertou não é arrasto: foi o primeiro
            // clique. O canto fica marcado esperando o segundo.
            if (dragging && box.width < CLICK_SLOP * scale && box.height < CLICK_SLOP * scale) {
              setDragging(false)
              setCursor(point)
              return
            }
            finish(box)
          }}
        >
          {elements.map((element, index) => {
            const selected = element.id === selectedId
            const confirmed = element.conference.status === 'conferido'
            return (
              <g
                key={element.id}
                onPointerDown={(event) => {
                  if (drawing) return
                  event.stopPropagation()
                  onSelect(element.id)
                }}
                className={drawing ? '' : 'cursor-pointer'}
              >
                <rect
                  x={element.box.x}
                  y={element.box.y}
                  width={element.box.width}
                  height={element.box.height}
                  fill={selected ? '#fafafa14' : 'transparent'}
                  stroke="#0a0a0a"
                  strokeWidth={5 * scale}
                  opacity={0.55}
                />
                <rect
                  x={element.box.x}
                  y={element.box.y}
                  width={element.box.width}
                  height={element.box.height}
                  fill="none"
                  stroke={selected ? '#fafafa' : '#d4d4d4'}
                  strokeWidth={2 * scale}
                  strokeDasharray={confirmed ? undefined : `${8 * scale} ${6 * scale}`}
                />
                <text
                  x={element.box.x + 6 * scale}
                  y={element.box.y - 8 * scale}
                  fontSize={14 * scale}
                  fill="#fafafa"
                  stroke="#0a0a0a"
                  strokeWidth={3 * scale}
                  paintOrder="stroke"
                  className="font-medium select-none"
                >
                  {index + 1}. {element.name}
                </text>
              </g>
            )
          })}

          {ghost && (
            <rect
              x={ghost.x}
              y={ghost.y}
              width={ghost.width}
              height={ghost.height}
              fill="#fafafa14"
              stroke="#fafafa"
              strokeWidth={2 * scale}
              strokeDasharray={`${10 * scale} ${6 * scale}`}
            />
          )}
        </svg>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function NewElementForm({
  box,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  box: ElementBox
  saving: boolean
  error: string | null
  onSubmit: (input: { name: string; kind: ElementKind; notes: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ElementKind>('placa')
  const [notes, setNotes] = useState('')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!saving) onSubmit({ name, kind, notes })
      }}
      className="flex flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <div>
        <p className="text-sm font-medium text-neutral-100">Novo elemento</p>
        <p className="mt-1 font-mono text-xs text-neutral-500">
          {Math.round(box.width)} × {Math.round(box.height)} px em{' '}
          {Math.round(box.x)}, {Math.round(box.y)}
        </p>
      </div>

      <Field label="Nome" htmlFor="element-name" required hint="Ex.: letreiro da fachada.">
        <input
          id="element-name"
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Letreiro principal"
          maxLength={160}
          required
          autoFocus
        />
      </Field>

      <Field label="Tipo" htmlFor="element-kind">
        <select
          id="element-kind"
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as ElementKind)}
        >
          {ELEMENT_KINDS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Observações" htmlFor="element-notes">
        <textarea
          id="element-notes"
          className={inputClass}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          maxLength={2000}
        />
      </Field>

      {error && <ErrorNotice message={error} />}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Criando…' : 'Criar elemento'}
        </Button>
        <Button variant="ghost" type="button" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>

      <p className="text-xs text-neutral-600">
        Medidas entram no passo seguinte. Elemento nasce sem medida — ninguém mediu ainda.
      </p>
    </form>
  )
}

// ---------------------------------------------------------------------------

function ElementDetail({
  element,
  onChanged,
  onRemoved,
}: {
  element: SurveyElement
  onChanged: (element: SurveyElement) => void
  onRemoved: (id: string) => void
}) {
  const [draft, setDraft] = useState<MeasurementDraft>(() => draftFrom(element))
  const [draftFor, setDraftFor] = useState(element.id)
  const [busy, setBusy] = useState<'measure' | 'conference' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Trocar de elemento recarrega o formulário. Ajuste na renderização (e não
  // num efeito) para não renderizar uma vez com a medida do elemento anterior.
  if (draftFor !== element.id) {
    setDraftFor(element.id)
    setDraft(draftFrom(element))
    setError(null)
  }

  const estimate = element.scale_estimate
  const measured = element.measurements
  const hasSaved = Boolean(measured.width || measured.height || measured.depth)

  function setDimension(key: DimensionKey, patch: Partial<DimensionDraft>) {
    setError(null)
    setDraft((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  }

  /** Preenche o formulário com a sugestão da escala — travada em estimativa. */
  function useEstimate() {
    if (!estimate) return
    setError(null)
    setDraft((current) => ({
      ...current,
      unit: estimate.unit as CalibrationUnit,
      width: { value: toInput(estimate.width), source: 'estimated' },
      height: { value: toInput(estimate.height), source: 'estimated' },
    }))
  }

  const parsed = DIMENSIONS.map(({ key }) => ({ key, value: parseMeasurement(draft[key].value) }))
  const anyTyped = DIMENSIONS.some(({ key }) => draft[key].value.trim() !== '')
  const anyInvalid = DIMENSIONS.some(
    ({ key }) => draft[key].value.trim() !== '' && parseMeasurement(draft[key].value) === null,
  )
  const canSave = parsed.some((item) => item.value !== null) && !anyInvalid

  async function submitMeasurements(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave || busy) return
    setBusy('measure')
    setError(null)
    try {
      const input: MeasurementsInput = { unit: draft.unit }
      for (const { key, value } of parsed) {
        if (value !== null) input[key] = { value, source: draft[key].source }
      }
      onChanged(await saveMeasurements(element.id, input))
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível salvar as medidas.'))
    } finally {
      setBusy(null)
    }
  }

  async function toggleConference() {
    if (busy) return
    setBusy('conference')
    setError(null)
    const next = element.conference.status === 'conferido' ? 'pendente' : 'conferido'
    try {
      onChanged(await setConference(element.id, next))
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível mudar a conferência.'))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy) return
    setBusy('remove')
    setError(null)
    try {
      await deleteElement(element.id)
      onRemoved(element.id)
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível remover o elemento.'))
      setBusy(null)
    }
  }

  async function changeKind(kind: ElementKind) {
    setError(null)
    try {
      onChanged(await updateElement(element.id, { kind }))
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível mudar o tipo.'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-100">{element.name}</p>
            <p className="font-mono text-[10px] text-neutral-600">
              {Math.round(element.box.width)} × {Math.round(element.box.height)} px
            </p>
          </div>
          <ConferenceBadge status={element.conference.status} />
        </div>

        <div className="mt-3">
          <label htmlFor="detail-kind" className="text-xs text-neutral-500">
            Tipo
          </label>
          <select
            id="detail-kind"
            className={`${inputClass} mt-1`}
            value={element.kind}
            onChange={(event) => void changeKind(event.target.value as ElementKind)}
          >
            {ELEMENT_KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {element.notes && <p className="mt-3 text-xs text-neutral-400">{element.notes}</p>}

        <div className="mt-3 border-t border-neutral-800 pt-3">
          {hasSaved ? (
            <div className="flex flex-col gap-1.5">
              {DIMENSIONS.map(({ key, label }) => {
                const saved = measured[key]
                return saved ? (
                  <MeasurementLine
                    key={key}
                    label={label}
                    measurement={saved}
                    unit={measured.unit}
                  />
                ) : null
              })}
              {measured.measured_at && (
                <p className="mt-1 text-[10px] text-neutral-600">
                  Medidas salvas em {dateTimeFormat.format(new Date(measured.measured_at))}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              Sem medida. O elemento está marcado na foto, mas ninguém mediu ainda.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
        <p className="mb-3 text-sm text-neutral-300">Especificação</p>
        <SpecPicker element={element} onChanged={onChanged} />
      </div>

      <form onSubmit={submitMeasurements} className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <p className="text-sm text-neutral-300">Medidas</p>
          <select
            aria-label="Unidade das medidas"
            className={`${inputClass} w-32`}
            value={draft.unit}
            onChange={(event) =>
              setDraft((current) => ({ ...current, unit: event.target.value as CalibrationUnit }))
            }
          >
            {CALIBRATION_UNITS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {DIMENSIONS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={`measure-${key}`} className="text-xs text-neutral-400">
              {label}
            </label>
            <div className="flex gap-2">
              <input
                id={`measure-${key}`}
                className={inputClass}
                value={draft[key].value}
                onChange={(event) => setDimension(key, { value: event.target.value })}
                inputMode="decimal"
                placeholder="—"
              />
              {/* Origem obrigatória ao lado do valor: não existe campo de medida
                  nesta tela sem o seletor de procedência colado nele. */}
              <select
                aria-label={`Origem da medida de ${label.toLowerCase()}`}
                className={`${inputClass} w-44 ${
                  draft[key].source === 'estimated' ? 'border-amber-800 text-amber-200' : ''
                }`}
                value={draft[key].source}
                onChange={(event) =>
                  setDimension(key, { source: event.target.value as MeasurementSource })
                }
              >
                {MEASUREMENT_SOURCES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}

        {anyInvalid && <p className="text-xs text-red-300">Informe números maiores que zero.</p>}
        {!anyTyped && (
          <p className="text-xs text-neutral-600">
            Deixe em branco o que não foi medido — campo vazio não vira zero.
          </p>
        )}

        {/* A sugestão pela escala só existe se a foto estiver calibrada, e entra
            no formulário sempre como estimativa. */}
        {estimate ? (
          <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-3">
            <p className="text-xs text-amber-200">
              Estimativa pela escala: {numberFormat.format(estimate.width)} ×{' '}
              {numberFormat.format(estimate.height)} {estimate.unit}
            </p>
            <p className="mt-1 text-[10px] text-amber-200/70">
              Derivada do retângulo e da calibração da foto. É aproximação: salva assim, fica
              marcada como estimativa.
            </p>
            <Button
              variant="ghost"
              type="button"
              className="mt-2"
              onClick={useEstimate}
              disabled={busy !== null}
            >
              Usar como estimativa
            </Button>
          </div>
        ) : (
          <p className="text-xs text-neutral-600">
            Foto sem calibração de escala: não há de onde estimar. Calibre a foto ou digite a
            medida de campo.
          </p>
        )}

        {error && <ErrorNotice message={error} />}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!canSave || busy !== null}>
            {busy === 'measure' ? 'Salvando…' : 'Salvar medidas'}
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => void toggleConference()}
            disabled={busy !== null}
          >
            {busy === 'conference'
              ? 'Salvando…'
              : element.conference.status === 'conferido'
                ? 'Voltar para pendente'
                : 'Marcar conferido'}
          </Button>
        </div>

        <p className="text-xs text-neutral-600">
          Salvar medida devolve a conferência para pendente — o selo vale para os números que
          foram conferidos.
        </p>

        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy !== null}
          className="w-fit text-xs text-neutral-500 transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'remove' ? 'Removendo…' : 'Remover elemento'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function ElementsDialog({
  photo,
  onClose,
  onCountChange,
}: {
  photo: Photo
  onClose: () => void
  onCountChange?: (total: number) => void
}) {
  const load = useCallback(() => listElements(photo.id), [photo.id])
  const { resource, reload, patch } = useResource(
    load,
    'Não foi possível carregar os elementos desta foto.',
  )

  // O binário original: a rota exige token, e `<img src>` não manda header.
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [pending, setPending] = useState<ElementBox | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob = await fetchPhotoBlob(photo.id)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
      } catch (caught) {
        if (alive) setImageError(errorMessage(caught, 'Não foi possível carregar a foto original.'))
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const elements = resource.kind === 'ready' ? resource.data : []
  const selected = elements.find((item) => item.id === selectedId) ?? null

  function replace(updated: SurveyElement) {
    patch((current) => current.map((item) => (item.id === updated.id ? updated : item)))
  }

  function drop(id: string) {
    patch((current) => {
      const next = current.filter((item) => item.id !== id)
      onCountChange?.(next.length)
      return next
    })
    setSelectedId(null)
  }

  async function submitNew(input: { name: string; kind: ElementKind; notes: string }) {
    if (!pending || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createElement(photo.id, {
        name: input.name,
        kind: input.kind,
        notes: input.notes,
        box: pending,
      })
      patch((current) => {
        const next = [...current, created]
        onCountChange?.(next.length)
        return next
      })
      setPending(null)
      setDrawing(false)
      setSelectedId(created.id)
    } catch (caught) {
      setCreateError(errorMessage(caught, 'Não foi possível criar o elemento.'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Elementos de ${photo.original_filename}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-5xl rounded-xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-100">Elementos e medidas</h2>
            <p className="truncate text-sm text-neutral-500" title={photo.original_filename}>
              {photo.original_filename}
            </p>
          </div>
          <Button variant="ghost" type="button" onClick={onClose}>
            Fechar
          </Button>
        </header>

        {resource.kind === 'loading' && <Loading label="Carregando elementos…" />}
        {resource.kind === 'error' && (
          <div className="mt-4">
            <ErrorNotice message={resource.message} onRetry={reload} />
          </div>
        )}

        {resource.kind === 'ready' && (
          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col gap-3">
              {imageError && <ErrorNotice message={imageError} />}
              {!imageError && !imageUrl && <Loading label="Carregando foto original…" />}
              {imageUrl && (
                <Overlay
                  url={imageUrl}
                  elements={elements}
                  selectedId={selectedId}
                  drawing={drawing}
                  pending={pending}
                  onSelect={setSelectedId}
                  onDrawn={(box) => {
                    setPending(box)
                    setCreateError(null)
                  }}
                />
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant={drawing ? 'ghost' : 'primary'}
                  onClick={() => {
                    setDrawing((current) => !current)
                    setPending(null)
                    setCreateError(null)
                  }}
                >
                  {drawing ? 'Sair do modo marcação' : 'Marcar elemento'}
                </Button>
                <p className="text-xs text-neutral-500">
                  {drawing
                    ? 'Arraste sobre a peça — ou clique num canto e depois no outro.'
                    : 'Clique num retângulo para abrir o elemento.'}
                </p>
              </div>

              <p className="text-xs text-neutral-600">
                A foto original não é alterada: os retângulos são um overlay e ficam salvos como
                registros à parte.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {pending ? (
                <NewElementForm
                  box={pending}
                  saving={creating}
                  error={createError}
                  onSubmit={(input) => void submitNew(input)}
                  onCancel={() => {
                    setPending(null)
                    setCreateError(null)
                  }}
                />
              ) : selected ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="w-fit text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-100 hover:underline"
                  >
                    ← Todos os elementos
                  </button>
                  <ElementDetail element={selected} onChanged={replace} onRemoved={drop} />
                </>
              ) : elements.length === 0 ? (
                <EmptyState
                  title="Nenhum elemento marcado"
                  description="Marque na foto as peças a intervir (placa, faixa, letra caixa). Depois é só medir cada uma e conferir."
                  action={
                    <Button type="button" onClick={() => setDrawing(true)}>
                      Marcar primeiro elemento
                    </Button>
                  }
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {elements.map((element, index) => (
                    <li key={element.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(element.id)}
                        className="w-full rounded-md border border-neutral-800 px-3 py-2.5 text-left transition hover:border-neutral-600"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm text-neutral-100">
                            {index + 1}. {element.name}
                          </span>
                          <ConferenceBadge status={element.conference.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                          <span>{element.kind_label}</span>
                          {element.measurements.width || element.measurements.height ? (
                            <span className="font-mono text-neutral-300">
                              {element.measurements.width
                                ? numberFormat.format(element.measurements.width.value)
                                : '—'}{' '}
                              ×{' '}
                              {element.measurements.height
                                ? numberFormat.format(element.measurements.height.value)
                                : '—'}{' '}
                              {element.measurements.unit}
                            </span>
                          ) : (
                            <span>sem medida</span>
                          )}
                          {/* Estimativa rotulada já na lista: ninguém lê o número
                              achando que é medida de campo. */}
                          {element.measurements.has_estimate && (
                            <span className="rounded-full border border-amber-700/70 bg-amber-950/40 px-2 py-0.5 text-[10px] text-amber-200">
                              Estimativa
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
