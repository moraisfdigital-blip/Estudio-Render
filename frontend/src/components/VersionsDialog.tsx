import { useCallback, useEffect, useState } from 'react'
import {
  approveVersion,
  createVersion,
  discardVersion,
  errorMessage,
  fetchGeneratedImageBlob,
  listProposals,
  listVersions,
  type Photo,
  type Proposal,
  type Version,
  type VersionList,
} from '../api/client'
import { useAuth } from '../auth/context'
import { Button, ErrorNotice, Loading } from '../components/ui'
import { useResource } from '../hooks/useResource'

/**
 * Versões — até três candidatas por foto, comparadas lado a lado, uma aprovada.
 *
 * O limite não é contado aqui: `limit_reached` e `slots_left` vêm do servidor,
 * onde um índice único parcial garante que nem dois cliques simultâneos criem
 * uma quarta. A tela mostra o estado que recebeu.
 *
 * `approved` também é do servidor, derivado de `photos.approved_version_id`.
 * Não existe "marcar como aprovada" localmente: aprovar é uma chamada, e a
 * resposta traz a lista inteira já recalculada.
 */

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** O que a tela carrega de uma vez: as versões e as propostas promovíveis. */
type Carga = { lista: VersionList; propostas: Proposal[] }

/** Miniatura da imagem gerada. A rota exige token, então vem por blob. */
function VersionThumb({ imageId, alt }: { imageId: string; alt: string }) {
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
        // Miniatura é apoio: o rótulo da versão já identifica o card.
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageId])

  if (!url) {
    return <div className="aspect-4/3 w-full animate-pulse rounded bg-surface" />
  }
  return <img src={url} alt={alt} className="aspect-4/3 w-full rounded object-cover" />
}

