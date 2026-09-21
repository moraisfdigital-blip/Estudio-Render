import { useState } from 'react'
import { useAuth } from '../auth/context'
import CatalogPage from '../pages/CatalogPage'
import DashboardPage from '../pages/DashboardPage'
import ProjectDetailPage from '../pages/ProjectDetailPage'
import ProjectFormPage from '../pages/ProjectFormPage'

/** Navegação por estado — o app ainda não tem rotas; entram quando houver URL a compartilhar. */
type View =
  | { kind: 'dashboard' }
  | { kind: 'new-project' }
  | { kind: 'project'; id: string }
  | { kind: 'edit-project'; id: string }
  | { kind: 'catalog' }

export default function AppShell() {
  const { state, signOut } = useAuth()
  const [view, setView] = useState<View>({ kind: 'dashboard' })

  if (state.kind !== 'authenticated') return null
  const { user, tenant } = state.session

  return (
    <div className="min-h-dvh bg-app text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <button
            type="button"
            onClick={() => setView({ kind: 'dashboard' })}
            className="flex items-center gap-3 text-left"
          >
            <span className="text-sm font-semibold">ENBY PRO</span>
            <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-soft">
              {tenant.name}
            </span>
          </button>

          <div className="flex items-center gap-3">
            {/* Cadastrar catálogo é do owner; o editor escolhe o que já existe
                dentro do elemento e não precisa desta tela. */}
            {user.role === 'owner' && (
              <button
                type="button"
                onClick={() => setView({ kind: 'catalog' })}
                className="rounded-md px-3 py-1.5 text-sm text-ink-soft transition hover:text-ink"
              >
                Catálogo
              </button>
            )}
            <div className="text-right">
              <p className="text-sm leading-tight">{user.name}</p>
              <p className="text-xs leading-tight text-ink-dim">
                {user.email} · {user.role}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft transition hover:border-ink-dim hover:text-ink"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {view.kind === 'dashboard' && (
          <DashboardPage
            onNewProject={() => setView({ kind: 'new-project' })}
            onOpenProject={(id) => setView({ kind: 'project', id })}
          />
        )}

        {view.kind === 'new-project' && (
          <ProjectFormPage
            onDone={(project) => setView({ kind: 'project', id: project.id })}
            onCancel={() => setView({ kind: 'dashboard' })}
          />
        )}

        {view.kind === 'edit-project' && (
          <ProjectFormPage
            projectId={view.id}
            onDone={(project) => setView({ kind: 'project', id: project.id })}
            onCancel={() => setView({ kind: 'project', id: view.id })}
          />
        )}

        {view.kind === 'project' && (
          <ProjectDetailPage
            projectId={view.id}
            onBack={() => setView({ kind: 'dashboard' })}
            onEdit={() => setView({ kind: 'edit-project', id: view.id })}
          />
        )}

        {view.kind === 'catalog' && (
          <CatalogPage
            onBack={() => setView({ kind: 'dashboard' })}
            canManage={user.role === 'owner'}
          />
        )}
      </main>
    </div>
  )
}
