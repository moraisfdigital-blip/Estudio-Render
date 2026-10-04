import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import { useAuth } from '../auth/context'
import { AuthCard, Field, LinkButton, SubmitButton } from '../components/AuthForm'

export default function LoginPage({ onGoToRegister }: { onGoToRegister: () => void }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  useEffect(() => {
    let alive = true
    void api.get<{allow_self_register: boolean}>('/public-config')
      .then(({data}) => { if (alive) setRegistrationOpen(data.allow_self_register) })
      .catch(() => { /* Closed by default when the configuration is unavailable. */ })
    return () => { alive = false }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível entrar. Tente de novo.'))
      setPending(false)
    }
  }

  return (
    <AuthCard
      title="Entrar"
      subtitle="Acesso interno ao workspace."
      error={error}
      onSubmit={handleSubmit}
      footer={
        <>
          {registrationOpen ? <>Não tem acesso ainda? <LinkButton onClick={onGoToRegister}>Registrar</LinkButton></> : 'Acesso restrito à equipe. Solicite sua conta ao administrador.'}
        </>
      }
    >
      <Field
        label="E-mail"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        disabled={pending}
      />
      <Field
        label="Senha"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        disabled={pending}
      />
      <SubmitButton pending={pending}>Entrar</SubmitButton>
    </AuthCard>
  )
}
