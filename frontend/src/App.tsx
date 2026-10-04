import { useState } from 'react'
import {
  BrowserRouter,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Moldura from './components/layout/Moldura'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import CatalogPage from './pages/CatalogPage'
import Inicio from './pages/Inicio'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import {
  ProjectIndexRedirect,
  ProjectWorkspace,
  StepEntrega,
  StepEspecificacao,
  StepLevantamento,
  StepProposta,
} from './pages/ProjectWorkspace'

/**
 * Rotas da aplicação.
 *
 * Antes a navegação era uma variável de estado: não havia URL, então não dava
 * para mandar "abre esse projeto" para ninguém nem usar o botão voltar do
 * navegador. Agora cada tela tem endereço.
 *
 * As páginas existentes recebem os mesmos `props` de antes — os invólucros
 * abaixo traduzem parâmetro de rota em callback, para nenhuma delas precisar
 * conhecer o roteador.
 */

function MateriaisRoute() {
  const { state } = useAuth()
  const navigate = useNavigate()
  const podeGerenciar = state.kind === 'authenticated' && state.session.user.role === 'owner'
  return (
    <Moldura>
      <CatalogPage onBack={() => navigate('/')} canManage={podeGerenciar} />
    </Moldura>
  )
}

function Autenticado() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/materiais" element={<MateriaisRoute />} />
        {/* Endereço da antiga tela de formulário; sem isto "novo" seria lido
            como o id de um projeto. */}
        <Route path="/projeto/novo" element={<Inicio />} />

        <Route path="/projeto/:projectId" element={<ProjectWorkspace />}>
          <Route index element={<ProjectIndexRedirect />} />
          <Route path="levantamento" element={<StepLevantamento />} />
          <Route path="especificacao" element={<StepEspecificacao />} />
          <Route path="proposta" element={<StepProposta />} />
          <Route path="entrega" element={<StepEntrega />} />
        </Route>

        {/* Qualquer outro endereço (inclusive os antigos /projetos e
            /projeto/novo) cai na entrada, que abre a mesa de trabalho. */}
        <Route path="*" element={<Inicio />} />
      </Route>
    </Routes>
  )
}

function Anonimo() {
  const [tela, setTela] = useState<'login' | 'registro'>('login')
  return tela === 'login' ? (
    <LoginPage onGoToRegister={() => setTela('registro')} />
  ) : (
    <RegisterPage onGoToLogin={() => setTela('login')} />
  )
}

function Raiz() {
  const { state } = useAuth()

  if (state.kind === 'hydrating') {
    return (
      <main className="grid h-full place-items-center bg-app text-ink">
        <p className="text-sm text-ink-dim">Carregando sessão…</p>
      </main>
    )
  }

  return state.kind === 'authenticated' ? <Autenticado /> : <Anonimo />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Raiz />
      </AuthProvider>
    </BrowserRouter>
  )
}
