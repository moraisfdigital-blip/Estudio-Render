import { useCallback, useEffect, useState } from 'react'
import {
  createShareLink,
  errorMessage,
  exportPresentation,
  fetchGeneratedImageBlob,
  fetchPresentationPdfBlob,
  getPresentation,
  savePresentation,
  type Presentation,
  type Slide,
} from '../api/client'
import { Button, ErrorNotice, Loading, inputClass } from '../components/ui'
import { useResource } from '../hooks/useResource'

/**
 * Apresentação do projeto — preview, PDF e link interno.
 *
 * A apresentação reúne as **versões aprovadas** do projeto. A tela não decide
 * o que entra: o servidor monta o rascunho a partir das aprovadas e recusa
 * (422) qualquer slide que aponte para outra versão. `can_export` e
 * `blocked_reason` também vêm de lá.
 *
 * Quando a versão aprovada de uma foto muda depois da apresentação salva, o
 * slide volta marcado como `outdated` — a tela avisa em vez de exibir em
 * silêncio algo que não é mais a escolha registrada.
 */

const numberFormat = new Intl.NumberFormat('pt-BR')
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${numberFormat.format(Number(mb.toFixed(1)))} MB` : `${Math.round(bytes / 1024)} KB`
}

/** Miniatura do slide. A rota exige token, então vem por blob. */
function SlideThumb({ imageId, alt }: { imageId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob = await fetchGeneratedImageBlob(imageId)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        // Miniatura é apoio; o nome do arquivo já identifica o slide.
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageId])

  if (!url) return <div className="aspect-4/3 w-full animate-pulse rounded bg-surface" />
  return <img src={url} alt={alt} className="aspect-4/3 w-full rounded object-cover" />
}

function CardSlide({
  slide,
  onLegenda,
}: {
  slide: Slide
  onLegenda: (valor: string) => void
}) {
  const imageId = slide.image_url?.split('/').at(-1)

  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-3 ${
        slide.outdated ? 'border-warn bg-warn-soft' : 'border-line'
      }`}
    >
      {imageId ? (
        <SlideThumb imageId={imageId} alt={slide.label} />
      ) : (
        <div className="flex aspect-4/3 w-full items-center justify-center rounded border border-dashed border-line text-xs text-ink-dim">
          Imagem indisponível
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink" title={slide.original_filename}>
            {slide.original_filename}
          </p>
          <p className="text-[10px] text-ink-dim">
            Slide {slide.position} · {slide.label}
          </p>
        </div>
      </div>

      {slide.outdated && (
        <p className="text-[11px] text-warn">
          Esta foto tem outra versão aprovada agora. Salve a apresentação de novo para atualizar
          o slide.
        </p>
      )}

      <input
        defaultValue={slide.caption ?? ''}
        placeholder="Legenda (opcional)"
        onBlur={(event) => onLegenda(event.target.value)}
        className={`${inputClass} text-xs`}
      />
    </li>
  )
}

