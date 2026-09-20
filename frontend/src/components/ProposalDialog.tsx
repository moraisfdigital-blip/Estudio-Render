import { useCallback, useEffect, useState } from 'react'
import {
  errorMessage,
  fetchGeneratedImageBlob,
  fetchPhotoBlob,
  generateProposal,
  getComparison,
  type Comparison,
  type Photo,
  type Proposal,
} from '../api/client'
import { Button, ErrorNotice, Loading } from '../components/ui'
import { useResource } from '../hooks/useResource'

/**
 * Proposta visual — gerar e comparar com o original.
 *
 * **Nada do que decide a geração mora aqui.** O botão chama o endpoint sem
 * corpo; o prompt é montado no servidor a partir do levantamento (elementos,
 * specs do catálogo, máscaras) e a recusa vem de lá com o texto pronto. Se a
 * foto não tem máscara de intervenção, ou o Architecture Lock está desligado,
 * a API responde 422 e a tela mostra a mensagem que recebeu.
 *
 * A comparação é lado a lado, com o original à esquerda. As duas imagens vêm
 * por requisição autenticada e viram object URL — a rota exige token, e
 * `<img src>` não manda header.
 */

const numberFormat = new Intl.NumberFormat('pt-BR')
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Qual imagem carregar. O tipo decide a rota; ambas exigem token. */
type Fonte = { tipo: 'original' | 'gerada'; id: string } | null

/**
 * Baixa um blob autenticado e devolve object URL, revogando ao trocar.
 *
 * A fonte é descrita por dados (tipo + id) em vez de por uma função, para o
 * efeito depender só desses dois valores — uma callback seria recriada a cada
 * renderização e recarregaria a imagem sem motivo.
 */
