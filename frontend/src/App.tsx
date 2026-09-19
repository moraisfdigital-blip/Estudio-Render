import { useEffect, useState } from 'react'
import { getHealth } from './api/client'

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; status: string }
  | { kind: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    getHealth()
      .then((health) => alive && setState({ kind: 'ok', status: health.status }))
      .catch((error: unknown) => {
        if (!alive) return
        const message = error instanceof Error ? error.message : 'Falha ao consultar a API'
        setState({ kind: 'error', message })
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Fase 1 — esqueleto</p>
          <h1 className="text-2xl font-semibold">Render Artelux</h1>
        </header>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-sm text-neutral-400 mb-2">GET /api/health</p>
          {state.kind === 'loading' && <p className="text-neutral-300">Consultando a API…</p>}
          {state.kind === 'ok' && (
            <p className="font-mono text-emerald-400">{'{ status: "' + state.status + '" }'}</p>
          )}
          {state.kind === 'error' && <p className="text-red-400">{state.message}</p>}
        </section>

        <p className="text-xs text-neutral-600">
          Placeholder. O visual final entra quando o design estiver fechado.
        </p>
      </div>
    </main>
  )
}
