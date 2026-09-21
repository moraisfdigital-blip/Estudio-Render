import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  getCurrentTenant,
  getMe,
  getToken,
  logout,
  login as loginRequest,
  register as registerRequest,
  setToken,
} from '../api/client'
import { AuthContext, type AuthState } from './context'

/**
 * Entrada automática de desenvolvimento.
 *
 * Existe para olhar a interface sem digitar senha a cada visita. As credenciais
 * vêm de `frontend/.env.local`, que o git ignora; sem o arquivo, isto devolve
 * `null` e a tela de entrada funciona como sempre.
 *
 * `import.meta.env.DEV` é `false` no build de produção, e o Vite apaga o bloco
 * inteiro ao compilar — não existe caminho em que isto rode no ar. Não é uma
 * porta dos fundos: é o `vite dev` desta máquina.
 */
function credenciaisDeDesenvolvimento(): { email: string; senha: string } | null {
  if (!import.meta.env.DEV) return null
  const email = import.meta.env.VITE_DEV_AUTOLOGIN_EMAIL
  const senha = import.meta.env.VITE_DEV_AUTOLOGIN_SENHA
  return email && senha ? { email, senha } : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    getToken() || credenciaisDeDesenvolvimento() ? { kind: 'hydrating' } : { kind: 'anonymous' },
  )

  /** Carrega usuário + tenant do token corrente. */
  const loadSession = useCallback(async () => {
    const [user, tenant] = await Promise.all([getMe(), getCurrentTenant()])
    setState({ kind: 'authenticated', session: { user, tenant } })
  }, [])

  // Hidratação na abertura: sincroniza o token guardado com a API.
  // Token expirado/inválido volta para a tela de login.
  useEffect(() => {
    const dev = credenciaisDeDesenvolvimento()
    if (!getToken() && !dev) return
    let alive = true
    void (async () => {
      try {
        if (!getToken() && dev) {
          const { access_token } = await loginRequest(dev.email, dev.senha)
          setToken(access_token)
        }
        await loadSession()
      } catch {
        if (!alive) return
        setToken(null)
        // Token vencido com entrada automática ligada: entra de novo em vez de
        // devolver a tela de senha, que é justamente o que se quer evitar.
        if (dev) {
          try {
            const { access_token } = await loginRequest(dev.email, dev.senha)
            setToken(access_token)
            await loadSession()
            return
          } catch {
            // Servidor fora do ar ou senha mudou: cai na tela normal.
          }
        }
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

  const signOut = useCallback(async () => {
    // Avisa o servidor primeiro, para o token ser revogado de verdade. Se a
    // chamada falhar (rede fora, token já expirado), a sessão local sai do ar
    // mesmo assim: prender alguém numa tela logada porque o logout remoto não
    // respondeu seria pior do que o risco que ele cobre.
    try {
      await logout()
    } catch {
      // Silencioso de propósito: ver "erro ao sair" não muda nada para quem
      // está saindo.
    }
    setToken(null)
    setState({ kind: 'anonymous' })
  }, [])

  const value = useMemo(
    () => ({ state, signIn, signUp, signOut }),
    [state, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
