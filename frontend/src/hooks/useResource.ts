import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../api/client'

/** Estados que toda tela desta fase precisa tratar: carregando, erro e pronto. */
export type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T }

export function useResource<T>(load: () => Promise<T>, fallbackError: string) {
  const [resource, setResource] = useState<Resource<T>>({ kind: 'loading' })
  // Contador de tentativas: o efeito busca, o botão "tentar de novo" só incrementa.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const data = await load()
        if (alive) setResource({ kind: 'ready', data })
      } catch (error) {
        if (alive) setResource({ kind: 'error', message: errorMessage(error, fallbackError) })
      }
    })()
    return () => {
      alive = false
    }
  }, [load, fallbackError, attempt])

  const reload = useCallback(() => {
    setResource({ kind: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  /** Atualiza o dado em memória sem novo request (ex.: item recém-criado). */
  const patch = useCallback((update: (current: T) => T) => {
    setResource((current) =>
      current.kind === 'ready' ? { kind: 'ready', data: update(current.data) } : current,
    )
  }, [])

  return { resource, reload, patch }
}
