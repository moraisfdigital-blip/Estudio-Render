import { createContext, useContext } from 'react'
import type { Tenant, User } from '../api/client'

export type Session = { user: User; tenant: Tenant }

export type AuthState =
  | { kind: 'hydrating' } // conferindo o token guardado
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; session: Session }

export type AuthValue = {
  state: AuthState
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth precisa estar dentro de <AuthProvider>.')
  return value
}