function useBlobUrl(fonte: Fonte) {
  const tipo = fonte?.tipo ?? null
  const id = fonte?.id ?? null
  const chave = tipo && id ? `${tipo}:${id}` : null

  // O resultado carrega a chave de quem o produziu. Assim trocar de fonte
  // devolve `null` na própria renderização, sem um setState de limpeza dentro
  // do efeito — que dispararia uma renderização a mais só para apagar.
  const [carregado, setCarregado] = useState<{
    chave: string
    url: string | null
    erro: string | null
  } | null>(null)

  useEffect(() => {
    if (!tipo || !id || !chave) return

    let alive = true
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob =
          tipo === 'original' ? await fetchPhotoBlob(id) : await fetchGeneratedImageBlob(id)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setCarregado({ chave, url: objectUrl, erro: null })
      } catch (caught) {
        if (alive) {
          setCarregado({
            chave,
            url: null,
            erro: errorMessage(caught, 'Não foi possível carregar a imagem.'),
          })
        }
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [tipo, id, chave])

  const atual = carregado?.chave === chave ? carregado : null
  return { url: atual?.url ?? null, erro: atual?.erro ?? null }
}

function PromptResumo({ proposal }: { proposal: Proposal }) {
  const { prompt } = proposal
  return (
    <details className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
      <summary className="cursor-pointer text-xs text-neutral-400">
        O que foi pedido ao provedor
      </summary>
      <div className="mt-2 flex flex-col gap-2 text-xs text-neutral-400">
        <p>
          <span className="text-neutral-500">Intervenção: </span>
          {prompt.intervencao.join(', ') || 'nenhuma'}
        </p>
        {prompt.protecao.length > 0 && (
          <p>
            <span className="text-neutral-500">Protegido: </span>
            {prompt.protecao.join(', ')}
          </p>
        )}
        {prompt.pecas.map((peca) => (
          <p key={peca.name}>
            <span className="text-neutral-200">{peca.name}</span> — {peca.dimensions}. {peca.spec}.
          </p>
        ))}
        {/* O texto exato que foi enviado. É a resposta para "por que a
            proposta ficou assim?" sem reconstrução. */}
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-neutral-950 p-2 text-[10px] whitespace-pre-wrap text-neutral-500">
          {prompt.text}
        </pre>
      </div>
    </details>
  )
}

export default function ProposalDialog({
  photo,
  onClose,
  onGenerated,
}: {
  photo: Photo
  onClose: () => void
  onGenerated: () => void
}) {
  const carregar = useCallback(() => getComparison(photo.id), [photo.id])
  const { resource, reload } = useResource(
    carregar,
    'Não foi possível carregar a comparação desta foto.',
  )

  const [comparacao, setComparacao] = useState<Comparison | null>(null)
  const [gerando, setGerando] = useState(false)
  const [erroGeracao, setErroGeracao] = useState<string | null>(null)

  const [hidratadoDe, setHidratadoDe] = useState<Comparison | null>(null)
  if (resource.kind === 'ready' && resource.data !== hidratadoDe) {
    setHidratadoDe(resource.data)
    setComparacao(resource.data)
  }

  const original = useBlobUrl({ tipo: 'original', id: photo.id })
  const geradaId = comparacao?.generated?.id ?? null
  const gerada = useBlobUrl(geradaId ? { tipo: 'gerada', id: geradaId } : null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function gerar() {
    if (gerando) return
    setGerando(true)
    setErroGeracao(null)
    try {
      await generateProposal(photo.id)
      // Recarrega a comparação do servidor em vez de montar o novo estado
      // aqui: a última proposta concluída é decisão dele.
      setComparacao(await getComparison(photo.id))
      onGenerated()
    } catch (caught) {
      // Inclui o 422 do Architecture Lock — a mensagem vem pronta da API.
      setErroGeracao(errorMessage(caught, 'Não foi possível gerar a proposta.'))
    } finally {
      setGerando(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Proposta visual de ${photo.original_filename}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-6xl rounded-xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-100">Proposta visual</h2>
            <p className="truncate text-sm text-neutral-500" title={photo.original_filename}>
              {photo.original_filename}
            </p>
          </div>
          <Button variant="ghost" type="button" onClick={onClose}>
            Fechar
          </Button>
        </header>

        {resource.kind === 'loading' && <Loading label="Carregando comparação…" />}
        {resource.kind === 'error' && (
          <div className="mt-4">
            <ErrorNotice message={resource.message} onRetry={reload} />
          </div>
        )}

        {resource.kind === 'ready' && comparacao && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <figure className="flex flex-col gap-2">
                <figcaption className="text-xs tracking-wide text-neutral-500 uppercase">
                  Original
                </figcaption>
                {original.erro && <ErrorNotice message={original.erro} />}
                {!original.erro && !original.url && <Loading label="Carregando original…" />}
                {original.url && (
                  <img
                    src={original.url}
                    alt="Foto original do levantamento"
                    className="w-full rounded-lg border border-neutral-800"
                  />
                )}
              </figure>

              <figure className="flex flex-col gap-2">
                <figcaption className="text-xs tracking-wide text-neutral-500 uppercase">
                  Proposta gerada
                </figcaption>
                {/* Estado vazio: foto sem proposta é normal, não erro. */}
                {!comparacao.generated && (
                  <div className="flex h-full min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 p-4 text-center">
                    <p className="text-sm text-neutral-300">Ainda não gerada</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      A geração altera apenas as áreas marcadas como intervenção. O resto da foto
                      continua exatamente como está.
                    </p>
                  </div>
                )}
                {gerada.erro && <ErrorNotice message={gerada.erro} />}
                {comparacao.generated && !gerada.erro && !gerada.url && (
                  <Loading label="Carregando proposta…" />
                )}
                {gerada.url && (
                  <img
                    src={gerada.url}
                    alt="Proposta visual gerada"
                    className="w-full rounded-lg border border-neutral-800"
                  />
                )}
              </figure>
            </div>

            {erroGeracao && <ErrorNotice message={erroGeracao} />}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void gerar()} disabled={gerando}>
                {gerando
                  ? 'Gerando…'
                  : comparacao.generated
                    ? 'Gerar outra proposta'
                    : 'Gerar proposta'}
              </Button>
              {comparacao.proposal_count > 0 && (
                <span className="text-xs text-neutral-500">
                  {comparacao.proposal_count === 1
                    ? '1 proposta no histórico'
                    : `${comparacao.proposal_count} propostas no histórico`}
                </span>
              )}
            </div>

            {comparacao.generated && comparacao.proposal && (
              <div className="flex flex-col gap-3">
                <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
                  <p className="text-xs tracking-wide text-neutral-500 uppercase">
                    Alcance da geração
                  </p>
                  <p className="mt-1 text-sm text-neutral-100">
                    {numberFormat.format(comparacao.generated.changed_pixels)} pixels alterados
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Todos dentro das áreas de intervenção — o que está fora da máscara é o
                    original, pixel por pixel. Provedor: {comparacao.generated.provider}.
                  </p>
                  {comparacao.proposal.completed_at && (
                    <p className="mt-1 text-xs text-neutral-600">
                      Gerada em {dateTimeFormat.format(new Date(comparacao.proposal.completed_at))}
                    </p>
                  )}
                </div>

                <PromptResumo proposal={comparacao.proposal} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
