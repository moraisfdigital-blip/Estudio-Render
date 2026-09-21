import { useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Moldura from './components/layout/Moldura'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import CatalogPage from './pages/CatalogPage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import ProjectFormPage from './pages/ProjectFormPage'
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

function DashboardRoute() {
  const navigate = useNavigate()
  return (
    <Moldura>
      <DashboardPage
        onNewProject={() => navigate('/projeto/novo')}
        onOpenProject={(id) => navigate(`/projeto/${id}`)}
      />
    </Moldura>
  )
}

function NovoProjetoRoute() {
  const navigate = useNavigate()
  return (
    <Moldura>
      <ProjectFormPage
        onDone={(project) => navigate(`/projeto/${project.id}`)}
        onCancel={() => navigate('/projetos')}
      />
    </Moldura>
  )
}

function EditarProjetoRoute() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  return (
    <Moldura>
      <ProjectFormPage
        projectId={projectId}
        onDone={(project) => navigate(`/projeto/${project.id}`)}
        onCancel={() => navigate(`/projeto/${projectId}`)}
      />
    </Moldura>
  )
}

function MateriaisRoute() {
  const { state } = useAuth()
  const navigate = useNavigate()
  const podeGerenciar = state.kind === 'authenticated' && state.session.user.role === 'owner'
  return (
    <Moldura>
      <CatalogPage onBack={() => navigate('/projetos')} canManage={podeGerenciar} />
    </Moldura>
  )
}

function Autenticado() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/projetos" element={<DashboardRoute />} />
        <Route path="/projeto/novo" element={<NovoProjetoRoute />} />
        <Route path="/projeto/:projectId/editar" element={<EditarProjetoRoute />} />
        <Route path="/materiais" element={<MateriaisRoute />} />

        <Route path="/projeto/:projectId" element={<ProjectWorkspace />}>
          <Route index element={<ProjectIndexRedirect />} />
          <Route path="levantamento" element={<StepLevantamento />} />
          <Route path="especificacao" element={<StepEspecificacao />} />
          <Route path="proposta" element={<StepProposta />} />
          <Route path="entrega" element={<StepEntrega />} />
        </Route>

        <Route path="*" element={<Navigate to="/projetos" replace />} />
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
