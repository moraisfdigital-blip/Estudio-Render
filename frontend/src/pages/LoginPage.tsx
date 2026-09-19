import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage } from '../api/client'
import { useAuth } from '../auth/context'
import { AuthCard, Field, LinkButton, SubmitButton } from '../components/AuthForm'

export default function LoginPage({ onGoToRegister }: { onGoToRegister: () => void }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          Não tem acesso ainda? <LinkButton onClick={onGoToRegister}>Registrar</LinkButton>
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
