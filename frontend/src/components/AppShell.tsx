import { useAuth } from '../auth/context'

/** Shell autenticado: badge do workspace + identidade do usuário. */
export default function AppShell() {
  const { state, signOut } = useAuth()
  if (state.kind !== 'authenticated') return null
  const { user, tenant } = state.session

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Render Artelux</span>
            <span className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300">
              {tenant.name}
            </span>
          </div>

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
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Fase 2 — auth + tenant</p>
        <h1 className="mt-1 text-2xl font-semibold">Workspace {tenant.name}</h1>
        <p className="mt-4 max-w-prose text-sm text-neutral-400">
          Sessão autenticada. O dashboard de projetos entra na Fase 3 — toda entidade daqui em
          diante nasce escopada neste workspace.
        </p>
      </main>
    </div>
  )
}
