import type { ReactNode } from 'react'

/**
 * As peças de tela do protótipo, com as medidas dele.
 *
 * Elas vivem aqui, e não espalhadas, porque o protótipo repete os mesmos
 * blocos em todas as etapas: o rótulo miúdo em maiúsculas, o cartão branco de
 * borda fina, o botão de ação turquesa. Mudar o espaçamento de um card é uma
 * edição neste arquivo, não uma caçada.
 */

/** O rótulo miúdo em maiúsculas que abre cada bloco. 10px, letra espaçada. */
export function Rotulo({ children, cor }: { children: ReactNode; cor?: 'marca' | 'destaque' }) {
  const tom = cor === 'marca' ? 'text-brand' : cor === 'destaque' ? 'text-accent-strong' : 'text-ink-dim'
  return (
    <span className={`block text-[10px] font-semibold tracking-[1.3px] uppercase ${tom}`}>
      {children}
    </span>
  )
}

/** Botão comum: fundo branco, borda rosada, e o rosa claro no hover. */
export function Botao({
  children,
  onClick,
  tipo = 'button',
  principal = false,
  largo = false,
  disabled = false,
  miudo = false,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  tipo?: 'button' | 'submit'
  principal?: boolean
  largo?: boolean
  disabled?: boolean
  miudo?: boolean
  title?: string
}) {
  return (
    <button
      type={tipo}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-[.48] ${
        miudo ? 'px-2 py-[5px] text-[10px]' : 'px-[15px] py-[10px] text-sm'
      } ${largo ? 'w-full' : ''} ${
        principal
          ? 'border-brand bg-brand text-brand-ink hover:border-brand-hover hover:bg-brand-hover'
          : 'border-line-accent bg-surface text-ink-soft hover:border-accent hover:bg-accent-soft'
      }`}
    >
      {children}
    </button>
  )
}

/** O cartão branco de borda fina que envolve cada bloco do centro. */
export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mb-3.5 border border-line bg-surface p-5 ${className}`}>{children}</div>
  )
}

/** Campo de formulário no formato do painel direito: rótulo miúdo em cima,
 *  unidade alinhada à direita do rótulo. */
export function Campo({
  rotulo,
  unidade,
  children,
}: {
  rotulo: string
  unidade?: string
  children: ReactNode
}) {
  return (
    <label className="mb-3 block text-xs text-ink-soft">
      <span className="flex items-baseline justify-between gap-2">
        {rotulo}
        {unidade && <span className="text-[10px] text-ink-dim">{unidade}</span>}
      </span>
      {children}
    </label>
  )
}

/** Entrada de texto/número com a moldura do protótipo. */
export const entradaClasse =
  'mt-1.5 block w-full rounded-[5px] border border-line bg-surface p-[9px] text-sm text-ink outline-none transition focus:border-brand disabled:opacity-60'

/** Bloco de formulário separado por linha, como os `fieldset` do protótipo. */
export function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="mt-[22px] mb-[22px] border-0 border-b border-line p-0 pb-5">
      <legend className="mb-4 text-[13px] font-semibold text-ink">{titulo}</legend>
      {children}
    </fieldset>
  )
}
