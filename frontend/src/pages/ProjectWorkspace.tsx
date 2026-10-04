import { lazy, Suspense, useCallback, useEffect } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'

import { getProject } from '../api/client'
import Moldura from '../components/layout/Moldura'
import { ErrorNotice, Loading } from '../components/ui'
import { useProjetoAtual } from '../contexts/ProjetoAtual'
import { lembrarProjeto } from '../contexts/ultimoProjeto'
import { useResource } from '../hooks/useResource'
const Levantamento = lazy(() => import('./Levantamento'))

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
    if (pronto) lembrarProjeto(pronto.id)
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
      <Suspense fallback={<Loading label="Carregando estúdio visual…" />}><Levantamento projectId={projectId} /></Suspense>
      <Outlet context={{ projectId }} />
    </>
  )
}

/** Redireciona `/projeto/:id` para o primeiro passo. */
export function ProjectIndexRedirect() {
  const { projectId = '' } = useParams()
  return <Navigate to={`/projeto/${projectId}/levantamento`} replace />
}

// The parent keeps the visual session alive; the existing routes select its tab.
export function StepLevantamento() { return null }
export function StepEspecificacao() { return null }
export function StepProposta() { return null }
export function StepEntrega() { return null }
