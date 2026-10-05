import { Navigate } from 'react-router-dom'
import { listProjects } from '../api/client'
import { ErrorNotice, Loading } from '../components/ui'
import { ultimoProjeto } from '../contexts/ultimoProjeto'
import { useResource } from '../hooks/useResource'

/**
 * A entrada abre o painel oficial — a tela do protótipo — e nada mais.
 *
 * Com projetos, abre o último usado neste navegador (ou o mais recente). Sem
 * nenhum, abre o painel com o exemplo do protótipo; criar projeto é escolha
 * de quem usa, pelo "＋ Novo projeto" do topo. Não há tela de lista nem
 * formulário à parte.
 */
export default function Inicio() {
  const { resource, reload } = useResource(listProjects, 'Não foi possível carregar os projetos.')

  if (resource.kind === 'loading') return <Loading label="Abrindo o estúdio…" />

  if (resource.kind === 'error') {
    return (
      <div className="mx-auto mt-16 w-full max-w-[480px] px-4">
        <ErrorNotice message={resource.message} onRetry={reload} />
      </div>
    )
  }

  const projetos = resource.data
  if (projetos.length === 0) return <Navigate to="/estudio/levantamento" replace />

  const lembrado = ultimoProjeto()
  // A API devolve do mais recente para o mais antigo.
  const alvo = projetos.find((p) => p.id === lembrado) ?? projetos[0]
  return <Navigate to={`/projeto/${alvo.id}/levantamento`} replace />
}
