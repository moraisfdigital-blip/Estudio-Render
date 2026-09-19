import { useState } from 'react'
import AppShell from './components/AppShell'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

function Routes() {
  const { state } = useAuth()
  const [screen, setScreen] = useState<'login' | 'register'>('login')

  // Sessão sendo conferida a partir do token guardado.
  if (state.kind === 'hydrating') {
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <p className="text-sm text-neutral-400">Carregando sessão…</p>
      </main>
    )
  }

  if (state.kind === 'authenticated') return <AppShell />

  return screen === 'login' ? (
    <LoginPage onGoToRegister={() => setScreen('register')} />
  ) : (
    <RegisterPage onGoToLogin={() => setScreen('login')} />
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  )
}
