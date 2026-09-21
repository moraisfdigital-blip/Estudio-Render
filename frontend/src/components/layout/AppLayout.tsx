import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CircleHelp, FolderOpen, Layers, LogOut, Moon, Plus, Sun } from 'lucide-react'
import { useAuth } from '../../auth/context'
import { useTema } from '../../hooks/useTema'
import Marca from './Marca'

/**
 * A moldura da aplicação: menu à esquerda, barra no topo, trabalho no meio.
 *
 * ## Por que menu lateral fixo
 *
 * O trabalho acontece dentro de **um** projeto por vez, e por isso a
 * área central é a que manda. O menu existe para trocar de projeto e chegar ao
 * catálogo — não para navegar a toda hora. Ele fica estreito e quieto.
 *
 * ## Marca
 *
 * ENBY PRO é o nome do produto e é o que aparece no menu. O nome que aparece
 * na etiqueta do topo é o do tenant — a empresa cliente dona daquela conta.
 * São coisas diferentes e não devem ser misturadas.
 *
 * ## O que não está aqui
 *
 * O protótipo tinha Biblioteca, Modelos, Textos e Exportações. Nenhum existe no
 * servidor: virariam telas vazias prometendo função que não há. Entram quando
 * houver o que mostrar.
 */

const ITENS = [
  { para: '/projeto/novo', rotulo: 'Novo projeto', Icone: Plus },
  { para: '/projetos', rotulo: 'Meus projetos', Icone: FolderOpen },
]

function ItemMenu({
  para,
  rotulo,
  Icone,
  destaque = false,
}: {
  para: string
  rotulo: string
  Icone: typeof Plus
  destaque?: boolean
}) {
  return (
    <NavLink
      to={para}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
          destaque
            ? 'bg-brand text-brand-ink hover:bg-brand-hover'
            : isActive
              ? 'bg-raised text-ink'
              : 'text-ink-soft hover:bg-raised/60 hover:text-ink'
        }`
      }
    >
      <Icone size={18} strokeWidth={1.75} aria-hidden="true" />
      {rotulo}
    </NavLink>
  )
}

export default function AppLayout() {
  const { state, signOut } = useAuth()
  const { tema, alternar } = useTema()
  const navigate = useNavigate()

  if (state.kind !== 'authenticated') return null
  const { user, tenant } = state.session

  const iniciais = user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join('')

  return (
    <div className="flex h-full bg-app">
      {/* ---------------- menu lateral ---------------- */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
        <button
          type="button"
          onClick={() => navigate('/projetos')}
          className="flex flex-col items-start gap-0.5 px-5 py-5 text-left"
        >
          <Marca className="text-lg leading-none" />
          <span className="text-[10px] tracking-[0.2em] text-ink-dim uppercase">
            Projeto visual
          </span>
        </button>

        <nav className="flex flex-col gap-1 px-3">
          {ITENS.map((item, indice) => (
            <ItemMenu key={item.para} {...item} destaque={indice === 0} />
          ))}

          {/* Cadastrar catálogo é do owner; o editor escolhe o que já existe
              de dentro do elemento e não precisa desta tela. */}
          {user.role === 'owner' && (
            <ItemMenu para="/materiais" rotulo="Materiais (ACM)" Icone={Layers} />
          )}
        </nav>

        <div className="mt-auto p-3">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-raised px-3 py-3">
            <CircleHelp size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-dim" />
            <div>
              <p className="text-sm text-ink-soft">Precisa de ajuda?</p>
              <p className="text-xs text-ink-dim">Fale com o suporte</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ---------------- coluna de trabalho ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-soft">
              {tenant.name}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight">{user.name}</p>
              <p className="text-xs leading-tight text-ink-dim">
                {user.role === 'owner' ? 'Owner' : 'Editor'}
              </p>
            </div>
            <button
              type="button"
              onClick={alternar}
              className="grid size-9 place-items-center rounded-lg border border-line text-ink-dim transition hover:border-ink-dim hover:text-ink"
              aria-label={tema === 'claro' ? 'Mudar para o modo escuro' : 'Mudar para o modo claro'}
              title={tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
            >
              {tema === 'claro' ? <Moon size={17} strokeWidth={1.75} /> : <Sun size={17} strokeWidth={1.75} />}
            </button>

            <span
              className="grid size-9 place-items-center rounded-full bg-raised text-xs font-semibold text-ink-soft"
              title={user.email}
            >
              {iniciais}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="grid size-9 place-items-center rounded-lg border border-line text-ink-dim transition hover:border-ink-dim hover:text-ink"
              aria-label="Sair"
              title="Sair"
            >
              <LogOut size={17} strokeWidth={1.75} />
            </button>
          </div>
        </header>

        {/* `min-h-0` é o que faz a rolagem acontecer aqui dentro, e não na página. */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
