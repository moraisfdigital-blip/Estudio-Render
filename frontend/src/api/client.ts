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

// ---- Fase 3: clientes, locais e projetos -----------------------------
// O `tenant_id` volta nos payloads só como confirmação: quem escopa é o servidor,
// a partir do token. O frontend nunca manda tenant em lugar nenhum.

export type Client = {
  id: string
  tenant_id: string
  name: string
  document: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  notes: string | null
}

export type Location = {
  id: string
  tenant_id: string
  name: string
  client_id: string | null
  address: string | null
  city: string | null
  state: string | null
  notes: string | null
}

export type ProjectStatus = 'levantamento' | 'projeto_visual' | 'apresentacao' | 'concluido'

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'levantamento', label: 'Levantamento' },
  { value: 'projeto_visual', label: 'Projeto visual' },
  { value: 'apresentacao', label: 'Apresentação' },
  { value: 'concluido', label: 'Concluído' },
]

export type Related = { id: string; name: string }

export type Project = {
  id: string
  tenant_id: string
  name: string
  status: ProjectStatus
  status_label: string
  description: string | null
  client: Related | null
  location: Related | null
  created_at: string
  updated_at: string
}

export type ClientInput = {
  name: string
  document?: string
  contact_name?: string
  email?: string
  phone?: string
  notes?: string
}

export type LocationInput = {
  name: string
  client_id?: string | null
  address?: string
  city?: string
  state?: string
  notes?: string
}

export type ProjectInput = {
  name: string
  client_id: string
  location_id: string
  status?: ProjectStatus
  description?: string
}

export async function listClients(): Promise<Client[]> {
  const { data } = await api.get<Client[]>('/clients')
  return data
}

export async function createClient(input: ClientInput): Promise<Client> {
  const { data } = await api.post<Client>('/clients', input)
  return data
}

export async function updateClient(id: string, input: Partial<ClientInput>): Promise<Client> {
  const { data } = await api.patch<Client>(`/clients/${id}`, input)
  return data
}

export async function listLocations(): Promise<Location[]> {
  const { data } = await api.get<Location[]>('/locations')
  return data
}

export async function createLocation(input: LocationInput): Promise<Location> {
  const { data } = await api.post<Location>('/locations', input)
  return data
}

export async function updateLocation(id: string, input: Partial<LocationInput>): Promise<Location> {
  const { data } = await api.patch<Location>(`/locations/${id}`, input)
  return data
}

export async function listProjects(): Promise<Project[]> {
  const { data } = await api.get<Project[]>('/projects')
  return data
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const { data } = await api.post<Project>('/projects', input)
  return data
}

export async function getProject(id: string): Promise<Project> {
  const { data } = await api.get<Project>(`/projects/${id}`)
  return data
}

export async function updateProject(id: string, input: Partial<ProjectInput>): Promise<Project> {
  const { data } = await api.patch<Project>(`/projects/${id}`, input)
  return data
}

// ---- Fase 4: áreas e fotos -------------------------------------------
// O original é imutável: a API só cria e lê binário. Remover uma foto tira o
// registro do levantamento — o arquivo original continua no storage.

export type Area = {
  id: string
  tenant_id: string
  project_id: string
  name: string
  description: string | null
  photo_count: number
  created_at: string
  updated_at: string
}

export type Photo = {
  id: string
  tenant_id: string
  area_id: string
  project_id: string
  original_filename: string
  content_type: string
  size_bytes: number
  checksum_sha256: string
  created_at: string
  original_url: string
}

/** Limites de upload publicados pelo servidor — nada de tamanho/tipo chumbado aqui. */
export type MediaLimits = {
  max_upload_mb: number
  accepted_content_types: string[]
  accepted_labels: string[]
}

export type AreaInput = { name: string; description?: string }

export async function getMediaLimits(): Promise<MediaLimits> {
  const { data } = await api.get<MediaLimits>('/media/limits')
  return data
}

export async function listAreas(projectId: string): Promise<Area[]> {
  const { data } = await api.get<Area[]>(`/projects/${projectId}/areas`)
  return data
}

export async function createArea(projectId: string, input: AreaInput): Promise<Area> {
  const { data } = await api.post<Area>(`/projects/${projectId}/areas`, input)
  return data
}

export async function listAreaPhotos(areaId: string): Promise<Photo[]> {
  const { data } = await api.get<Photo[]>(`/areas/${areaId}/photos`)
  return data
}

/**
 * Sobe uma foto. `onProgress` recebe 0..100 para a barra de progresso —
 * levantamento é feito em campo, com foto grande e rede ruim; a tela precisa
 * mostrar que algo está acontecendo.
 */
export async function uploadPhoto(
  areaId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Photo> {
  const body = new FormData()
  body.append('file', file)
  const { data } = await api.post<Photo>(`/areas/${areaId}/photos`, body, {
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return
      onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })
  return data
}

export async function deletePhoto(photoId: string): Promise<void> {
  await api.delete(`/photos/${photoId}`)
}

/**
 * Baixa o binário do original como blob.
 *
 * O `<img src>` puro não carrega o header Authorization, e a rota do original
 * exige token — então a miniatura busca os bytes por aqui e vira object URL.
 */
export async function fetchPhotoBlob(photoId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/photos/${photoId}/original`, { responseType: 'blob' })
  return data
}
