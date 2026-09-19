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
  /** Fase 5: já tem escala? O grid mostra "não calibrado" sem abrir foto por foto. */
  calibrated: boolean
  /** Fase 6: quantos elementos já foram marcados nesta foto. */
  element_count: number
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

// ---- Fase 5: calibração de escala ------------------------------------
// Dois pontos que o usuário marcou sobre a foto original + a medida real que
// ele informou. O fator `pixels_per_unit` é calculado no SERVIDOR e só volta de
// lá: o frontend nunca envia escala pronta, e nada aqui preenche `real_length`
// sozinho — medida é informação humana, nunca estimada.

export type CalibrationUnit = 'm' | 'cm'

export const CALIBRATION_UNITS: { value: CalibrationUnit; label: string; short: string }[] = [
  { value: 'm', label: 'metros', short: 'm' },
  { value: 'cm', label: 'centímetros', short: 'cm' },
]

/** Coordenada em pixels da foto original (origem no canto superior esquerdo). */
export type CalibrationPoint = { x: number; y: number }

export type Calibration = {
  photo_id: string
  tenant_id: string
  /** `false` é o estado inicial normal da foto — "não calibrado", não erro. */
  calibrated: boolean
  point_a: CalibrationPoint | null
  point_b: CalibrationPoint | null
  real_length: number | null
  unit: string | null
  pixel_distance: number | null
  pixels_per_unit: number | null
  pixels_per_meter: number | null
  /** Sempre `user_measured` quando calibrado. */
  source: string | null
  image_width: number | null
  image_height: number | null
  updated_at: string | null
}

export type CalibrationInput = {
  point_a: CalibrationPoint
  point_b: CalibrationPoint
  real_length: number
  unit: CalibrationUnit
}

export async function getCalibration(photoId: string): Promise<Calibration> {
  const { data } = await api.get<Calibration>(`/photos/${photoId}/calibration`)
  return data
}

export async function saveCalibration(
  photoId: string,
  input: CalibrationInput,
): Promise<Calibration> {
  const { data } = await api.put<Calibration>(`/photos/${photoId}/calibration`, input)
  return data
}

// ---- Fase 6: elementos e medidas -------------------------------------
// Um elemento é a peça a intervir, marcada como retângulo sobre a foto
// original. Toda medida carrega `source`: `user_measured` ou `estimated`, e a
// tela é obrigada a mostrar o rótulo. Nada aqui preenche medida sozinho — o
// `scale_estimate` que vem do servidor é sugestão rotulada, não medida salva.

export type ElementKind = 'placa' | 'faixa' | 'letra_caixa' | 'adesivo' | 'totem' | 'outro'

export const ELEMENT_KINDS: { value: ElementKind; label: string }[] = [
  { value: 'placa', label: 'Placa' },
  { value: 'faixa', label: 'Faixa' },
  { value: 'letra_caixa', label: 'Letra caixa' },
  { value: 'adesivo', label: 'Adesivo' },
  { value: 'totem', label: 'Totem' },
  { value: 'outro', label: 'Outro' },
]

export type MeasurementSource = 'user_measured' | 'estimated'

export const MEASUREMENT_SOURCES: { value: MeasurementSource; label: string; hint: string }[] = [
  { value: 'user_measured', label: 'Medido em campo', hint: 'Número que saiu da trena.' },
  { value: 'estimated', label: 'Estimativa', hint: 'Aproximação — fica rotulada como tal.' },
]

/** Retângulo em pixels da foto original (origem no canto superior esquerdo). */
export type ElementBox = { x: number; y: number; width: number; height: number }

export type Measurement = {
  value: number
  source: MeasurementSource
  /** Rótulo pronto do servidor: a tela não exibe valor sem a origem do lado. */
  source_label: string
}

export type Measurements = {
  unit: string | null
  width: Measurement | null
  height: Measurement | null
  depth: Measurement | null
  measured_at: string | null
  /** Alguma dimensão salva é estimativa? A lista rotula sem abrir o elemento. */
  has_estimate: boolean
}

export type ElementConference = { status: 'pendente' | 'conferido'; at: string | null }

/**
 * Sugestão derivada do retângulo + calibração da foto. **Não é medida salva.**
 * Vem sempre com `source: 'estimated'` e só entra no elemento se o usuário
 * mandar salvar — aí como estimativa, nunca como medida de campo.
 */
export type ScaleEstimate = {
  unit: string
  source: 'estimated'
  width: number
  height: number
}

export type SurveyElement = {
  id: string
  tenant_id: string
  photo_id: string
  area_id: string
  project_id: string
  name: string
  kind: ElementKind
  kind_label: string
  box: ElementBox
  notes: string | null
  measurements: Measurements
  conference: ElementConference
  /** Ausente quando a foto não está calibrada: sem escala não há o que estimar. */
  scale_estimate: ScaleEstimate | null
  created_at: string
  updated_at: string
}

export type ElementInput = {
  name: string
  kind: ElementKind
  box: ElementBox
  notes?: string
}

export type MeasurementInput = { value: number; source: MeasurementSource }

export type MeasurementsInput = {
  unit: CalibrationUnit
  width?: MeasurementInput
  height?: MeasurementInput
  depth?: MeasurementInput
}

export async function listElements(photoId: string): Promise<SurveyElement[]> {
  const { data } = await api.get<SurveyElement[]>(`/photos/${photoId}/elements`)
  return data
}

export async function createElement(
  photoId: string,
  input: ElementInput,
): Promise<SurveyElement> {
  const { data } = await api.post<SurveyElement>(`/photos/${photoId}/elements`, input)
  return data
}

export async function updateElement(
  elementId: string,
  input: Partial<ElementInput>,
): Promise<SurveyElement> {
  const { data } = await api.patch<SurveyElement>(`/elements/${elementId}`, input)
  return data
}

export async function deleteElement(elementId: string): Promise<void> {
  await api.delete(`/elements/${elementId}`)
}

export async function saveMeasurements(
  elementId: string,
  input: MeasurementsInput,
): Promise<SurveyElement> {
  const { data } = await api.put<SurveyElement>(`/elements/${elementId}/measurements`, input)
  return data
}

export async function setConference(
  elementId: string,
  status: ElementConference['status'],
): Promise<SurveyElement> {
  const { data } = await api.post<SurveyElement>(`/elements/${elementId}/conference`, { status })
  return data
}
