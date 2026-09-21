import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CALIBRATION_UNITS,
  errorMessage,
  fetchPhotoBlob,
  getCalibration,
  saveCalibration,
  type Calibration,
  type CalibrationPoint,
  type CalibrationUnit,
  type Photo,
} from '../api/client'
import { Button, ErrorNotice, Field, Loading, inputClass } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { useFotoGeometria } from '../hooks/useFotoGeometria'

/**
 * Calibração de escala — dois pontos sobre a foto **original** e a medida real
 * entre eles, informada pelo usuário.
 *
 * O overlay é um `<svg>` por cima de um `<img>`; nada aqui desenha sobre o
 * arquivo. O `viewBox` do SVG é o tamanho natural da foto, então todo ponto já
 * nasce em coordenada de pixel do original — o que vai para a API é exatamente
 * o que o servidor validaria contra as dimensões do arquivo.
 *
 * **O fator de escala não é calculado aqui.** A tela mostra a distância em
 * pixels (que é geometria do clique) e só exibe `pixels_per_unit` depois que o
 * servidor devolve. E `real_length` só existe se o usuário digitar: não há
 * sugestão automática, valor padrão, chute a partir da foto ou herança de outra
 * calibração. Medida é informação humana — a regra vale no projeto inteiro.
 */

type PointName = 'a' | 'b'

