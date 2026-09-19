import { useCallback, useState } from 'react'
import {
  createProject,
  errorMessage,
  getProject,
  listClients,
  listLocations,
  updateProject,
  PROJECT_STATUSES,
  type Client,
  type Location,
  type Project,
  type ProjectStatus,
} from '../api/client'
import { ClientPicker, LocationPicker } from '../components/pickers'
import { Button, ErrorNotice, Field, inputClass, Loading } from '../components/ui'
import { useResource } from '../hooks/useResource'

type FormData = {
  clients: Client[]
  locations: Location[]
  project: Project | null
}

/** Cria e edita projeto. Sem `projectId` é criação; com, é edição do mesmo formulário. */
export default function ProjectFormPage({
  projectId,
  onDone,
  onCancel,
}: {
  projectId?: string
  onDone: (project: Project) => void
  onCancel: () => void
}) {
  const load = useCallback(async (): Promise<FormData> => {
    const [clients, locations, project] = await Promise.all([
      listClients(),
      listLocations(),
      projectId ? getProject(projectId) : Promise.resolve(null),
    ])
    return { clients, locations, project }
  }, [projectId])

  const { resource, reload, patch } = useResource(
    load,
    'Não foi possível carregar o formulário.',
  )

  if (resource.kind === 'loading') return <Loading label="Carregando formulário…" />
  if (resource.kind === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <ErrorNotice message={resource.message} onRetry={reload} />
        <Button variant="quiet" type="button" onClick={onCancel} className="self-start px-0">
          ← Voltar para os projetos
        </Button>
      </div>
    )
  }

  return (
    <Form
      data={resource.data}
      projectId={projectId}
      onDone={onDone}
      onCancel={onCancel}
      onClientCreated={(client) =>
        patch((current) => ({ ...current, clients: [...current.clients, client] }))
      }
      onLocationCreated={(location) =>
        patch((current) => ({ ...current, locations: [...current.locations, location] }))
      }
    />
  )
}

function Form({
  data,
  projectId,
  onDone,
  onCancel,
  onClientCreated,
  onLocationCreated,
}: {
  data: FormData
  projectId?: string
  onDone: (project: Project) => void
  onCancel: () => void
  onClientCreated: (client: Client) => void
  onLocationCreated: (location: Location) => void
}) {
  const existing = data.project
  const [name, setName] = useState(existing?.name ?? '')
  const [clientId, setClientId] = useState(existing?.client?.id ?? '')
  const [locationId, setLocationId] = useState(existing?.location?.id ?? '')
  const [status, setStatus] = useState<ProjectStatus>(existing?.status ?? 'levantamento')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = name.trim().length > 0 && clientId !== '' && locationId !== ''

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || saving) return

    setSaving(true)
    setError(null)
    try {
      const payload = { name, client_id: clientId, location_id: locationId, status, description }
      const saved = projectId
        ? await updateProject(projectId, payload)
        : await createProject(payload)
      onDone(saved)
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível salvar o projeto.'))
      setSaving(false)
    }
  }

  return (
    <section>
      <Button variant="quiet" type="button" onClick={onCancel} className="px-0">
        ← Projetos
      </Button>
      <h1 className="mt-2 text-2xl font-semibold">
        {projectId ? 'Editar projeto' : 'Novo projeto'}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Um projeto é o container do fluxo: cliente, local e, nas próximas fases, fotos e proposta.
      </p>

      <form onSubmit={submit} className="mt-8 flex max-w-xl flex-col gap-5">
        <Field label="Nome do projeto" htmlFor="project-name" required>
          <input
            id="project-name"
            className={inputClass}
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Retrofit da fachada 2026"
          />
        </Field>

        <ClientPicker
          clients={data.clients}
          value={clientId}
          onChange={setClientId}
          onCreated={onClientCreated}
          disabled={saving}
        />

        <LocationPicker
          locations={data.locations}
          value={locationId}
          onChange={setLocationId}
          onCreated={onLocationCreated}
          clientId={clientId}
          disabled={saving}
        />

        <Field label="Etapa" htmlFor="project-status">
          <select
            id="project-status"
            className={inputClass}
            value={status}
            disabled={saving}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
          >
            {PROJECT_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Observações" htmlFor="project-description">
          <textarea
            id="project-description"
            rows={4}
            className={inputClass}
            value={description}
            disabled={saving}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Escopo combinado, restrições de acesso, prazos…"
          />
        </Field>

        {error && <ErrorNotice message={error} />}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!ready || saving}>
            {saving ? 'Salvando…' : projectId ? 'Salvar alterações' : 'Criar projeto'}
          </Button>
          <Button variant="ghost" type="button" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        </div>
        {!ready && (
          <p className="text-xs text-neutral-600">
            Nome, cliente e local são obrigatórios — o projeto não existe sem os três.
          </p>
        )}
      </form>
    </section>
  )
}
