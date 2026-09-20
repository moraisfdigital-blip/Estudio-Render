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
  /** Fase 8: Architecture Lock do projeto. Nasce ligado. */
  architecture_lock: boolean
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
  /** Fase 8: quantos recortes de intervenção — é o que diz se dá para gerar. */
  intervention_count: number
  /** Fase 10: versão aprovada desta foto, ou nulo enquanto ninguém escolheu. */
  approved_version_id: string | null
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
  /** Fase 7: material/acabamento/marca resolvidos pelo servidor. */
  spec: ElementSpec
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

// ---- Fase 7: catálogo (material, acabamento, marca) -------------------
//
// A cor **nunca** é definida aqui. `color_hex` vem do acabamento cadastrado no
// servidor; este arquivo não tem paleta, mapa de cores nem valor padrão.
// Gerenciar catálogo é do owner: o editor lê a lista e aplica no elemento.

export type Material = {
  id: string
  tenant_id: string
  name: string
  description: string | null
  /** Quantos acabamentos este material já tem — a lista mostra sem abrir. */
  finish_count: number
  created_at: string
  updated_at: string
}

export type Finish = {
  id: string
  tenant_id: string
  material_id: string
  material_name: string
  name: string
  color_name: string
  color_hex: string
  description: string | null
  created_at: string
  updated_at: string
}

export type BrandLogo = {
  url: string
  filename: string
  content_type: string
  size_bytes: number
  checksum_sha256: string
  uploaded_at: string
}

export type Brand = {
  id: string
  tenant_id: string
  name: string
  description: string | null
  logo: BrandLogo | null
  created_at: string
  updated_at: string
}

/** Spec do elemento já resolvida contra o catálogo pelo servidor. */
export type ElementSpec = {
  material: { id: string; name: string } | null
  finish: { id: string; name: string; color_name: string; color_hex: string } | null
  brand: { id: string; name: string; logo_url: string | null } | null
  applied_at: string | null
  is_empty: boolean
}

export type MaterialInput = { name: string; description?: string }
export type FinishInput = {
  material_id: string
  name: string
  color_name: string
  color_hex: string
  description?: string
}
export type BrandInput = { name: string; description?: string }

/**
 * `null` num campo limpa aquele vínculo; campo ausente fica como está.
 * O servidor lê quais chaves vieram, então mandar `finish_id: null` é uma
 * instrução de apagar, não "não informado".
 */
export type SpecInput = {
  material_id?: string | null
  finish_id?: string | null
  brand_id?: string | null
}

export async function listMaterials(): Promise<Material[]> {
  const { data } = await api.get<Material[]>('/materials')
  return data
}

export async function createMaterial(input: MaterialInput): Promise<Material> {
  const { data } = await api.post<Material>('/materials', input)
  return data
}

export async function updateMaterial(
  id: string,
  input: Partial<MaterialInput>,
): Promise<Material> {
  const { data } = await api.patch<Material>(`/materials/${id}`, input)
  return data
}

export async function listFinishes(materialId?: string): Promise<Finish[]> {
  const { data } = await api.get<Finish[]>('/finishes', {
    params: materialId ? { material_id: materialId } : undefined,
  })
  return data
}

export async function createFinish(input: FinishInput): Promise<Finish> {
  const { data } = await api.post<Finish>('/finishes', input)
  return data
}

export async function updateFinish(
  id: string,
  input: Partial<Omit<FinishInput, 'material_id'>>,
): Promise<Finish> {
  const { data } = await api.patch<Finish>(`/finishes/${id}`, input)
  return data
}

export async function listBrands(): Promise<Brand[]> {
  const { data } = await api.get<Brand[]>('/brands')
  return data
}

export async function createBrand(input: BrandInput): Promise<Brand> {
  const { data } = await api.post<Brand>('/brands', input)
  return data
}

