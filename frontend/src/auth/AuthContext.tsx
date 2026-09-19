import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  getCurrentTenant,
  getMe,
  getToken,
  login as loginRequest,
  register as registerRequest,
  setToken,
} from '../api/client'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    getToken() ? { kind: 'hydrating' } : { kind: 'anonymous' },
  )

  /** Carrega usuário + tenant do token corrente. */
  const loadSession = useCallback(async () => {
    const [user, tenant] = await Promise.all([getMe(), getCurrentTenant()])
    setState({ kind: 'authenticated', session: { user, tenant } })
  }, [])

  // Hidratação na abertura: sincroniza o token guardado com a API.
  // Token expirado/inválido volta para a tela de login.
  useEffect(() => {
    if (!getToken()) return
    let alive = true
    void (async () => {
      try {
        await loadSession()
      } catch {
        if (!alive) return
        setToken(null)
        setState({ kind: 'anonymous' })
      }
    })()
    return () => {
      alive = false
    }
  }, [loadSession])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await loginRequest(email, password)
      setToken(access_token)
      await loadSession()
    },
    [loadSession],
  )

  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      const { access_token } = await registerRequest(email, password, name)
      setToken(access_token)
      await loadSession()
    },
    [loadSession],
  )

  const signOut = useCallback(() => {
    setToken(null)
    setState({ kind: 'anonymous' })
  }, [])

  const value = useMemo(
    () => ({ state, signIn, signUp, signOut }),
    [state, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
