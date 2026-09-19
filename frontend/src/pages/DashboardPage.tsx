import { listProjects, type Project } from '../api/client'
import { Button, EmptyState, ErrorNotice, Loading } from '../components/ui'
import { useResource } from '../hooks/useResource'

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date)
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-lg border border-neutral-800 bg-neutral-900/40 px-5 py-4 text-left transition hover:border-neutral-600"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-base font-medium text-neutral-100">{project.name}</h3>
          <span className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300">
            {project.status_label}
          </span>
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          {/* Cliente/local podem faltar se o registro referenciado sumir — a lista não quebra. */}
          {project.client?.name ?? 'Cliente removido'}
          <span className="mx-2 text-neutral-700">·</span>
          {project.location?.name ?? 'Local removido'}
        </p>
        <p className="mt-1 text-xs text-neutral-600">Criado em {formatDate(project.created_at)}</p>
      </button>
    </li>
  )
}

export default function DashboardPage({
  onNewProject,
  onOpenProject,
}: {
  onNewProject: () => void
  onOpenProject: (id: string) => void
}) {
  const { resource, reload } = useResource(listProjects, 'Não foi possível carregar os projetos.')

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projetos</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Todos os levantamentos deste workspace.
          </p>
        </div>
        <Button type="button" onClick={onNewProject}>
          Novo projeto
        </Button>
      </header>

      <div className="mt-8">
        {resource.kind === 'loading' && <Loading label="Carregando projetos…" />}

        {resource.kind === 'error' && <ErrorNotice message={resource.message} onRetry={reload} />}

        {resource.kind === 'ready' &&
          (resource.data.length === 0 ? (
            <EmptyState
              title="Nenhum projeto ainda"
              description="Um projeto reúne o cliente, o local e — nas próximas fases — as fotos e a proposta visual."
              action={
                <Button type="button" onClick={onNewProject}>
                  Criar o primeiro projeto
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {resource.data.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => onOpenProject(project.id)}
                />
              ))}
            </ul>
          ))}
      </div>
    </section>
  )
}