export async function updateBrand(id: string, input: Partial<BrandInput>): Promise<Brand> {
  const { data } = await api.patch<Brand>(`/brands/${id}`, input)
  return data
}

export async function uploadBrandLogo(brandId: string, file: File): Promise<Brand> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.put<Brand>(`/brands/${brandId}/logo`, form)
  return data
}

export async function applySpec(elementId: string, input: SpecInput): Promise<SurveyElement> {
  const { data } = await api.patch<SurveyElement>(`/elements/${elementId}/spec`, input)
  return data
}

/** Mesma razão do original da foto: a rota exige token, e `<img src>` não manda header. */
export async function fetchBrandLogoBlob(brandId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/brands/${brandId}/logo`, { responseType: 'blob' })
  return data
}

// ---- Fase 8: máscaras e Architecture Lock ----------------------------
// A máscara diz onde a geração PODE mexer (`intervention`) e onde ela NUNCA
// pode (`protect`). Nada é gerado aqui — a Fase 8 só estabelece o contrato que
// a Fase 9 vai obedecer.
//
// O veredito da geração (`generation_ready` + `blocked_reason`) vem pronto do
// SERVIDOR, com o mesmo texto que a API usará ao recusar. A tela não escreve
// motivo por conta própria: se a regra mudar, ela acompanha sozinha.

export type MaskKind = 'intervention' | 'protect'

/** Vértice em pixel da foto original (origem no canto superior esquerdo). */
export type MaskPoint = { x: number; y: number }

export type MaskLayer = {
  id: string
  kind: MaskKind
  /** Rótulo do tipo, pronto do servidor ("Intervenção" / "Proteção"). */
  kind_label: string
  label: string
  points: MaskPoint[]
  /** Área do polígono em px², calculada no servidor. */
  area_px: number
}

export type MasksState = {
  photo_id: string
  tenant_id: string
  /** `false` é o estado inicial normal da foto — "sem máscara", não erro. */
  masked: boolean
  layers: MaskLayer[]
  intervention_count: number
  protect_count: number
  image_width: number | null
  image_height: number | null
  architecture_lock: boolean
  generation_ready: boolean
  /** Por que a geração está bloqueada. Texto do servidor, exibido como veio. */
  blocked_reason: string | null
  updated_at: string | null
}

/** O que o cliente envia: só tipo, nome e vértices. Id e área são do servidor. */
export type MaskLayerInput = {
  kind: MaskKind
  label?: string
  points: MaskPoint[]
}

export async function getMasks(photoId: string): Promise<MasksState> {
  const { data } = await api.get<MasksState>(`/photos/${photoId}/masks`)
  return data
}

/** PUT substitui o conjunto inteiro: o que está na tela é o que fica no banco. */
export async function saveMasks(
  photoId: string,
  layers: MaskLayerInput[],
): Promise<MasksState> {
  const { data } = await api.put<MasksState>(`/photos/${photoId}/masks`, { layers })
  return data
}

/** Ligar/desligar o lock é do owner; a API recusa o editor com 403. */
export async function setArchitectureLock(
  projectId: string,
  enabled: boolean,
): Promise<Project> {
  const { data } = await api.patch<Project>(`/projects/${projectId}/architecture-lock`, {
    enabled,
  })
  return data
}

// ---- Fase 9: geração da proposta (mock) -------------------------------
// O POST não tem corpo: o pedido é montado no SERVIDOR a partir do que está
// persistido (elementos, specs do catálogo, máscaras). Não existe campo para
// mandar prompt — é o que impede contornar o Architecture Lock por parâmetro.
//
// E o que volta do provedor passa por composição antes de virar arquivo: só os
// pixels sob a máscara de intervenção sobrevivem.

export type ProposalStatus = 'pendente' | 'concluida' | 'falhou'

export type PromptPiece = {
  name: string
  kind: string | null
  /** Vem com a procedência colada ("medido em campo" / "estimativa"). */
  dimensions: string
  spec: string
}

export type Prompt = {
  text: string
  instrucao: string
  projeto: string
  intervencao: string[]
  protecao: string[]
  pecas: PromptPiece[]
  escala: string | null
}

export type GeneratedImage = {
  id: string
  photo_id: string
  proposal_id: string
  url: string
  content_type: string
  size_bytes: number
  checksum_sha256: string
  width: number
  height: number
  /** Alcance real da geração — nunca maior que a área da máscara. */
  changed_pixels: number
  provider: string
  created_at: string
}

export type Proposal = {
  id: string
  tenant_id: string
  photo_id: string
  project_id: string
  status: ProposalStatus
  status_label: string
  provider: string
  prompt: Prompt
  generated_image: GeneratedImage | null
  error: string | null
  created_at: string
  completed_at: string | null
}

export type Comparison = {
  photo_id: string
  original_url: string
  original_filename: string
  /** Nulo enquanto a foto não tem proposta concluída — estado normal. */
  generated: GeneratedImage | null
  proposal: Proposal | null
  proposal_count: number
}

export async function generateProposal(photoId: string): Promise<Proposal> {
  const { data } = await api.post<Proposal>(`/photos/${photoId}/proposals`)
  return data
}

export async function listProposals(photoId: string): Promise<Proposal[]> {
  const { data } = await api.get<Proposal[]>(`/photos/${photoId}/proposals`)
  return data
}

export async function getComparison(photoId: string): Promise<Comparison> {
  const { data } = await api.get<Comparison>(`/photos/${photoId}/compare`)
  return data
}

/** Mesma razão do original: a rota exige token, e `<img src>` não manda header. */
export async function fetchGeneratedImageBlob(imageId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/generated-images/${imageId}`, {
    responseType: 'blob',
  })
  return data
}

