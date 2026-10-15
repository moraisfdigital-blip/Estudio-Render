import { useCallback, useEffect, useState } from 'react'
import {
  errorMessage,
  fetchGeneratedImageBlob,
  fetchGuideBlob,
  fetchPhotoBlob,
  generateProposal,
  getGenerationConfig,
  getComparison,
  type Comparison,
  type Photo,
  type Proposal,
  type ScaleCheck,
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
type Fonte = { tipo: 'original' | 'gerada' | 'previa'; id: string } | null

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
          tipo === 'original'
            ? await fetchPhotoBlob(id)
            : tipo === 'previa'
              ? await fetchGuideBlob(id)
              : await fetchGeneratedImageBlob(id)
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
    <details className="rounded-md border border-line bg-surface p-3">
      <summary className="cursor-pointer text-xs text-ink-soft">
        O que foi pedido ao provedor
      </summary>
      <div className="mt-2 flex flex-col gap-2 text-xs text-ink-soft">
        <p>
          <span className="text-ink-dim">Intervenção: </span>
          {prompt.intervencao.join(', ') || 'nenhuma'}
        </p>
        {prompt.protecao.length > 0 && (
          <p>
            <span className="text-ink-dim">Protegido: </span>
            {prompt.protecao.join(', ')}
          </p>
        )}
        {prompt.pecas.map((peca) => (
          <p key={peca.name}>
            <span className="text-ink">{peca.name}</span> — {peca.dimensions}. {peca.spec}.
          </p>
        ))}
        {/* O texto exato que foi enviado. É a resposta para "por que a
            proposta ficou assim?" sem reconstrução. */}
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-app p-2 text-[10px] whitespace-pre-wrap text-ink-dim">
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
  const generation = useResource(getGenerationConfig, 'Não foi possível verificar o serviço de geração.')
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
  const temPrevia = Boolean(comparacao?.generated?.guide_url)
  const previa = useBlobUrl(geradaId && temPrevia ? { tipo: 'previa', id: geradaId } : null)

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
      aria-label={`Render do projeto: ${photo.original_filename}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 sm:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-6xl rounded-xl border border-line bg-app p-5 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">Render do projeto</h2>
            <p className="truncate text-sm text-ink-dim" title={photo.original_filename}>
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
            <div className={`grid gap-4 ${temPrevia ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              <figure className="flex flex-col gap-2">
                <figcaption className="text-xs tracking-wide text-ink-dim uppercase">
                  Original
                </figcaption>
                {original.erro && <ErrorNotice message={original.erro} />}
                {!original.erro && !original.url && <Loading label="Carregando original…" />}
                {original.url && (
                  <img
                    src={original.url}
                    alt="Foto original do levantamento"
                    className="w-full rounded-lg border border-line"
                  />
                )}
              </figure>

              {temPrevia && (
                <figure className="flex flex-col gap-2">
                  <figcaption className="text-xs tracking-wide text-ink-dim uppercase">
                    Prévia em escala
                  </figcaption>
                  {previa.erro && <ErrorNotice message={previa.erro} />}
                  {!previa.erro && !previa.url && <Loading label="Carregando prévia…" />}
                  {previa.url && (
                    <img
                      src={previa.url}
                      alt="Prévia em escala: peças desenhadas no tamanho da calibração"
                      className="w-full rounded-lg border border-line"
                    />
                  )}
                </figure>
              )}

              <figure className="flex flex-col gap-2">
                <figcaption className="text-xs tracking-wide text-ink-dim uppercase">
                  Render
                </figcaption>
                {/* Estado vazio: foto sem proposta é normal, não erro. */}
                {!comparacao.generated && (
                  <div className="flex h-full min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-line p-4 text-center">
                    <p className="text-sm text-ink-soft">Ainda não renderizado</p>
                    <p className="mt-1 text-xs text-ink-dim">
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
                    alt="Render do projeto"
                    className="w-full rounded-lg border border-line"
                  />
                )}
              </figure>
            </div>

            {erroGeracao && <ErrorNotice message={erroGeracao} />}

            {generation.resource.kind === 'loading' && <Loading label="Verificando serviço de geração…" />}
            {generation.resource.kind === 'error' && <ErrorNotice message={generation.resource.message} onRetry={generation.reload} />}
            {generation.resource.kind === 'ready' && (
              <p className="text-sm text-ink-soft" role="status">
                {generation.resource.data.simulation
                  ? 'Modo de demonstração: esta geração é uma simulação local, sem inteligência artificial.'
                  : generation.resource.data.ready
                    ? 'Geração com OpenRouter. A fotografia e as áreas marcadas serão enviadas ao serviço de IA.'
                    : 'A geração com IA está indisponível. A equipe precisa configurar o serviço.'}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void gerar()} disabled={gerando || generation.resource.kind !== 'ready' || !generation.resource.data.ready}>
                {gerando
                  ? 'Renderizando…'
                  : comparacao.generated
                    ? 'Renderizar de novo'
                    : 'Renderizar projeto'}
              </Button>
              {comparacao.proposal_count > 0 && (
                <span className="text-xs text-ink-dim">
                  {comparacao.proposal_count === 1
                    ? '1 proposta no histórico'
                    : `${comparacao.proposal_count} propostas no histórico`}
                </span>
              )}
            </div>

            {comparacao.generated && <Conferencia check={comparacao.generated.scale_check} />}

            {comparacao.generated && comparacao.proposal && (
              <div className="flex flex-col gap-3">
                <div className="rounded-md border border-line bg-surface p-3">
                  <p className="text-xs tracking-wide text-ink-dim uppercase">
                    Alcance da geração
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    {numberFormat.format(comparacao.generated.changed_pixels)} pixels alterados
                  </p>
                  <p className="mt-1 text-xs text-ink-dim">
                    Todos dentro das áreas de intervenção — o que está fora da máscara é o
                    original, pixel por pixel. Provedor: {comparacao.generated.provider}.
                  </p>
                  {comparacao.proposal.completed_at && (
                    <p className="mt-1 text-xs text-ink-dim">
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


/**
 * Resultado da conferência de escala, em linguagem de quem usa.
 *
 * Com prévia: o contorno das peças é o da calibração (a IA não consegue
 * aumentar nem diminuir), e cada peça teve a cor conferida. Sem prévia: a
 * escala não é garantida, e a tela diz o que fazer para garantir.
 */
function Conferencia({ check }: { check: ScaleCheck | null }) {
  if (!check || check.modo === 'livre') {
    return (
      <div role="status" className="rounded-md border border-warn bg-warn-soft p-3 text-sm text-ink">
        <p className="font-medium">Escala não garantida neste render</p>
        <p className="mt-1 text-xs text-ink-soft">
          Para o tamanho das peças sair exato, calibre esta foto (aba 01) e monte as peças do
          projeto sobre ela (aba 02 › Sobre a foto). Depois clique em "Renderizar de novo".
        </p>
      </div>
    )
  }
  const problemas = check.pecas.filter((peca) => !peca.ok)
  const nenhuma = check.pecas.length > 0 && check.pecas.every((peca) => peca.cobertura < 0.6)
  return (
    <div
      role="status"
      className={`rounded-md border p-3 text-sm text-ink ${check.ok ? 'border-good bg-good-soft' : 'border-warn bg-warn-soft'}`}
    >
      <p className="font-medium">
        {nenhuma
          ? 'Nenhuma peça foi renderizada — confira os avisos'
          : check.ok
            ? 'Escala garantida pela calibração'
            : 'Escala garantida — confira os avisos'}
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        O contorno e o tamanho de cada peça são os da prévia, calculados pela calibração
        {check.pixels_por_metro ? ` (${check.pixels_por_metro.toLocaleString('pt-BR')} pixels por metro)` : ''}.
        A IA só deu o acabamento: o que ela desenhou fora do contorno foi descartado.
      </p>
      {problemas.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-ink">
          {problemas.map((peca) => (
            <li key={peca.nome}>
              <b>{peca.nome}</b>: {peca.aviso}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
