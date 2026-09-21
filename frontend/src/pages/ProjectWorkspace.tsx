import { useCallback } from 'react'
import { Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { getProject } from '../api/client'
import PresentationPanel from '../components/PresentationPanel'
import TakeoffPanel from '../components/TakeoffPanel'
import StepNav from '../components/layout/StepNav'
import { ErrorNotice, Loading } from '../components/ui'
import { useResource } from '../hooks/useResource'
import SurveyPanel from './SurveyPanel'

/**
 * A tela de um projeto: cabeçalho, trilha de passos e o trabalho do passo atual.
 *
 * Antes, os três painéis (levantamento, apresentação, orçamento) ficavam
 * empilhados numa rolagem só, e cinco modais abriam por cima. Agora cada passo
 * é uma rota, e a trilha diz onde você está.
 */

export function ProjectWorkspace() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()

  const carregar = useCallback(() => getProject(projectId), [projectId])
  const { resource, reload } = useResource(carregar, 'Não foi possível carregar o projeto.')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/projetos')}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-ink-dim transition hover:border-ink-dim hover:text-ink"
            aria-label="Voltar para os projetos"
          >
            <ArrowLeft size={16} strokeWidth={1.75} />
          </button>

          <div className="min-w-0">
            {resource.kind === 'ready' ? (
              <>
                <h1 className="truncate text-lg leading-tight font-semibold">
                  {resource.data.name}
                </h1>
                <p className="truncate text-xs text-ink-dim">
                  {resource.data.client?.name ?? 'Cliente removido'} ·{' '}
                  {resource.data.location?.name ?? 'Local removido'}
                </p>
              </>
            ) : (
              <h1 className="text-lg font-semibold text-ink-dim">Projeto</h1>
            )}
          </div>
        </div>

        {resource.kind === 'ready' && (
          <button
            type="button"
            onClick={() => navigate(`/projeto/${projectId}/editar`)}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft transition hover:border-ink-dim hover:text-ink"
          >
            <Pencil size={15} strokeWidth={1.75} />
            Editar
          </button>
        )}
      </div>

      <StepNav projectId={projectId} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {resource.kind === 'loading' && (
          <div className="p-6">
            <Loading label="Carregando projeto…" />
          </div>
        )}
        {resource.kind === 'error' && (
          <div className="p-6">
            <ErrorNotice message={resource.message} onRetry={reload} />
          </div>
        )}
        {resource.kind === 'ready' && <Outlet context={{ projectId }} />}
      </div>
    </div>
  )
}

/** Redireciona `/projeto/:id` para o primeiro passo. */
export function ProjectIndexRedirect() {
  const { projectId = '' } = useParams()
  return <Navigate to={`/projeto/${projectId}/levantamento`} replace />
}

export function StepLevantamento() {
  const { projectId = '' } = useParams()
  return (
    <div className="px-5 py-5">
      <SurveyPanel projectId={projectId} />
    </div>
  )
}

/**
 * Aviso dos passos que ainda não migraram.
 *
 * Não é uma tela vazia prometendo função inexistente: a função existe e está
 * funcionando — só ainda mora dentro dos botões da foto. O aviso diz onde ela
 * está agora e leva até lá, em vez de fingir que o passo está pronto.
 */
function EmMigracao({ titulo, descricao }: { titulo: string; descricao: string }) {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()

  return (
    <div className="px-5 py-5">
      <div className="mx-auto max-w-xl rounded-xl border border-dashed border-line bg-surface p-6 text-center">
        <h2 className="text-base font-semibold">{titulo}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{descricao}</p>
        <p className="mt-4 text-xs text-ink-dim">
          Estes controles já funcionam — hoje eles abrem pelos botões de cada foto, no passo 1.
          Eles ganham painel próprio na próxima etapa do redesenho.
        </p>
        <button
          type="button"
          onClick={() => navigate(`/projeto/${projectId}/levantamento`)}
          className="mt-5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:bg-brand-hover"
        >
          Ir para as fotos
        </button>
      </div>
    </div>
  )
}

export function StepEspecificacao() {
  return (
    <EmMigracao
      titulo="Especificação"
      descricao="Material, acabamento e cor de cada peça, e as áreas onde a geração pode mexer — com o resto da fachada protegido."
    />
  )
}

export function StepProposta() {
  return (
    <EmMigracao
      titulo="Proposta"
      descricao="Gerar a proposta visual, comparar com o original e promover até três versões para escolher uma."
    />
  )
}

export function StepEntrega() {
  const { projectId = '' } = useParams()
  return (
    <div className="flex flex-col gap-2 px-5 pb-8">
      <PresentationPanel projectId={projectId} />
      <TakeoffPanel projectId={projectId} />
    </div>
  )
}
