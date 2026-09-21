import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Layers, LogOut, Moon, Plus, Sun } from 'lucide-react'
import { updateProject } from '../../api/client'
import { useAuth } from '../../auth/context'
import { useProjetoAtual } from '../../contexts/ProjetoAtual'
import { useTema } from '../../hooks/useTema'
import Marca from './Marca'

/**
 * O topo da aplicação, na estrutura do protótipo.
 *
 * Três blocos, da esquerda para a direita: a marca (190×70), o nome do projeto
 * — editável ali mesmo, separado por um filete vertical — e as ações. Abaixo
 * de tudo, a faixa de 2px com as três cores da marca.
 *
 * O nome edita no lugar porque é assim no protótipo, e porque abrir uma tela
 * inteira para trocar uma palavra é desproporcional. Só salva quando o texto
 * mudou de verdade: sair do campo sem mexer não gera requisição.
 */

function NomeDoProjeto() {
  const { projeto, definir } = useProjetoAtual()
  const [rascunho, setRascunho] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const original = useRef('')

  useEffect(() => {
    setRascunho(projeto?.name ?? '')
    original.current = projeto?.name ?? ''
    setErro(null)
  }, [projeto])

  if (!projeto) return null

  async function salvar() {
    const nome = rascunho.trim()
    if (!projeto || !nome || nome === original.current) {
      setRascunho(original.current)
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      const atualizado = await updateProject(projeto.id, { name: nome })
      original.current = atualizado.name
      definir(atualizado)
    } catch {
      // O nome volta ao que era: deixar na tela um nome que não foi salvo
      // seria pior do que não ter editado.
      setRascunho(original.current)
      setErro('Não foi possível salvar o nome.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="min-w-0 flex-1 border-l border-line pl-6">
      <input
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => void salvar()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setRascunho(original.current)
            e.currentTarget.blur()
          }
        }}
        disabled={salvando}
        aria-label="Nome do projeto"
        className="w-full border-0 bg-transparent p-0 text-[15px] font-semibold text-ink outline-none disabled:opacity-60"
      />
      <p className="mt-1.5 truncate text-xs text-ink-dim">
        {erro ? (
          <span className="text-bad">{erro}</span>
        ) : (
          <>
            {projeto.client?.name ?? 'Cliente removido'} ·{' '}
            {projeto.location?.name ?? 'Local removido'}
          </>
        )}
      </p>
    </div>
  )
}

function BotaoTopo({
  children,
  onClick,
  principal = false,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  principal?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`shrink-0 rounded-md border px-[15px] py-[10px] text-sm font-medium transition ${
        principal
          ? 'border-brand bg-brand text-brand-ink hover:border-brand-hover hover:bg-brand-hover'
          : 'border-line-accent bg-surface text-ink-soft hover:border-accent hover:bg-accent-soft'
      }`}
    >
      {children}
    </button>
  )
}

export default function Cabecalho() {
  const { state, signOut } = useAuth()
  const { tema, alternar } = useTema()
  const { projeto } = useProjetoAtual()
  const navigate = useNavigate()

  const usuario = state.kind === 'authenticated' ? state.session.user : null
  const tenant = state.kind === 'authenticated' ? state.session.tenant : null

  return (
    <header className="relative shrink-0 bg-surface">
      <div className="flex h-[88px] items-center gap-3.5 px-7">
        <button
          type="button"
          onClick={() => navigate('/projetos')}
          className="shrink-0"
          aria-label="Ir para os projetos"
        >
          <Marca className="h-[70px] w-[190px]" />
        </button>

        <NomeDoProjeto />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <BotaoTopo onClick={() => navigate('/projeto/novo')}>＋ Novo projeto</BotaoTopo>
          <BotaoTopo onClick={() => navigate('/projetos')} title="Meus projetos">
            <FolderOpen size={16} strokeWidth={1.75} className="inline" />
          </BotaoTopo>
          {usuario?.role === 'owner' && (
            <BotaoTopo onClick={() => navigate('/materiais')} title="Materiais (ACM)">
              <Layers size={16} strokeWidth={1.75} className="inline" />
            </BotaoTopo>
          )}
          {projeto && (
            <BotaoTopo principal onClick={() => navigate(`/projeto/${projeto.id}/entrega`)}>
              Apresentar projeto ↗
            </BotaoTopo>
          )}

          <span className="mx-1 h-8 w-px bg-line" aria-hidden="true" />

          <div className="hidden text-right lg:block">
            <p className="text-xs leading-tight font-medium text-ink">{usuario?.name}</p>
            <p className="text-[11px] leading-tight text-ink-dim">
              {tenant?.name} · {usuario?.role === 'owner' ? 'Owner' : 'Editor'}
            </p>
          </div>

          <button
            type="button"
            onClick={alternar}
            className="grid size-9 place-items-center rounded-md border border-line-accent text-ink-dim transition hover:border-accent hover:text-ink"
            aria-label={tema === 'claro' ? 'Mudar para o modo escuro' : 'Mudar para o modo claro'}
            title={tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
          >
            {tema === 'claro' ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="grid size-9 place-items-center rounded-md border border-line-accent text-ink-dim transition hover:border-accent hover:text-ink"
            aria-label="Sair"
            title="Sair"
          >
            <LogOut size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* A faixa de 2px com as três cores, exatamente nas proporções do
          protótipo: rosa até 43%, turquesa até 84%, laranja no resto. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 -bottom-px h-0.5"
        style={{
          background:
            'linear-gradient(90deg, var(--color-accent) 0 43%, var(--color-brand) 43% 84%, var(--color-warn) 84%)',
        }}
      />
    </header>
  )
}

export { BotaoTopo, Plus }
