import { useCallback } from 'react'
import { getProject } from '../api/client'
import { Button, ErrorNotice, Loading } from '../components/ui'
import { useResource } from '../hooks/useResource'
import PresentationPanel from '../components/PresentationPanel'
import SurveyPanel from './SurveyPanel'
import TakeoffPanel from '../components/TakeoffPanel'

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3 sm:flex-row sm:gap-6">
      <dt className="w-40 shrink-0 text-sm text-ink-dim">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  )
}

export default function ProjectDetailPage({
  projectId,
  onBack,
  onEdit,
}: {
  projectId: string
  onBack: () => void
  onEdit: () => void
}) {
  const load = useCallback(() => getProject(projectId), [projectId])
  const { resource, reload } = useResource(load, 'Não foi possível carregar o projeto.')

  return (
    <section>
      <Button variant="quiet" type="button" onClick={onBack} className="px-0">
        ← Projetos
      </Button>

      {resource.kind === 'loading' && <Loading label="Carregando projeto…" />}
      {resource.kind === 'error' && (
        <div className="mt-4">
          <ErrorNotice message={resource.message} onRetry={reload} />
        </div>
      )}

      {resource.kind === 'ready' && (
        <>
          <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{resource.data.name}</h1>
              <span className="mt-2 inline-block rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-soft">
                {resource.data.status_label}
              </span>
            </div>
            <Button type="button" onClick={onEdit}>
              Editar
            </Button>
          </header>

          <dl className="mt-8 max-w-xl">
            <Row label="Cliente" value={resource.data.client?.name ?? 'Cliente removido'} />
            <Row label="Local" value={resource.data.location?.name ?? 'Local removido'} />
            <Row label="Observações" value={resource.data.description || '—'} />
            <Row
              label="Criado em"
              value={dateTimeFormat.format(new Date(resource.data.created_at))}
            />
            <Row
              label="Atualizado em"
              value={dateTimeFormat.format(new Date(resource.data.updated_at))}
            />
          </dl>

          <SurveyPanel projectId={resource.data.id} />

          <PresentationPanel projectId={resource.data.id} />

          <TakeoffPanel projectId={resource.data.id} />
        </>
      )}
    </section>
  )
}
