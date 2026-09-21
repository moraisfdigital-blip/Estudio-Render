import { NavLink } from 'react-router-dom'
import { Check } from 'lucide-react'

/**
 * A trilha de quatro passos do projeto.
 *
 * Os quatro passos são o trabalho real agrupado: levantar, decidir o
 * que a peça é, gerar e escolher, entregar. Cada um é uma rota — dá para mandar
 * o link de um passo específico para alguém.
 *
 * ## O selo de concluído não é decorativo
 *
 * Ele virá do **servidor**, não de cliques: a API já responde
 * `generation_ready`, `approved_version_id`, `can_export` e o motivo do
 * bloqueio quando há um. Nesta primeira fase a trilha ainda é só navegação — o
 * estado real entra junto com os painéis, para a marca de "pronto" nunca
 * mentir enquanto isso.
 */

export type StepId = 'levantamento' | 'especificacao' | 'proposta' | 'entrega'

type Step = {
  id: StepId
  numero: number
  titulo: string
  descricao: string
}

export const STEPS: Step[] = [
  {
    id: 'levantamento',
    numero: 1,
    titulo: 'Levantamento',
    descricao: 'Fotos e medidas',
  },
  {
    id: 'especificacao',
    numero: 2,
    titulo: 'Especificação',
    descricao: 'Materiais e áreas',
  },
  { id: 'proposta', numero: 3, titulo: 'Proposta', descricao: 'Gerar e escolher' },
  { id: 'entrega', numero: 4, titulo: 'Entrega', descricao: 'Apresentação e orçamento' },
]

function Marcador({ numero, ativo, pronto }: { numero: number; ativo: boolean; pronto: boolean }) {
  const base =
    'grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold transition'

  if (pronto) {
    return (
      <span className={`${base} bg-good-soft text-good`} aria-hidden="true">
        <Check size={17} strokeWidth={2.5} />
      </span>
    )
  }
  return (
    <span
      className={`${base} ${
        ativo ? 'bg-brand text-white' : 'border border-line bg-raised text-ink-dim'
      }`}
      aria-hidden="true"
    >
      {numero}
    </span>
  )
}

export default function StepNav({
  projectId,
  concluidos = [],
}: {
  projectId: string
  /** Passos já cumpridos. Vem do servidor quando os painéis migrarem. */
  concluidos?: StepId[]
}) {
  return (
    <nav aria-label="Etapas do projeto" className="border-b border-line bg-surface">
      <ol className="flex items-stretch gap-1 overflow-x-auto px-4 py-3">
        {STEPS.map((step, indice) => (
          <li key={step.id} className="flex items-center gap-1">
            <NavLink
              to={`/projeto/${projectId}/${step.id}`}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 transition ${
                  isActive ? 'bg-raised' : 'hover:bg-raised/60'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Marcador
                    numero={step.numero}
                    ativo={isActive}
                    pronto={concluidos.includes(step.id)}
                  />
                  <span className="flex min-w-0 flex-col text-left">
                    <span
                      className={`text-sm leading-tight font-semibold whitespace-nowrap ${
                        isActive ? 'text-ink' : 'text-ink-soft'
                      }`}
                    >
                      {step.titulo}
                    </span>
                    <span className="text-xs leading-tight whitespace-nowrap text-ink-dim">
                      {step.descricao}
                    </span>
                  </span>
                </>
              )}
            </NavLink>

            {/* O traço entre passos: é sequência, e a linha diz isso. */}
            {indice < STEPS.length - 1 && (
              <span aria-hidden="true" className="h-px w-6 shrink-0 bg-line sm:w-10" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
