import { useCallback, useRef, useState } from 'react'
import {
  createArea,
  deletePhoto,
  errorMessage,
  fetchPhotoBlob,
  getMediaLimits,
  listAreaPhotos,
  listAreas,
  uploadPhoto,
  type Area,
  type MediaLimits,
  type Photo,
} from '../api/client'
import CalibrationDialog from '../components/CalibrationDialog'
import ElementsDialog from '../components/ElementsDialog'
import MasksDialog from '../components/MasksDialog'
import ProposalDialog from '../components/ProposalDialog'
import PhotoThumb from '../components/PhotoThumb'
import { Button, EmptyState, ErrorNotice, Field, Loading, inputClass } from '../components/ui'
import { useResource } from '../hooks/useResource'

/**
 * Levantamento — áreas do projeto e o grid de fotos de cada área.
 *
 * A foto original é imutável: esta tela só envia e lê. "Remover" tira a foto do
 * levantamento; o arquivo original continua guardado no storage do servidor.
 */

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Erro de um upload específico, preso ao nome do arquivo que falhou. */
type UploadError = { filename: string; message: string }

// ---------------------------------------------------------------------------

function NewAreaForm({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string
  onCreated: (area: Area) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      onCreated(await createArea(projectId, { name, description }))
      setName('')
      setDescription('')
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível criar a área.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <Field label="Nome da área" htmlFor="area-name" required hint="Ex.: fachada, totem, interior.">
        <input
          id="area-name"
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Fachada principal"
          maxLength={160}
          required
          autoFocus
        />
      </Field>

      <Field label="Observações" htmlFor="area-description">
        <textarea
          id="area-description"
          className={inputClass}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          maxLength={2000}
        />
      </Field>

      {error && <ErrorNotice message={error} />}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Criando…' : 'Criar área'}
        </Button>
        <Button variant="ghost" type="button" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------

function AreaPhotos({
  area,
  limits,
  onCountChange,
}: {
  area: Area
  limits: MediaLimits
  // O contador fica no card da área, que é de outro componente: sem isto o
  // badge continuaria dizendo "0 fotos" depois do upload.
  onCountChange: (delta: number) => void
}) {
  const load = useCallback(() => listAreaPhotos(area.id), [area.id])
  const { resource, reload, patch } = useResource(load, 'Não foi possível carregar as fotos.')

  const fileInput = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ filename: string; percent: number } | null>(null)
  const [uploadErrors, setUploadErrors] = useState<UploadError[]>([])
  const [removing, setRemoving] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  // Fase 5: a calibração acontece num overlay sobre a foto original, em cima
  // desta mesma tela — o levantamento não muda de contexto para medir a escala.
  const [calibrating, setCalibrating] = useState<Photo | null>(null)
  // Fase 6: os elementos da foto abrem no mesmo lugar da calibração — marcar a
  // peça e medir fazem parte do levantamento, não de outra tela.
  const [listingElements, setListingElements] = useState<Photo | null>(null)
  const [masking, setMasking] = useState<Photo | null>(null)
  const [proposing, setProposing] = useState<Photo | null>(null)

  const maxBytes = limits.max_upload_mb * 1024 * 1024
  const accepted = limits.accepted_labels.join(', ')

  /** Conferência local antes de gastar upload. Quem decide de verdade é a API. */
  function localRejection(file: File): string | null {
    if (file.size > maxBytes) {
      return `${formatSize(file.size)} passa do limite de ${limits.max_upload_mb} MB por foto.`
    }
    if (file.type && !limits.accepted_content_types.includes(file.type)) {
      return `Formato não aceito. Envie uma imagem ${accepted}.`
    }
    return null
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadErrors([])

    const errors: UploadError[] = []
    const uploaded: Photo[] = []

    for (const file of Array.from(files)) {
      const rejection = localRejection(file)
      if (rejection) {
        errors.push({ filename: file.name, message: rejection })
        continue
      }
      setProgress({ filename: file.name, percent: 0 })
      try {
        uploaded.push(
          await uploadPhoto(area.id, file, (percent) => setProgress({ filename: file.name, percent })),
        )
      } catch (caught) {
        errors.push({
          filename: file.name,
          message: errorMessage(caught, 'Não foi possível enviar esta foto.'),
        })
      }
    }

    setProgress(null)
    setUploadErrors(errors)
    if (uploaded.length > 0) {
      patch((current) => [...uploaded, ...current])
      onCountChange(uploaded.length)
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  /**
   * Abre o original numa aba nova.
   *
   * A rota exige token e uma aba nova não manda header, então buscamos os bytes
   * e abrimos um object URL. Os mesmos bytes do upload, sem reprocessamento.
   */
  async function openOriginal(photo: Photo) {
    if (opening) return
    setOpening(photo.id)
    setUploadErrors([])
    try {
      const blob = await fetchPhotoBlob(photo.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // A aba já leu o blob; soltamos a referência depois de um instante.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (caught) {
      setUploadErrors([
        {
          filename: photo.original_filename,
          message: errorMessage(caught, 'Não foi possível abrir o original.'),
        },
      ])
    } finally {
      setOpening(null)
    }
  }

  async function handleRemove(photo: Photo) {
    if (removing) return
    setRemoving(photo.id)
    setUploadErrors([])
    try {
      await deletePhoto(photo.id)
      patch((current) => current.filter((item) => item.id !== photo.id))
      onCountChange(-1)
    } catch (caught) {
      setUploadErrors([
        {
          filename: photo.original_filename,
          message: errorMessage(caught, 'Não foi possível remover esta foto.'),
        },
      ])
    } finally {
      setRemoving(null)
    }
  }

  const uploading = progress !== null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          id={`upload-${area.id}`}
          type="file"
          multiple
          accept={limits.accepted_content_types.join(',')}
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <Button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? 'Enviando…' : 'Adicionar fotos'}
        </Button>
        <p className="text-xs text-neutral-500">
          {accepted} · até {limits.max_upload_mb} MB por foto. O original é guardado sem alteração.
        </p>
      </div>

      {/* Progresso: em campo a rede é ruim e a foto é grande — a barra é obrigatória. */}
      {progress && (
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-neutral-400">
            <span className="truncate pr-3">{progress.filename}</span>
            <span>{progress.percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Enviando ${progress.filename}`}
            className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
          >
            <div
              className="h-full bg-neutral-200 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {uploadErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200"
        >
          <p className="font-medium">Algumas fotos não entraram:</p>
          <ul className="mt-2 space-y-1">
            {uploadErrors.map((item) => (
              <li key={item.filename}>
                <span className="text-red-100">{item.filename}</span> — {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {resource.kind === 'loading' && <Loading label="Carregando fotos…" />}
      {resource.kind === 'error' && <ErrorNotice message={resource.message} onRetry={reload} />}

      {resource.kind === 'ready' && resource.data.length === 0 && !uploading && (
        <EmptyState
          title="Nenhuma foto nesta área"
          description="Suba as fotos do levantamento. O arquivo original fica guardado como veio da câmera — as fases seguintes só leem essa foto, nunca a substituem."
        />
      )}

      {resource.kind === 'ready' && resource.data.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {resource.data.map((photo) => (
            <li
              key={photo.id}
              className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
            >
              <div className="aspect-4/3">
                <PhotoThumb photo={photo} alt={photo.original_filename} />
              </div>
              <div className="flex flex-col gap-2 p-3">
                <p className="truncate text-xs text-neutral-200" title={photo.original_filename}>
                  {photo.original_filename}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatSize(photo.size_bytes)} ·{' '}
                  {dateTimeFormat.format(new Date(photo.created_at))}
                </p>
                {/* Hash do original: a prova, na tela, de que o arquivo é o mesmo. */}
                <p
                  className="truncate font-mono text-[10px] text-neutral-600"
                  title={`SHA-256 do original: ${photo.checksum_sha256}`}
                >
                  sha256 {photo.checksum_sha256.slice(0, 16)}…
                </p>
                {/* Estado da escala visível no grid: quem está em campo precisa
                    saber de relance o que ainda falta calibrar. */}
                <span
                  className={`w-fit rounded-full border px-2 py-0.5 text-[10px] ${
                    photo.calibrated
                      ? 'border-neutral-600 text-neutral-300'
                      : 'border-dashed border-neutral-700 text-neutral-500'
                  }`}
                >
                  {photo.calibrated ? 'Escala calibrada' : 'Não calibrada'}
                </span>
                <button
                  type="button"
                  onClick={() => setCalibrating(photo)}
                  className="w-fit text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-100 hover:underline"
                >
                  {photo.calibrated ? 'Conferir escala' : 'Calibrar escala'}
                </button>
                <button
                  type="button"
                  onClick={() => setListingElements(photo)}
                  className="w-fit text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-100 hover:underline"
                >
                  {photo.element_count === 0
                    ? 'Marcar elementos'
                    : photo.element_count === 1
                      ? '1 elemento'
                      : `${photo.element_count} elementos`}
                </button>
                {/* Fase 8: sem recorte de intervenção a geração não tem onde
                    escrever, e o grid precisa mostrar isso de relance. */}
                <button
                  type="button"
                  onClick={() => setMasking(photo)}
                  className="w-fit text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-100 hover:underline"
                >
                  {photo.intervention_count === 0
                    ? 'Marcar máscaras'
                    : photo.intervention_count === 1
                      ? '1 área de intervenção'
                      : `${photo.intervention_count} áreas de intervenção`}
                </button>
                {/* Fase 9: gerar a proposta. O botão fica visível sempre — se a
                    foto não estiver pronta, a própria API explica o porquê (422)
                    em vez de a tela esconder a ação sem dizer nada. */}
                <button
                  type="button"
                  onClick={() => setProposing(photo)}
                  className="w-fit text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-100 hover:underline"
                >
                  Proposta visual
                </button>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void openOriginal(photo)}
                    disabled={opening === photo.id}
                    className="text-xs text-neutral-400 underline-offset-2 transition hover:text-neutral-100 hover:underline disabled:opacity-50"
                  >
                    {opening === photo.id ? 'Abrindo…' : 'Ver original'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove(photo)}
                    disabled={removing === photo.id}
                    className="text-xs text-neutral-500 transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removing === photo.id ? 'Removendo…' : 'Remover'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {calibrating && (
        <CalibrationDialog
          photo={calibrating}
          onClose={() => setCalibrating(null)}
          onSaved={(calibration) =>
            patch((current) =>
              current.map((item) =>
                item.id === calibration.photo_id ? { ...item, calibrated: true } : item,
              ),
            )
          }
        />
      )}

      {proposing && (
        <ProposalDialog
          photo={proposing}
          onClose={() => setProposing(null)}
          onGenerated={reload}
        />
      )}

      {masking && (
        <MasksDialog
          photo={masking}
          onClose={() => setMasking(null)}
          onSaved={(estado) =>
            patch((current) =>
              current.map((item) =>
                item.id === estado.photo_id
                  ? { ...item, intervention_count: estado.intervention_count }
                  : item,
              ),
            )
          }
        />
      )}

      {listingElements && (
        <ElementsDialog
          photo={listingElements}
          onClose={() => setListingElements(null)}
          onCountChange={(total) =>
            patch((current) =>
              current.map((item) =>
                item.id === listingElements.id ? { ...item, element_count: total } : item,
              ),
            )
          }
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function SurveyPanel({ projectId }: { projectId: string }) {
  const loadAreas = useCallback(() => listAreas(projectId), [projectId])
  const areas = useResource(loadAreas, 'Não foi possível carregar as áreas.')

  const loadLimits = useCallback(() => getMediaLimits(), [])
  const limits = useResource(loadLimits, 'Não foi possível carregar os limites de upload.')

  const [creating, setCreating] = useState(false)
  const [openArea, setOpenArea] = useState<string | null>(null)

  function handleCreated(area: Area) {
    areas.patch((current) => [...current, area])
    setCreating(false)
    setOpenArea(area.id)
  }

  return (
    <section className="mt-10 border-t border-neutral-800 pt-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Levantamento</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Áreas do local e as fotos de cada uma.
          </p>
        </div>
        {areas.resource.kind === 'ready' && areas.resource.data.length > 0 && !creating && (
          <Button variant="ghost" type="button" onClick={() => setCreating(true)}>
            Nova área
          </Button>
        )}
      </header>

      <div className="mt-6 flex flex-col gap-6">
        {creating && (
          <NewAreaForm
            projectId={projectId}
            onCreated={handleCreated}
            onCancel={() => setCreating(false)}
          />
        )}

        {areas.resource.kind === 'loading' && <Loading label="Carregando áreas…" />}
        {areas.resource.kind === 'error' && (
          <ErrorNotice message={areas.resource.message} onRetry={areas.reload} />
        )}

        {areas.resource.kind === 'ready' && areas.resource.data.length === 0 && !creating && (
          <EmptyState
            title="Nenhuma área ainda"
            description="Divida o local em áreas (fachada, totem, interior) e suba as fotos de cada uma."
            action={
              <Button type="button" onClick={() => setCreating(true)}>
                Criar primeira área
              </Button>
            }
          />
        )}

        {areas.resource.kind === 'ready' &&
          areas.resource.data.map((area) => {
            const open = openArea === area.id
            return (
              <article key={area.id} className="rounded-lg border border-neutral-800">
                <button
                  type="button"
                  onClick={() => setOpenArea(open ? null : area.id)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-100">{area.name}</p>
                    {area.description && (
                      <p className="truncate text-xs text-neutral-500">{area.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-400">
                      {area.photo_count === 1 ? '1 foto' : `${area.photo_count} fotos`}
                    </span>
                    <span className="text-xs text-neutral-500">{open ? 'Fechar' : 'Abrir'}</span>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-neutral-800 p-4">
                    {limits.resource.kind === 'loading' && <Loading label="Carregando…" />}
                    {limits.resource.kind === 'error' && (
                      <ErrorNotice message={limits.resource.message} onRetry={limits.reload} />
                    )}
                    {limits.resource.kind === 'ready' && (
                      <AreaPhotos
                        area={area}
                        limits={limits.resource.data}
                        onCountChange={(delta) =>
                          areas.patch((current) =>
                            current.map((item) =>
                              item.id === area.id
                                ? { ...item, photo_count: item.photo_count + delta }
                                : item,
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                )}
              </article>
            )
          })}
      </div>
    </section>
  )
}
