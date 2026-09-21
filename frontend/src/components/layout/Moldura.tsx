import type { ReactNode } from 'react'

/**
 * As três colunas do protótipo: 234px à esquerda, o trabalho no meio, 294px à
 * direita. As laterais são brancas; o meio tem o fundo levemente rosado que
 * separa a área de trabalho da moldura.
 *
 * ## Coluna que não tem conteúdo não é desenhada
 *
 * A direita só aparece quando há algo selecionado para mostrar propriedades.
 * Uma coluna vazia de 294px ocupando a tela e prometendo função que ainda não
 * chegou é pior do que não existir — e o meio aproveita o espaço.
 */
export default function Moldura({
  esquerda,
  direita,
  children,
}: {
  esquerda?: ReactNode
  direita?: ReactNode
  children: ReactNode
}) {
  const colunas = [esquerda ? '234px' : null, 'minmax(350px, 1fr)', direita ? '294px' : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: colunas }}>
      {esquerda && (
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-surface px-5 py-7">
          {esquerda}
        </aside>
      )}

      <main className="min-h-0 overflow-y-auto bg-app px-7 pt-[30px] pb-[18px]">{children}</main>

      {direita && (
        <aside className="min-h-0 overflow-y-auto border-l border-line bg-surface px-5 py-7">
          {direita}
        </aside>
      )}
    </div>
  )
}
