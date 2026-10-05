import { useState, type FormEvent, type ReactNode } from 'react'
import { errorMessage, requestEmailChange, requestPasswordReset, updateMe } from '../api/client'
import { useAuth } from '../auth/context'
import { Botao, Rotulo, entradaClasse } from './prototipo/pecas'
import { ErrorNotice } from './ui'

/**
 * Minha conta, dentro do painel.
 *
 * - Nome: troca na hora.
 * - E-mail: manda um link para o endereço novo; só muda depois do clique.
 *   É assim que se passa a conta para outra pessoa (o cliente confirma).
 * - Senha: manda o link de troca para o e-mail da conta. Não pede a senha
 *   antiga e não existe outro jeito de trocar.
 */
export default function MinhaConta() {
  const { state, refresh } = useAuth()
  if (state.kind !== 'authenticated') return null
  const usuario = state.session.user
  return (
    <div className="flex flex-col gap-4">
      <Nome atual={usuario.name} onSalvo={refresh} />
      <Email atual={usuario.email} />
      <Senha email={usuario.email} />
    </div>
  )
}

function Bloco({ titulo, descricao, children }: { titulo: string; descricao: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <Rotulo cor="destaque">{titulo}</Rotulo>
      <p className="mt-2 text-sm text-ink-soft">{descricao}</p>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Retorno({ ok, erro }: { ok: string | null; erro: string | null }) {
  if (erro) return <div className="mt-3"><ErrorNotice message={erro} /></div>
  if (ok) return <p role="status" className="mt-3 rounded-md border border-good bg-good-soft px-3 py-2 text-sm text-ink">{ok}</p>
  return null
}

/** Estado comum dos três blocos: enviando, mensagem de sucesso e de erro. */
function useEnvio() {
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function enviar(acao: () => Promise<string>, falha: string) {
    setEnviando(true)
    setOk(null)
    setErro(null)
    try {
      setOk(await acao())
    } catch (err) {
      setErro(errorMessage(err, falha))
    } finally {
      setEnviando(false)
    }
  }
  return { enviando, ok, erro, enviar }
}

function Nome({ atual, onSalvo }: { atual: string; onSalvo: () => Promise<void> }) {
  const [nome, setNome] = useState(atual)
  const { enviando, ok, erro, enviar } = useEnvio()
  const mudou = nome.trim() !== '' && nome.trim() !== atual

  function salvar(event: FormEvent) {
    event.preventDefault()
    if (!mudou || enviando) return
    void enviar(async () => {
      await updateMe(nome.trim())
      await onSalvo()
      return 'Nome salvo.'
    }, 'Não foi possível salvar o nome.')
  }

  return (
    <Bloco titulo="Nome" descricao="Como você aparece no topo da ferramenta.">
      <form onSubmit={salvar} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[240px] flex-1 text-sm text-ink-soft">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} disabled={enviando} maxLength={120} className={entradaClasse} />
        </label>
        <Botao tipo="submit" principal disabled={!mudou || enviando}>{enviando ? 'Salvando…' : 'Salvar nome'}</Botao>
      </form>
      <Retorno ok={ok} erro={erro} />
    </Bloco>
  )
}

function Email({ atual }: { atual: string }) {
  const [novo, setNovo] = useState('')
  const { enviando, ok, erro, enviar } = useEnvio()
  const valido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novo.trim()) && novo.trim().toLowerCase() !== atual

  function pedir(event: FormEvent) {
    event.preventDefault()
    if (!valido || enviando) return
    void enviar(() => requestEmailChange(novo.trim()), 'Não foi possível enviar o link de confirmação.')
  }

  return (
    <Bloco
      titulo="E-mail de acesso"
      descricao={`Hoje o login é ${atual}. Digite o e-mail novo: enviamos um link para ele, e o login só muda depois que o dono desse e-mail clicar no link.`}
    >
      <form onSubmit={pedir} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[240px] flex-1 text-sm text-ink-soft">
          E-mail novo
          <input type="email" value={novo} onChange={(e) => setNovo(e.target.value)} disabled={enviando} autoComplete="email" placeholder="nome@empresa.com.br" className={entradaClasse} />
        </label>
        <Botao tipo="submit" principal disabled={!valido || enviando}>{enviando ? 'Enviando…' : 'Enviar confirmação'}</Botao>
      </form>
      <Retorno ok={ok} erro={erro} />
    </Bloco>
  )
}

function Senha({ email }: { email: string }) {
  const { enviando, ok, erro, enviar } = useEnvio()
  return (
    <Bloco titulo="Senha" descricao={`Para trocar a senha, enviamos um link para ${email}. Lá você cria a senha nova — não precisa saber a antiga.`}>
      <Botao principal disabled={enviando} onClick={() => void enviar(() => requestPasswordReset(email), 'Não foi possível enviar o link agora.')}>
        {enviando ? 'Enviando…' : 'Enviar link para trocar a senha'}
      </Botao>
      <Retorno ok={ok} erro={erro} />
    </Bloco>
  )
}
