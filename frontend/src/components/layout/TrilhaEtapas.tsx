import { Link, useLocation } from 'react-router-dom'

/**
 * A trilha de etapas do protótipo: três abas, 60px de altura, e um traço de
 * 2px turquesa sob a que está ativa.
 *
 * ## Três abas para quatro rotas
 *
 * O protótipo tem três etapas; a ferramenta tem quatro rotas, porque
 * "Especificação" e "Proposta" são trabalhos distintos por dentro. Em vez de
 * apagar uma rota — o que jogaria fora tela que funciona — a aba 02 leva para
 * a especificação e fica acesa nas duas. A URL continua dizendo exatamente
 * onde você está; a trilha só agrupa o que, para quem usa, é uma etapa só.
 */

const ETAPAS = [
  { numero: '01', titulo: 'Levantamento', rota: 'levantamento', tambem: [] as string[] },
  { numero: '02', titulo: 'Projeto visual', rota: 'especificacao', tambem: ['proposta'] },
  { numero: '03', titulo: 'Apresentação', rota: 'entrega', tambem: [] as string[] },
]

export default function TrilhaEtapas({ projectId }: { projectId: string }) {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="Etapas do projeto"
      className="flex h-[60px] shrink-0 items-stretch gap-8 border-b border-line bg-surface px-7"
    >
      {ETAPAS.map((etapa) => {
        const ativa =
          pathname.endsWith(`/${etapa.rota}`) ||
          etapa.tambem.some((extra) => pathname.endsWith(`/${extra}`))
        return (
          <Link
            key={etapa.rota}
            to={`/projeto/${projectId}/${etapa.rota}`}
            aria-current={ativa ? 'step' : undefined}
            className={`flex items-center border-b-2 px-0.5 text-xs transition ${
              ativa
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-dim hover:text-accent-strong'
            }`}
          >
            {etapa.numero}
            <span className="ml-2 text-sm">{etapa.titulo}</span>
          </Link>
        )
      })}
    </nav>
  )
}
