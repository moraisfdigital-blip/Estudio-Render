/**
 * A marca ENBY PRO.
 *
 * É o arquivo do logo, não texto imitando o logo: o desenho tem recortes
 * (o corte diagonal do "e", a perna do "y") que nenhuma fonte reproduz. No
 * protótipo ele ocupa 190×70 e é isso que está replicado aqui.
 *
 * Fundo escuro não precisa de versão própria: o magenta e o ciano do logo
 * têm contraste de sobra nos dois modos.
 */
export default function Marca({ className = 'h-[70px] w-[190px]' }: { className?: string }) {
  return (
    <img
      src="/enby-pro-logo.png"
      alt="ENBY PRO"
      className={`block object-contain ${className}`}
      draggable={false}
    />
  )
}
