import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage } from '../api/client'
import { useAuth } from '../auth/context'
import { AuthCard, Field, LinkButton, SubmitButton } from '../components/AuthForm'

const PASSWORD_MIN_LENGTH = 8

export default function RegisterPage({ onGoToLogin }: { onGoToLogin: () => void }) {
  const { signUp } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`A senha precisa de pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
      return
    }
    setPending(true)
    setError(null)
    try {
      await signUp(email, password, name)
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível registrar. Tente de novo.'))
      setPending(false)
    }
  }

  return (
    <AuthCard
      title="Registrar"
      subtitle="Cria um acesso de editor no workspace."
      error={error}
      onSubmit={handleSubmit}
      footer={
        <>
          Já tem acesso? <LinkButton onClick={onGoToLogin}>Entrar</LinkButton>
        </>
      }
    >
      <Field label="Nome" type="text" value={name} onChange={setName} autoComplete="name" disabled={pending} />
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
        autoComplete="new-password"
        disabled={pending}
        minLength={PASSWORD_MIN_LENGTH}
      />
      <SubmitButton pending={pending}>Registrar</SubmitButton>
    </AuthCard>
  )
}
