import { Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/context'
import { ProjetoAtualProvider } from '../../contexts/ProjetoAtual'
import Cabecalho from './Cabecalho'

/**
 * A moldura da aplicação, na estrutura do protótipo.
 *
 * Topo fixo com a marca, o nome do projeto e as ações; abaixo dele a faixa de
 * três cores; e o resto da altura é da tela de dentro, que decide se usa uma,
 * duas ou três colunas.
 *
 * ## Onde foi parar o menu lateral
 *
 * Ele não existe no protótipo: a coluna da esquerda ali é do trabalho
 * ("Elementos da obra"), não de navegação. Então "Novo projeto", "Meus
 * projetos" e "Materiais" subiram para o topo, que é onde o protótipo põe as
 * ações. Nada foi removido — só mudou de lugar.
 *
 * ## Marca
 *
 * ENBY PRO é o nome do produto e é o logo do topo. O nome do cliente dono da
 * conta aparece ao lado do usuário, à direita. São coisas diferentes.
 */
export default function AppLayout() {
  const { state } = useAuth()
  if (state.kind !== 'authenticated') return null

  return (
    <ProjetoAtualProvider>
      <div className="flex h-full flex-col bg-app">
        <Cabecalho />
        <Outlet />
      </div>
    </ProjetoAtualProvider>
  )
}