// ---- Fase 10: versões, comparação e aprovação -------------------------
// No máximo três versões por foto. O limite é do SERVIDOR (índice único
// parcial), então a tela mostra `limit_reached` em vez de recontar sozinha —
// e a quarta promoção é recusada mesmo em dois cliques simultâneos.
//
// Uma aprovada por foto: a escolha mora em `photos.approved_version_id`, e
// `approved` em cada versão é derivado dela.

export type Version = {
  id: string
  tenant_id: string
  photo_id: string
  project_id: string
  proposal_id: string
  /** 1 a 3 — a vaga que a versão ocupa. */
  position: number
  label: string
  notes: string | null
  generated_image: GeneratedImage | null
  approved: boolean
  created_at: string
}

export type VersionList = {
  photo_id: string
  versions: Version[]
  max_versions: number
  slots_left: number
  limit_reached: boolean
  approved_version_id: string | null
}

export type VersionComparison = {
  photo_id: string
  original_url: string
  versions: Version[]
}

export type VersionInput = {
  proposal_id: string
  label?: string
  notes?: string
}

export async function listVersions(photoId: string): Promise<VersionList> {
  const { data } = await api.get<VersionList>(`/photos/${photoId}/versions`)
  return data
}

export async function createVersion(photoId: string, input: VersionInput): Promise<Version> {
  const { data } = await api.post<Version>(`/photos/${photoId}/versions`, input)
  return data
}

export async function compareVersions(
  photoId: string,
  ids: string[],
): Promise<VersionComparison> {
  const { data } = await api.get<VersionComparison>(`/photos/${photoId}/versions/compare`, {
    params: { ids: ids.join(',') },
  })
  return data
}

/** Aprovar é do owner; a API recusa o editor com 403. */
export async function approveVersion(versionId: string): Promise<VersionList> {
  const { data } = await api.post<VersionList>(`/versions/${versionId}/approve`)
  return data
}

/** Descarta e devolve a vaga. A versão aprovada não pode ser descartada (422). */
export async function discardVersion(versionId: string): Promise<void> {
  await api.delete(`/versions/${versionId}`)
}
