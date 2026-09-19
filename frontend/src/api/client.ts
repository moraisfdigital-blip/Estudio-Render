import axios from 'axios'

// Mesma origem: em produção o FastAPI serve o build e a API sob /api.
export const api = axios.create({ baseURL: '/api' })

export type Health = { status: string }

export async function getHealth(): Promise<Health> {
  const { data } = await api.get<Health>('/health')
  return data
}
