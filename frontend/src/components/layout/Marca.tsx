/**
 * A marca ENBY PRO escrita com as cores do logo.
 *
 * O logo original é magenta `#fc027a` e ciano `#02dfd8` puros. Aqui a palavra
 * usa os tokens `brand` e `accent`, que são as mesmas cores ajustadas para
 * serem legíveis em cada modo — o ciano puro sobre branco dá 1,67:1, e ninguém
 * lê uma marca que some no fundo.
 */
export default function Marca({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      <span className="text-accent">EN</span>
      <span className="text-brand">BY</span>
      <span className="text-ink"> PRO</span>
    </span>
  )
}
