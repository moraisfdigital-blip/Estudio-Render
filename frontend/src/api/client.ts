import axios from 'axios'

// Mesma origem: em produção o FastAPI serve o build e a API sob /api.
export const api = axios.create({ baseURL: '/api' })

// ---- token ------------------------------------------------------------

const TOKEN_KEY = 'render-artelux.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

// O token vai em todo request; o tenant vem dele no servidor, nunca do cliente.
api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** Mensagem exibível a partir de um erro do axios (o backend manda `detail`). */
export function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    // 422 do Pydantic: lista de erros por campo.
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0]
      if (typeof first?.msg === 'string') return first.msg
    }
    if (!error.response) return 'Não foi possível falar com o servidor.'
  }
  return fallback
}

// ---- tipos ------------------------------------------------------------

export type Health = { status: string }
export type Role = 'owner' | 'editor'
export type User = { id: string; tenant_id: string; email: string; name: string; role: Role }
export type Tenant = { id: string; slug: string; name: string }
export type TokenResponse = { access_token: string; token_type: string; user: User }

// ---- chamadas ---------------------------------------------------------

export async function getHealth(): Promise<Health> {
  const { data } = await api.get<Health>('/health')
  return data
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/login', { email, password })
  return data
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/register', { email, password, name })
  return data
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me')
  return data
}

export async function getCurrentTenant(): Promise<Tenant> {
  const { data } = await api.get<Tenant>('/tenants/current')
  return data
}
