import { useState } from 'react'
import { useAuth } from '../auth/context'
import DashboardPage from '../pages/DashboardPage'
import ProjectDetailPage from '../pages/ProjectDetailPage'
import ProjectFormPage from '../pages/ProjectFormPage'

/** Navegação por estado — o app ainda não tem rotas; entram quando houver URL a compartilhar. */
type View =
  | { kind: 'dashboard' }
  | { kind: 'new-project' }
  | { kind: 'project'; id: string }
  | { kind: 'edit-project'; id: string }

export default function AppShell() {
  const { state, signOut } = useAuth()
  const [view, setView] = useState<View>({ kind: 'dashboard' })

  if (state.kind !== 'authenticated') return null
  const { user, tenant } = state.session

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <button
            type="button"
            onClick={() => setView({ kind: 'dashboard' })}
            className="flex items-center gap-3 text-left"
          >
            <span className="text-sm font-semibold">Render Artelux</span>
            <span className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300">
              {tenant.name}
            </span>
          </button>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm leading-tight">{user.name}</p>
              <p className="text-xs leading-tight text-neutral-500">
                {user.email} · {user.role}
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100"
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
      </main>
    </div>
  )
}