/** Vírgula é como se digita medida em português; o input aceita as duas formas. */
function parseMeasurement(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function distanceOf(a: CalibrationPoint, b: CalibrationPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// ---------------------------------------------------------------------------

function Marker({
  name,
  point,
  scale,
  active,
  onGrab,
  onNudge,
}: {
  name: PointName
  point: CalibrationPoint
  /** Pixels do original por pixel de tela: mantém o marcador do mesmo tamanho
   *  visual numa foto de 4032 px e numa de 640 px. */
  scale: number
  active: boolean
  onGrab: (event: React.PointerEvent) => void
  onNudge: (dx: number, dy: number) => void
}) {
  const label = name.toUpperCase()
  return (
    <g
      tabIndex={0}
      role="application"
      aria-label={`Ponto ${label} em ${Math.round(point.x)}, ${Math.round(point.y)} pixels. Use as setas para ajustar.`}
      onPointerDown={onGrab}
      onKeyDown={(event) => {
        // Ajuste fino: no zoom da tela um pixel do original pode ser menos de
        // um pixel de mouse, e o clique sozinho não chega lá.
        const step = event.shiftKey ? 10 : 1
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }
        const move = moves[event.key]
        if (!move) return
        event.preventDefault()
        onNudge(move[0], move[1])
      }}
      className="cursor-grab outline-none focus-visible:opacity-80"
    >
      <circle
        cx={point.x}
        cy={point.y}
        r={11 * scale}
        fill="none"
        stroke="#0a0a0a"
        strokeWidth={5 * scale}
        opacity={0.55}
      />
      <circle
        cx={point.x}
        cy={point.y}
        r={11 * scale}
        fill="none"
        stroke={active ? '#fafafa' : '#d4d4d4'}
        strokeWidth={2 * scale}
      />
      <circle cx={point.x} cy={point.y} r={2 * scale} fill="#fafafa" />
      <text
        x={point.x + 16 * scale}
        y={point.y - 12 * scale}
        fontSize={14 * scale}
        fill="#fafafa"
        stroke="#0a0a0a"
        strokeWidth={3 * scale}
        paintOrder="stroke"
        className="font-medium select-none"
      >
        {label}
      </text>
    </g>
  )
}

// ---------------------------------------------------------------------------

function Overlay({
  url,
  points,
  onSet,
  onMove,
  disabled,
}: {
  url: string
  points: { a: CalibrationPoint | null; b: CalibrationPoint | null }
  onSet: (point: CalibrationPoint) => void
  onMove: (name: PointName, point: CalibrationPoint) => void
  disabled: boolean
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [dragging, setDragging] = useState<PointName | null>(null)
  // A conta que transforma clique em pixel da foto mora no hook: ela precisa
  // descontar a tarja que o `object-contain` cria, e errá-la é silencioso.
  const { natural, scale, medir, paraOriginal, paraOriginalPreso } = useFotoGeometria(imageRef)

  const both = points.a !== null && points.b !== null

  return (
    <div className="relative select-none overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <img
        ref={imageRef}
        src={url}
        alt="Foto original do levantamento"
        onLoad={medir}
        draggable={false}
        className="block h-auto max-h-[62vh] w-full object-contain"
      />

      {natural && (
        <svg
          viewBox={`0 0 ${natural.width} ${natural.height}`}
          preserveAspectRatio="xMidYMid meet"
          className={`absolute inset-0 h-full w-full ${
            disabled ? 'cursor-not-allowed' : both ? 'cursor-default' : 'cursor-crosshair'
          }`}
          onPointerDown={(event) => {
            if (disabled || dragging) return
            // Com os dois pontos já marcados, clicar não recomeça sozinho:
            // seria fácil perder uma calibração boa por um clique torto. Use
            // "Marcar de novo" ou arraste o marcador.
            if (both) return
            // Clique na tarja é clique fora da foto: não vira ponto.
            const point = paraOriginal(event.clientX, event.clientY)
            if (point) onSet(point)
          }}
          onPointerMove={(event) => {
            if (!dragging) return
            // Arrastando, sair da foto prende o marcador na borda em vez de
            // soltá-lo no meio do gesto.
            const point = paraOriginalPreso(event.clientX, event.clientY)
            if (point) onMove(dragging, point)
          }}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
        >
          {points.a && points.b && (
            <>
              <line
                x1={points.a.x}
                y1={points.a.y}
                x2={points.b.x}
                y2={points.b.y}
                stroke="#0a0a0a"
                strokeWidth={5 * scale}
                opacity={0.55}
              />
              <line
                x1={points.a.x}
                y1={points.a.y}
                x2={points.b.x}
                y2={points.b.y}
                stroke="#fafafa"
                strokeWidth={2 * scale}
              />
            </>
          )}

          {(['a', 'b'] as PointName[]).map((name) => {
            const point = points[name]
            if (!point) return null
            return (
              <Marker
                key={name}
                name={name}
                point={point}
                scale={scale}
                active={dragging === name}
                onGrab={(event) => {
                  if (disabled) return
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  setDragging(name)
                }}
                onNudge={(dx, dy) => {
                  if (disabled || !natural) return
                  onMove(name, {
                    x: Math.min(Math.max(point.x + dx, 0), natural.width),
                    y: Math.min(Math.max(point.y + dy, 0), natural.height),
                  })
                }}
              />
            )
          })}
        </svg>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function CalibrationDialog({
  photo,
  onClose,
  onSaved,
}: {
  photo: Photo
  onClose: () => void
  onSaved: (calibration: Calibration) => void
}) {
  const loadCalibration = useCallback(() => getCalibration(photo.id), [photo.id])
  const { resource, reload } = useResource(
    loadCalibration,
    'Não foi possível carregar a calibração desta foto.',
  )

  // O binário original: a rota exige token, e `<img src>` não manda header.
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [points, setPoints] = useState<{ a: CalibrationPoint | null; b: CalibrationPoint | null }>({
    a: null,
    b: null,
  })
  const [realLength, setRealLength] = useState('')
  const [unit, setUnit] = useState<CalibrationUnit>('m')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Calibration | null>(null)

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

  // Calibração existente hidrata a tela: reabrir mostra onde os pontos estavam
  // e qual medida foi informada, para conferir ou corrigir.
  //
  // Ajuste durante a renderização (e não num efeito): o dado já chegou, copiá-lo
  // num efeito só provocaria uma renderização extra. `hydratedFrom` guarda a
  // identidade da resposta, então um "tentar de novo" (resposta nova) hidrata de
  // novo e o salvamento (mesma resposta) não sobrescreve o que o usuário mexeu.
  const [hydratedFrom, setHydratedFrom] = useState<Calibration | null>(null)
  if (resource.kind === 'ready' && resource.data !== hydratedFrom) {
    const current = resource.data
    setHydratedFrom(current)
    setSaved(current.calibrated ? current : null)
    if (current.calibrated && current.point_a && current.point_b) {
      setPoints({ a: current.point_a, b: current.point_b })
      setRealLength(String(current.real_length ?? '').replace('.', ','))
      setUnit((current.unit as CalibrationUnit) ?? 'm')
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function setNextPoint(point: CalibrationPoint) {
    setSaveError(null)
    setPoints((current) =>
      current.a === null ? { ...current, a: point } : current.b === null ? { ...current, b: point } : current,
    )
  }

  function movePoint(name: PointName, point: CalibrationPoint) {
    setSaveError(null)
    setPoints((current) => ({ ...current, [name]: point }))
  }

  const measurement = parseMeasurement(realLength)
  const ready = points.a !== null && points.b !== null && measurement !== null
  const previewDistance = points.a && points.b ? distanceOf(points.a, points.b) : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!points.a || !points.b || measurement === null || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      // Vão só os pontos e a medida informada. O fator volta calculado do servidor.
      const result = await saveCalibration(photo.id, {
        point_a: points.a,
        point_b: points.b,
        real_length: measurement,
        unit,
      })
      setSaved(result)
      onSaved(result)
    } catch (caught) {
      setSaveError(errorMessage(caught, 'Não foi possível salvar a calibração.'))
    } finally {
      setSaving(false)
    }
  }

  const unitShort = CALIBRATION_UNITS.find((item) => item.value === unit)?.short ?? unit

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Calibrar escala de ${photo.original_filename}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-5xl rounded-xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-100">Calibrar escala</h2>
            <p className="truncate text-sm text-neutral-500" title={photo.original_filename}>
              {photo.original_filename}
            </p>
          </div>
          <Button variant="ghost" type="button" onClick={onClose}>
            Fechar
          </Button>
        </header>

        {resource.kind === 'loading' && <Loading label="Carregando calibração…" />}
        {resource.kind === 'error' && (
          <div className="mt-4">
            <ErrorNotice message={resource.message} onRetry={reload} />
          </div>
        )}

        {resource.kind === 'ready' && (
          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-3">
              {imageError && <ErrorNotice message={imageError} />}
              {!imageError && !imageUrl && <Loading label="Carregando foto original…" />}
              {imageUrl && (
                <Overlay
                  url={imageUrl}
                  points={points}
                  onSet={setNextPoint}
                  onMove={movePoint}
                  disabled={saving}
                />
              )}
              <p className="text-xs text-neutral-500">
                A foto original não é alterada: os pontos são um overlay e ficam salvos como um
                registro à parte.
              </p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              {/* Estado da foto: calibrada ou não. É o "vazio" desta fatia. */}
              {saved ? (
                <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
                  <p className="text-xs tracking-wide text-neutral-500 uppercase">Escala salva</p>
                  <p className="mt-1 text-sm text-neutral-100">
                    {numberFormat.format(saved.pixels_per_unit ?? 0)} px por {saved.unit}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {numberFormat.format(saved.pixel_distance ?? 0)} px ={' '}
                    {numberFormat.format(saved.real_length ?? 0)} {saved.unit} · medida informada
                    pelo usuário
                  </p>
                  {saved.updated_at && (
                    <p className="mt-1 text-xs text-neutral-600">
                      Atualizada em {dateTimeFormat.format(new Date(saved.updated_at))}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-neutral-800 p-3">
                  <p className="text-sm text-neutral-300">Foto não calibrada</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Sem escala, as medidas das próximas fases só podem sair como estimativa — e
                    aparecem rotuladas como tal.
                  </p>
                </div>
              )}

              {/* Passo a passo só enquanto não há escala salva: depois de calibrada
                  a lista inteira fica riscada e vira ruído na tela. */}
              {!saved && (
                <ol className="space-y-1 text-xs text-neutral-500">
                  <li className={points.a ? 'text-neutral-600 line-through' : 'text-neutral-300'}>
                    1. Clique no primeiro ponto (A).
                  </li>
                  <li className={points.b ? 'text-neutral-600 line-through' : 'text-neutral-300'}>
                    2. Clique no segundo ponto (B).
                  </li>
                  <li className={ready ? 'text-neutral-600 line-through' : 'text-neutral-300'}>
                    3. Informe quanto mede, no mundo real, a distância entre eles.
                  </li>
                </ol>
              )}

              <div className="rounded-md border border-neutral-800 px-3 py-2 text-xs text-neutral-400">
                <div className="flex justify-between gap-3">
                  <span>Ponto A</span>
                  <span className="font-mono text-neutral-300">
                    {points.a ? `${Math.round(points.a.x)}, ${Math.round(points.a.y)}` : '—'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span>Ponto B</span>
                  <span className="font-mono text-neutral-300">
                    {points.b ? `${Math.round(points.b.x)}, ${Math.round(points.b.y)}` : '—'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span>Distância na foto</span>
                  <span className="font-mono text-neutral-300">
                    {previewDistance === null ? '—' : `${numberFormat.format(previewDistance)} px`}
                  </span>
                </div>
              </div>

              <Field
                label="Medida real entre A e B"
                htmlFor="calibration-length"
                required
                hint="Só o que você mediu em campo. O sistema não estima esta medida."
              >
                <div className="flex gap-2">
                  <input
                    id="calibration-length"
                    className={inputClass}
                    value={realLength}
                    onChange={(event) => {
                      setRealLength(event.target.value)
                      setSaveError(null)
                    }}
                    inputMode="decimal"
                    placeholder="2,00"
                    disabled={saving}
                    required
                  />
                  <select
                    aria-label="Unidade da medida"
                    className={`${inputClass} w-32`}
                    value={unit}
                    onChange={(event) => setUnit(event.target.value as CalibrationUnit)}
                    disabled={saving}
                  >
                    {CALIBRATION_UNITS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>

              {realLength.trim() && measurement === null && (
                <p className="text-xs text-red-300">Informe um número maior que zero.</p>
              )}

              {saveError && <ErrorNotice message={saveError} />}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!ready || saving}>
                  {saving ? 'Salvando…' : saved ? 'Salvar correção' : 'Salvar calibração'}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={saving || (!points.a && !points.b)}
                  onClick={() => {
                    setPoints({ a: null, b: null })
                    setSaveError(null)
                  }}
                >
                  Marcar de novo
                </Button>
              </div>

              <p className="text-xs text-neutral-600">
                O fator px/{unitShort} é calculado no servidor a partir dos pontos e da medida que
                você informou.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