export default function PresentationPanel({ projectId }: { projectId: string }) {
  const carregar = useCallback(() => getPresentation(projectId), [projectId])
  const { resource, reload } = useResource(
    carregar,
    'Não foi possível carregar a apresentação.',
  )

  const [atual, setAtual] = useState<Presentation | null>(null)
  const [titulo, setTitulo] = useState('')
  const [notas, setNotas] = useState('')
  const [legendas, setLegendas] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const [hidratadoDe, setHidratadoDe] = useState<Presentation | null>(null)
  if (resource.kind === 'ready' && resource.data !== hidratadoDe) {
    const dados = resource.data
    setHidratadoDe(dados)
    setAtual(dados)
    setTitulo(dados.title)
    setNotas(dados.notes ?? '')
    setLegendas(
      Object.fromEntries(dados.slides.map((slide) => [slide.photo_id, slide.caption ?? ''])),
    )
  }

  async function executar(chave: string, acao: () => Promise<Presentation>, padrao: string) {
    if (ocupado) return
    setOcupado(chave)
    setErro(null)
    try {
      setAtual(await acao())
    } catch (caught) {
      setErro(errorMessage(caught, padrao))
    } finally {
      setOcupado(null)
    }
  }

  function salvar() {
    if (!atual) return
    void executar(
      'salvar',
      () =>
        savePresentation(projectId, {
          title: titulo.trim() || undefined,
          notes: notas.trim() || undefined,
          slides: atual.slides.map((slide) => ({
            photo_id: slide.photo_id,
            // Sempre a versão aprovada vigente: é o que o servidor aceita, e
            // é o que resolve um slide marcado como desatualizado.
            version_id: slide.version_id,
            caption: legendas[slide.photo_id]?.trim() || undefined,
          })),
        }),
      'Não foi possível salvar a apresentação.',
    )
  }

  async function baixarPdf() {
    if (!atual?.pdf) return
    setErro(null)
    try {
      const blob = await fetchPresentationPdfBlob(projectId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // Revoga depois de o navegador ter tido tempo de abrir a aba.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (caught) {
      setErro(errorMessage(caught, 'Não foi possível abrir o PDF.'))
    }
  }

  async function copiarLink() {
    if (!atual?.share) return
    const completo = `${window.location.origin}${atual.share.url}`
    try {
      await navigator.clipboard.writeText(completo)
    } catch {
      // Sem permissão de área de transferência: o link continua na tela para
      // copiar na mão, então não é erro que mereça alarme.
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-ink">Apresentação</h2>
      <p className="mt-1 text-sm text-ink-dim">
        Reúne as versões aprovadas do projeto. O que vai para o cliente é só o que foi aprovado.
      </p>

      {resource.kind === 'loading' && <Loading label="Carregando apresentação…" />}
      {resource.kind === 'error' && (
        <div className="mt-4">
          <ErrorNotice message={resource.message} onRetry={reload} />
        </div>
      )}

      {resource.kind === 'ready' && atual && (
        <div className="mt-4 flex flex-col gap-4">
          {erro && <ErrorNotice message={erro} />}

          {/* Estado vazio da fatia: sem aprovação não há apresentação. */}
          {atual.slides.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-4">
              <p className="text-sm text-ink-soft">Nenhuma versão aprovada ainda</p>
              <p className="mt-1 text-xs text-ink-dim">
                {atual.blocked_reason ??
                  'Aprove uma versão em alguma foto para montar a apresentação.'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-dim">Título</span>
                  <input
                    value={titulo}
                    onChange={(event) => setTitulo(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-dim">Observações</span>
                  <input
                    value={notas}
                    onChange={(event) => setNotas(event.target.value)}
                    placeholder="Aparece na capa do PDF"
                    className={inputClass}
                  />
                </label>
              </div>

              {!atual.saved && (
                <p className="text-xs text-ink-dim">
                  Rascunho montado das versões aprovadas. Salve para fixar a ordem e as legendas.
                </p>
              )}

              <ul className="grid gap-3 sm:grid-cols-3">
                {atual.slides.map((slide) => (
                  <CardSlide
                    key={slide.photo_id}
                    slide={slide}
                    onLegenda={(valor) =>
                      setLegendas((atuais) => ({ ...atuais, [slide.photo_id]: valor }))
                    }
                  />
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={salvar} disabled={ocupado !== null}>
                  {ocupado === 'salvar' ? 'Salvando…' : 'Salvar apresentação'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={ocupado !== null || !atual.can_export}
                  onClick={() =>
                    void executar(
                      'exportar',
                      () => exportPresentation(projectId),
                      'Não foi possível exportar o PDF.',
                    )
                  }
                >
                  {ocupado === 'exportar' ? 'Exportando…' : 'Exportar PDF'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={ocupado !== null}
                  onClick={() =>
                    void executar(
                      'link',
                      () => createShareLink(projectId),
                      'Não foi possível gerar o link.',
                    )
                  }
                >
                  {atual.share ? 'Renovar link interno' : 'Gerar link interno'}
                </Button>
              </div>

              {atual.pdf && (
                <div className="rounded-md border border-line bg-surface p-3">
                  <p className="text-xs tracking-wide text-ink-dim uppercase">PDF exportado</p>
                  <p className="mt-1 text-sm text-ink">
                    {atual.pdf.page_count} páginas · {formatSize(atual.pdf.size_bytes)}
                  </p>
                  <p className="mt-1 text-xs text-ink-dim">
                    Gerado em {dateTimeFormat.format(new Date(atual.pdf.generated_at))} ·
                    provedor {atual.pdf.provider}
                  </p>
                  <button
                    type="button"
                    onClick={() => void baixarPdf()}
                    className="mt-2 text-xs text-ink-soft underline-offset-2 hover:underline"
                  >
                    Abrir PDF
                  </button>
                </div>
              )}

              {atual.share && (
                <div className="rounded-md border border-line bg-surface p-3">
                  <p className="text-xs tracking-wide text-ink-dim uppercase">
                    Link interno
                  </p>
                  <p className="mt-1 font-mono text-[11px] break-all text-ink-soft">
                    {window.location.origin}
                    {atual.share.url}
                  </p>
                  <p className="mt-1 text-xs text-ink-dim">
                    Exige login do workspace — não é portal de cliente. Renovar o link invalida o
                    anterior.
                  </p>
                  <button
                    type="button"
                    onClick={() => void copiarLink()}
                    className="mt-2 text-xs text-ink-soft underline-offset-2 hover:underline"
                  >
                    Copiar link
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
