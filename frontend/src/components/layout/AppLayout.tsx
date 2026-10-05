import { Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/context'
import { ProjetoAtualProvider } from '../../contexts/ProjetoAtual'

/**
 * A moldura da área logada.
 *
 * Não desenha cabeçalho próprio: o painel oficial é a tela do protótipo, que
 * já traz o topo (marca, nome do projeto, "Projetos", "＋ Novo projeto",
 * "Apresentar") e a barra das etapas com "Minha conta" e "Sair". Tudo que não
 * cabe no protótipo abre como janela por cima do painel — não há tela de
 * lista, formulário ou catálogo à parte.
 */
export default function AppLayout() {
  const { state } = useAuth()
  if (state.kind !== 'authenticated') return null

  return (
    <ProjetoAtualProvider>
      <div className="flex h-full flex-col bg-app">
        <Outlet />
      </div>
    </ProjetoAtualProvider>
  )
}
