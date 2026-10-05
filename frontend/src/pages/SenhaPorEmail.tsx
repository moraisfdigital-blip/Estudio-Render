import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { confirmEmailChange, confirmPasswordReset, errorMessage, requestPasswordReset } from '../api/client'
import { useAuth } from '../auth/context'
import { AuthCard, Field, LinkButton, SubmitButton } from '../components/AuthForm'

/**
 * Senha e e-mail só mudam por link enviado ao e-mail, como nas ferramentas
 * conhecidas: ninguém precisa lembrar da senha antiga.
 *
 * 1. "Esqueci minha senha" → digita o e-mail → o link chega lá.
 * 2. O link abre `/redefinir-senha?token=…` → senha nova duas vezes.
 * 3. Trocar o e-mail (em Minha conta) manda um link para o endereço novo,
 *    que abre `/confirmar-email?token=…`.
 */

const MINIMO = 12

function codigoDaUrl(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}

/** Mensagem de sucesso no mesmo cartão da tela de entrada. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-md border border-good bg-good-soft px-3 py-2 text-sm text-ink">
      {children}
    </p>
  )
}

export function EsqueciSenhaPage({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviado, setEnviado] = useState<string | null>(null)

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      setEnviado(await requestPasswordReset(email.trim()))
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível enviar agora. Tente de novo.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard
      title="Trocar a senha"
      subtitle="Digite o e-mail da sua conta. Enviamos um link para você criar a senha nova."
      error={error}
      onSubmit={enviar}
      footer={<LinkButton onClick={onBack}>Voltar para entrar</LinkButton>}
    >
      {enviado ? (
        <Aviso>{enviado}</Aviso>
      ) : (
        <>
          <Field label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="email" disabled={pending} />
          <SubmitButton pending={pending}>Enviar link</SubmitButton>
        </>
      )}
    </AuthCard>
  )
}

/** Volta para a entrada, encerrando a sessão deste navegador se houver. */
function useIrParaEntrada() {
  const { state, signOut } = useAuth()
  const navigate = useNavigate()
  return async () => {
    if (state.kind === 'authenticated') await signOut()
    navigate('/', { replace: true })
  }
}

export function RedefinirSenhaPage() {
  const [codigo] = useState(codigoDaUrl)
  const [senha, setSenha] = useState('')
  const [repetida, setRepetida] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pronto, setPronto] = useState<string | null>(null)
  const irParaEntrada = useIrParaEntrada()

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Depois de salvo, o mesmo botão vira "Entrar".
    if (pronto) return void irParaEntrada()
    if (pending) return
    if (senha.length < MINIMO) return setError(`A senha precisa ter pelo menos ${MINIMO} caracteres.`)
    if (senha !== repetida) return setError('As duas senhas não são iguais.')
    setPending(true)
    setError(null)
    try {
      setPronto(await confirmPasswordReset(codigo, senha))
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar a senha nova.'))
    } finally {
      setPending(false)
    }
  }

  if (!codigo) {
    return (
      <AuthCard title="Link incompleto" subtitle="Abra o link exatamente como chegou no e-mail, ou peça um novo." error={null} onSubmit={(e) => e.preventDefault()} footer={<LinkButton onClick={() => void irParaEntrada()}>Ir para a entrada</LinkButton>}>
        {null}
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Criar senha nova"
      subtitle={`Use pelo menos ${MINIMO} caracteres. Depois de salvar, entre com a senha nova.`}
      error={error}
      onSubmit={salvar}
      footer={<LinkButton onClick={() => void irParaEntrada()}>Ir para a entrada</LinkButton>}
    >
      {pronto ? (
        <>
          <Aviso>{pronto}</Aviso>
          <SubmitButton pending={false}>Entrar</SubmitButton>
        </>
      ) : (
        <>
          <Field label="Senha nova" type="password" value={senha} onChange={setSenha} autoComplete="new-password" disabled={pending} minLength={MINIMO} />
          <Field label="Repita a senha nova" type="password" value={repetida} onChange={setRepetida} autoComplete="new-password" disabled={pending} minLength={MINIMO} />
          <SubmitButton pending={pending}>Salvar senha nova</SubmitButton>
        </>
      )}
    </AuthCard>
  )
}

export function ConfirmarEmailPage() {
  const [codigo] = useState(codigoDaUrl)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pronto, setPronto] = useState<string | null>(null)
  const irParaEntrada = useIrParaEntrada()

  // A confirmação pede um clique de propósito: alguns filtros de e-mail
  // abrem os links sozinhos, e isso não pode trocar o login de ninguém.
  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pronto) return void irParaEntrada()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      setPronto(await confirmEmailChange(codigo))
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível confirmar o e-mail.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard
      title="Confirmar e-mail"
      subtitle={codigo ? 'Confirme para este endereço passar a ser o seu login.' : 'Abra o link exatamente como chegou no e-mail.'}
      error={error}
      onSubmit={confirmar}
      footer={<LinkButton onClick={() => void irParaEntrada()}>Ir para a entrada</LinkButton>}
    >
      {pronto && <Aviso>{pronto}</Aviso>}
      {codigo && <SubmitButton pending={pending}>{pronto ? 'Entrar' : 'Confirmar e-mail'}</SubmitButton>}
    </AuthCard>
  )
}
