import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { errorMessage, listProjects, salvarProjetoPorNomes } from '../api/client'
import { useAuth } from '../auth/context'
import Marca from '../components/layout/Marca'
import { Botao, Rotulo, entradaClasse } from '../components/prototipo/pecas'
import { ErrorNotice, Loading } from '../components/ui'
import { ultimoProjeto } from '../contexts/ultimoProjeto'
import { useResource } from '../hooks/useResource'

/**
 * A entrada do estúdio.
 *
 * No protótipo não existe tela de lista nem formulário à parte: abre direto a
 * mesa de trabalho do projeto. Então a entrada só decide qual projeto abrir —
 * o último aberto neste navegador, ou o mais recente — e vai para ele. Sem
 * nenhum projeto ainda, mostra a mesma janela "Novo projeto" do protótipo.
 */
export default function Inicio() {
  const { resource, reload } = useResource(listProjects, 'Não foi possível carregar os projetos.')

  if (resource.kind === 'loading') {
    return (
      <Moldura>
        <Loading label="Abrindo o estúdio…" />
      </Moldura>
    )
  }

  if (resource.kind === 'error') {
    return (
      <Moldura>
        <div className="mx-auto w-full max-w-[480px]">
          <ErrorNotice message={resource.message} onRetry={reload} />
        </div>
      </Moldura>
    )
  }

  const projetos = resource.data
  if (projetos.length > 0) {
    const lembrado = ultimoProjeto()
    // A API devolve do mais recente para o mais antigo.
    const alvo = projetos.find((p) => p.id === lembrado) ?? projetos[0]
    return <Navigate to={`/projeto/${alvo.id}/levantamento`} replace />
  }

  return (
    <Moldura>
      <PrimeiroProjeto />
    </Moldura>
  )
}

/** Topo do protótipo (marca + faixa de três cores) com o conteúdo centralizado. */
function Moldura({ children }: { children: ReactNode }) {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-full flex-1 flex-col bg-app">
      <header className="relative flex h-[88px] shrink-0 items-center bg-surface px-7">
        <Marca className="h-[70px] w-[190px]" />
        <button
          type="button"
          onClick={() => void signOut()}
          className="ml-auto grid size-9 place-items-center rounded-md border border-line-accent text-ink-dim transition hover:border-accent hover:text-ink"
          aria-label="Sair"
          title="Sair"
        >
          <LogOut size={16} strokeWidth={1.75} />
        </button>
        <span
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-0.5"
          style={{
            background:
              'linear-gradient(90deg, var(--color-accent) 0 43%, var(--color-brand) 43% 84%, var(--color-warn) 84%)',
          }}
        />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-12">{children}</main>
    </div>
  )
}

/** A janela "Novo projeto" do protótipo, para quando ainda não há nenhum. */
function PrimeiroProjeto() {
  const navigate = useNavigate()
  const [nome, setNome] = useState('')
  const [cliente, setCliente] = useState('')
  const [local, setLocal] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const pronto = nome.trim() !== '' && cliente.trim() !== '' && local.trim() !== ''

  async function salvar(event: FormEvent) {
    event.preventDefault()
    if (!pronto || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const projeto = await salvarProjetoPorNomes({
        name: nome.trim(),
        clientName: cliente.trim(),
        locationName: local.trim(),
      })
      navigate(`/projeto/${projeto.id}/levantamento`, { replace: true })
    } catch (caught) {
      setErro(errorMessage(caught, 'Não foi possível salvar o projeto.'))
      setSalvando(false)
    }
  }

  return (
    <form
      onSubmit={salvar}
      className="w-full max-w-[480px] rounded-lg border border-line bg-surface p-6 shadow-[0_24px_80px_rgba(23,28,32,.12)]"
    >
      <Rotulo cor="destaque">Dados do levantamento</Rotulo>
      <h1 className="mt-2 text-[22px] font-semibold text-ink">Novo projeto</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Comece pelo primeiro projeto. Depois você adiciona as fotos e monta o estudo.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <Campo rotulo="Nome do projeto">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            disabled={salvando}
            required
            autoFocus
            placeholder="Ex.: Identidade visual · Posto Horizonte"
            className={entradaClasse}
          />
        </Campo>
        <Campo rotulo="Cliente">
          <input
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            disabled={salvando}
            required
            placeholder="Nome do cliente ou empresa"
            className={entradaClasse}
          />
        </Campo>
        <Campo rotulo="Local da obra">
          <input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            disabled={salvando}
            required
            placeholder="Cidade, endereço ou unidade"
            className={entradaClasse}
          />
        </Campo>
      </div>

      {erro && (
        <div className="mt-4">
          <ErrorNotice message={erro} />
        </div>
      )}

      <div className="mt-[22px] flex justify-end border-t border-line pt-[18px]">
        <Botao tipo="submit" principal disabled={!pronto || salvando}>
          {salvando ? 'Salvando…' : 'Salvar projeto'}
        </Botao>
      </div>
    </form>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-ink-soft">
      {rotulo}
      {children}
    </label>
  )
}