function CardVersao({
  versao,
  selecionada,
  podeAprovar,
  ocupada,
  onSelecionar,
  onAprovar,
  onDescartar,
}: {
  versao: Version
  selecionada: boolean
  podeAprovar: boolean
  ocupada: boolean
  onSelecionar: () => void
  onAprovar: () => void
  onDescartar: () => void
}) {
  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-3 ${
        versao.approved
          ? 'border-good bg-good-soft'
          : selecionada
            ? 'border-ink-dim'
            : 'border-line'
      }`}
    >
      {versao.generated_image && (
        <VersionThumb imageId={versao.generated_image.id} alt={versao.label} />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink" title={versao.label}>
            {versao.label}
          </p>
          <p className="text-[10px] text-ink-dim">
            Vaga {versao.position} · {dateTimeFormat.format(new Date(versao.created_at))}
          </p>
        </div>
        {versao.approved && (
          <span className="shrink-0 rounded-full border border-good px-2 py-0.5 text-[10px] text-good">
            Aprovada
          </span>
        )}
      </div>

      {versao.notes && <p className="text-xs text-ink-soft">{versao.notes}</p>}

      <label className="flex items-center gap-2 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={selecionada}
          onChange={onSelecionar}
          className="accent-neutral-400"
        />
        Comparar
      </label>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {versao.approved ? (
          // A aprovada não pode ser descartada: a apresentação depende de haver
          // uma escolha registrada. Dizer isso é melhor do que um botão que dá erro.
          <span className="text-[10px] text-ink-dim">
            Aprove outra versão antes de descartar esta.
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onAprovar}
              disabled={!podeAprovar || ocupada}
              className="text-xs text-ink-soft underline-offset-2 transition hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-40"
              title={podeAprovar ? undefined : 'Só o owner do workspace aprova uma versão.'}
            >
              Aprovar
            </button>
            <button
              type="button"
              onClick={onDescartar}
              disabled={ocupada}
              className="text-xs text-ink-dim transition hover:text-bad disabled:opacity-40"
            >
              Descartar
            </button>
          </>
        )}
      </div>
    </li>
  )
}

export default function VersionsDialog({
  photo,
  onClose,
  onChanged,
}: {
  photo: Photo
  onClose: () => void
  onChanged: (lista: VersionList) => void
}) {
  const { state } = useAuth()
  // Aprovar é do owner. O texto muda para o editor, mas quem recusa de verdade
  // é a API (403).
  const podeAprovar = state.kind === 'authenticated' && state.session.user.role === 'owner'

  const carregar = useCallback(
    async (): Promise<Carga> => ({
      lista: await listVersions(photo.id),
      propostas: await listProposals(photo.id),
    }),
    [photo.id],
  )
  const { resource, reload } = useResource(
    carregar,
    'Não foi possível carregar as versões desta foto.',
  )

  const [lista, setLista] = useState<VersionList | null>(null)
  const [propostas, setPropostas] = useState<Proposal[]>([])
  const [selecionadas, setSelecionadas] = useState<string[]>([])
  const [ocupada, setOcupada] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [hidratadoDe, setHidratadoDe] = useState<Carga | null>(null)
  if (resource.kind === 'ready' && resource.data !== hidratadoDe) {
    setHidratadoDe(resource.data)
    setLista(resource.data.lista)
    setPropostas(resource.data.propostas)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function executar(acao: () => Promise<VersionList | void>, padrao: string) {
    if (ocupada) return
    setOcupada(true)
    setErro(null)
    try {
      const resultado = await acao()
      // Toda ação devolve (ou provoca) a lista recalculada no servidor: o
      // limite e a aprovação não são deduzidos aqui.
      const atual = resultado ?? (await listVersions(photo.id))
      setLista(atual)
      setPropostas(await listProposals(photo.id))
      onChanged(atual)
    } catch (caught) {
      setErro(errorMessage(caught, padrao))
    } finally {
      setOcupada(false)
    }
  }

  function alternarSelecao(id: string) {
    setSelecionadas((atuais) =>
      atuais.includes(id) ? atuais.filter((item) => item !== id) : [...atuais, id],
    )
  }

  // Propostas concluídas que ainda não viraram versão — o que dá para promover.
  const promovieis = lista
    ? propostas.filter(
        (proposta) =>
          proposta.status === 'concluida' &&
          !lista.versions.some((versao) => versao.proposal_id === proposta.id),
      )
    : []

  const emComparacao = lista
    ? lista.versions.filter((versao) => selecionadas.includes(versao.id))
    : []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Versões de ${photo.original_filename}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 sm:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-5xl rounded-xl border border-line bg-app p-5 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">Versões</h2>
            <p className="truncate text-sm text-ink-dim" title={photo.original_filename}>
              {photo.original_filename}
            </p>
          </div>
          <Button variant="ghost" type="button" onClick={onClose}>
            Fechar
          </Button>
        </header>

        {resource.kind === 'loading' && <Loading label="Carregando versões…" />}
        {resource.kind === 'error' && (
          <div className="mt-4">
            <ErrorNotice message={resource.message} onRetry={reload} />
          </div>
        )}

        {resource.kind === 'ready' && lista && (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-xs text-ink-dim">
              Até {lista.max_versions} versões por foto —{' '}
              {lista.limit_reached
                ? 'limite atingido. Descarte uma para abrir espaço.'
                : `${lista.slots_left} ${lista.slots_left === 1 ? 'vaga livre' : 'vagas livres'}.`}{' '}
              Três opções é o que um cliente compara sem travar na escolha.
            </p>

            {erro && <ErrorNotice message={erro} />}

            {/* Estado vazio da fatia. */}
            {lista.versions.length === 0 ? (
              <div className="rounded-md border border-dashed border-line p-4 text-center">
                <p className="text-sm text-ink-soft">Nenhuma versão ainda</p>
                <p className="mt-1 text-xs text-ink-dim">
                  Gere propostas na tela de proposta visual e promova aqui as que merecem ir para
                  o cliente.
                </p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-3">
                {lista.versions.map((versao) => (
                  <CardVersao
                    key={versao.id}
                    versao={versao}
                    selecionada={selecionadas.includes(versao.id)}
                    podeAprovar={podeAprovar}
                    ocupada={ocupada}
                    onSelecionar={() => alternarSelecao(versao.id)}
                    onAprovar={() =>
                      void executar(
                        () => approveVersion(versao.id),
                        'Não foi possível aprovar esta versão.',
                      )
                    }
                    onDescartar={() =>
                      void executar(async () => {
                        await discardVersion(versao.id)
                        setSelecionadas((atuais) => atuais.filter((id) => id !== versao.id))
                      }, 'Não foi possível descartar esta versão.')
                    }
                  />
                ))}
              </ul>
            )}

            {/* Comparação lado a lado das selecionadas. */}
            {emComparacao.length >= 2 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs tracking-wide text-ink-dim uppercase">
                  Comparando {emComparacao.length} versões
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {emComparacao.map((versao) => (
                    <figure key={versao.id} className="flex flex-col gap-1">
                      {versao.generated_image && (
                        <VersionThumb imageId={versao.generated_image.id} alt={versao.label} />
                      )}
                      <figcaption className="text-xs text-ink-soft">{versao.label}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {/* Promover proposta a versão. */}
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-xs tracking-wide text-ink-dim uppercase">
                Promover uma proposta
              </p>
              {lista.limit_reached ? (
                <p className="text-xs text-warn">
                  Limite de {lista.max_versions} versões atingido. Descarte uma versão para
                  promover outra proposta.
                </p>
              ) : promovieis.length === 0 ? (
                <p className="text-xs text-ink-dim">
                  Nenhuma proposta disponível para promover. Gere uma na tela de proposta visual.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {promovieis.map((proposta) => (
                    <li
                      key={proposta.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-line p-2"
                    >
                      <span className="truncate text-xs text-ink-soft">
                        Proposta de{' '}
                        {dateTimeFormat.format(new Date(proposta.created_at))} ·{' '}
                        {proposta.provider}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={ocupada}
                        onClick={() =>
                          void executar(async () => {
                            await createVersion(photo.id, { proposal_id: proposta.id })
                          }, 'Não foi possível promover esta proposta.')
                        }
                      >
                        Promover
                      </Button>
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
