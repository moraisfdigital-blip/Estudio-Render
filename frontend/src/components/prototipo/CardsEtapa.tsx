import { useNavigate } from 'react-router-dom'

/**
 * Os quatro cartões de etapa do protótipo, em linha, logo abaixo do título.
 *
 * ## O status não é enfeite
 *
 * No protótipo o texto de cada cartão vem de contagens em memória. Aqui vem
 * dos dados reais — quantas fotos existem, quantas têm escala, quantos
 * elementos foram conferidos. Um cartão que diz "pronto" sem estar pronto é
 * pior do que um cartão sem status: quem confia nele fecha preço errado.
 *
 * Turquesa marca onde você está; rosa marca o que já foi concluído.
 */

export type EstadoEtapas = {
  fotos: number
  areas: number
  calibradas: number
  elementos: number
  conferidos: number
}

export default function CardsEtapa({
  projectId,
  atual,
  estado,
}: {
  projectId: string
  /** 1 a 4 — qual cartão está aceso agora. */
  atual: number
  estado: EstadoEtapas
}) {
  const navigate = useNavigate()

  const cartoes = [
    {
      numero: '01',
      titulo: 'Foto do local',
      status: estado.fotos
        ? `${estado.fotos} ${estado.fotos === 1 ? 'foto' : 'fotos'} · ${estado.areas} ${estado.areas === 1 ? 'área' : 'áreas'}`
        : 'Adicionar fotografia',
      pronto: estado.fotos > 0,
      ir: `/projeto/${projectId}/levantamento`,
    },
    {
      numero: '02',
      titulo: 'Definir escala',
      status: estado.fotos
        ? `${estado.calibradas} de ${estado.fotos} com escala`
        : 'Aguardando foto',
      pronto: estado.fotos > 0 && estado.calibradas === estado.fotos,
      ir: `/projeto/${projectId}/levantamento`,
    },
    {
      numero: '03',
      titulo: 'Montar projeto',
      status: estado.elementos
        ? `${estado.elementos} ${estado.elementos === 1 ? 'elemento' : 'elementos'} · ${estado.conferidos} ${estado.conferidos === 1 ? 'conferido' : 'conferidos'}`
        : 'Nenhum elemento ainda',
      pronto: estado.elementos > 0 && estado.conferidos === estado.elementos,
      ir: `/projeto/${projectId}/especificacao`,
    },
    {
      numero: '04',
      titulo: 'Apresentar',
      status: estado.calibradas && estado.elementos ? 'Disponível para revisar' : 'Pendente',
      pronto: Boolean(estado.calibradas && estado.elementos),
      ir: `/projeto/${projectId}/entrega`,
    },
  ]

  return (
    <div className="mt-[-10px] mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {cartoes.map((cartao, indice) => {
        const aceso = indice + 1 === atual
        return (
          <button
            key={cartao.numero}
            type="button"
            onClick={() => navigate(cartao.ir)}
            className={`flex items-center gap-2.5 rounded-md border p-3 text-left transition ${
              aceso
                ? 'border-brand bg-brand-soft shadow-[inset_0_-3px_var(--color-brand)]'
                : 'border-[#eddae4] bg-surface hover:border-accent hover:bg-accent-soft'
            }`}
          >
            <span
              className={`grid size-[27px] shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                aceso
                  ? 'bg-brand text-brand-ink'
                  : cartao.pronto
                    ? 'bg-accent text-white'
                    : 'bg-raised text-ink-dim'
              }`}
            >
              {cartao.numero}
            </span>
            <span className="min-w-0">
              <b className="block text-[11px] font-semibold text-ink">{cartao.titulo}</b>
              <small
                className={`mt-[3px] block text-[10px] ${
                  cartao.pronto ? 'text-accent-strong' : 'text-ink-dim'
                }`}
              >
                {cartao.status}
              </small>
            </span>
          </button>
        )
      })}
    </div>
  )
}
