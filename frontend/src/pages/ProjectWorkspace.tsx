import { useCallback, useEffect } from 'react'
import { Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'

import { getProject } from '../api/client'
import PresentationPanel from '../components/PresentationPanel'
import TakeoffPanel from '../components/TakeoffPanel'
import Moldura from '../components/layout/Moldura'
import TrilhaEtapas from '../components/layout/TrilhaEtapas'
import { ErrorNotice, Loading } from '../components/ui'
import { useProjetoAtual } from '../contexts/ProjetoAtual'
import { useResource } from '../hooks/useResource'
import Levantamento from './Levantamento'

/**
 * A tela de um projeto: cabeçalho, trilha de passos e o trabalho do passo atual.
 *
 * Antes, os três painéis (levantamento, apresentação, orçamento) ficavam
 * empilhados numa rolagem só, e cinco modais abriam por cima. Agora cada passo
 * é uma rota, e a trilha diz onde você está.
 */

export function ProjectWorkspace() {
  const { projectId = '' } = useParams()
  const { definir } = useProjetoAtual()

  const carregar = useCallback(() => getProject(projectId), [projectId])
  const { resource, reload } = useResource(carregar, 'Não foi possível carregar o projeto.')

  // O cabeçalho mostra o nome do projeto, mas quem o carrega é esta tela.
  // Ao sair, limpa: um nome que ficou para trás no topo é pior que nenhum.
  const pronto = resource.kind === 'ready' ? resource.data : null
  useEffect(() => {
    definir(pronto)
    return () => definir(null)
  }, [pronto, definir])

  if (resource.kind === 'loading') {
    return (
      <Moldura>
        <Loading label="Carregando projeto…" />
      </Moldura>
    )
  }

  if (resource.kind === 'error') {
    return (
      <Moldura>
        <ErrorNotice message={resource.message} onRetry={reload} />
      </Moldura>
    )
  }

  return (
    <>
      <TrilhaEtapas projectId={projectId} />
      <Outlet context={{ projectId }} />
    </>
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
    <Levantamento projectId={projectId} />
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
    <Moldura>
      <div className="mx-auto max-w-xl rounded-xl border border-dashed border-line-accent bg-surface p-6 text-center">
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
    </Moldura>
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
    <Moldura>
      <div className="flex flex-col gap-2">
        <PresentationPanel projectId={projectId} />
        <TakeoffPanel projectId={projectId} />
      </div>
    </Moldura>
  )
}
