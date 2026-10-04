import { useEffect, useRef } from 'react'
import { listProjects } from '../api/client'
import { useResource } from '../hooks/useResource'
import { Rotulo } from './prototipo/pecas'
import { ErrorNotice, Loading } from './ui'

const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

function data(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatoData.format(d)
}

/**
 * Trocar de projeto sem sair da mesa de trabalho.
 *
 * Substitui a antiga tela de lista: abre por cima do estúdio, na mesma
 * linguagem das janelas do protótipo, e quem cria projeto novo continua sendo
 * o botão "＋ Novo projeto" do topo.
 */
export default function ProjetosDialog({
  atual,
  onAbrir,
  onClose,
}: {
  atual: string
  onAbrir: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const { resource, reload } = useResource(listProjects, 'Não foi possível carregar os projetos.')

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="projetos-titulo"
      className="fixed inset-0 m-auto max-h-[80vh] w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-lg border-0 bg-surface p-0 text-ink shadow-[0_24px_80px_rgba(23,28,32,.26)] backdrop:bg-[rgba(31,35,38,.48)]"
    >
      <div className="flex items-start justify-between px-6 pt-6 pb-4">
        <div>
          <Rotulo cor="destaque">Projetos</Rotulo>
          <h2 id="projetos-titulo" className="mt-2 text-[22px] font-semibold">
            Abrir projeto
          </h2>
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Fechar"
          className="px-2 py-1 text-[22px] leading-none text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>

      <div className="max-h-[calc(80vh-110px)] overflow-y-auto px-6 pb-6">
        {resource.kind === 'loading' && <Loading label="Carregando projetos…" />}
        {resource.kind === 'error' && <ErrorNotice message={resource.message} onRetry={reload} />}
        {resource.kind === 'ready' && resource.data.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-dim">
            Nenhum projeto ainda. Use “＋ Novo projeto” no topo.
          </p>
        )}
        {resource.kind === 'ready' && resource.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {resource.data.map((p) => {
              const aberto = p.id === atual
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => (aberto ? ref.current?.close() : onAbrir(p.id))}
                    aria-current={aberto ? 'true' : undefined}
                    className={`w-full rounded-md border px-4 py-3 text-left transition ${
                      aberto
                        ? 'border-brand bg-brand-soft'
                        : 'border-line bg-surface hover:border-accent hover:bg-accent-soft'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold">{p.name}</span>
                      <span className="shrink-0 text-[11px] text-ink-dim">
                        {aberto ? 'Aberto agora' : data(p.created_at)}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink-soft">
                      {p.client?.name ?? 'Cliente removido'} · {p.location?.name ?? 'Local removido'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </dialog>
  )
}
