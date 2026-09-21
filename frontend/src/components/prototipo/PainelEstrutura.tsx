import type { SurveyElement } from '../../api/client'
import { Botao, Rotulo } from './pecas'

/**
 * A coluna esquerda do protótipo: "Elementos da obra".
 *
 * ## De quem são os elementos
 *
 * No protótipo eles pertencem ao projeto. Aqui pertencem a uma **foto** — é
 * assim no banco, e é o que faz sentido: a medida de uma testeira sai da foto
 * em que ela foi calibrada. Então a lista mostra os elementos da foto aberta,
 * e sem foto aberta ela diz isso em vez de mostrar uma lista vazia.
 */
export default function PainelEstrutura({
  elementos,
  selecionado,
  onSelecionar,
  onNovo,
  onAdicionarFoto,
  temFoto,
  carregando,
}: {
  elementos: SurveyElement[]
  selecionado: string | null
  onSelecionar: (id: string) => void
  onNovo: () => void
  onAdicionarFoto: () => void
  temFoto: boolean
  carregando: boolean
}) {
  return (
    <div className="flex h-full flex-col">
      <Rotulo>Estrutura do projeto</Rotulo>
      <h2 className="mt-4 mb-2.5 text-[17px] font-semibold tracking-[-0.4px]">
        Elementos da obra
      </h2>
      <p className="text-[13px] leading-[1.65] text-ink-dim">
        {temFoto
          ? 'Selecione um elemento para definir suas dimensões e acabamento.'
          : 'Abra uma foto do levantamento para ver e medir os elementos dela.'}
      </p>

      <div className="mt-4">
        {carregando && <p className="py-3 text-xs text-ink-dim">Carregando…</p>}

        {!carregando && temFoto && elementos.length === 0 && (
          <p className="py-3 text-xs text-ink-dim">Nenhum elemento nesta foto ainda.</p>
        )}

        {elementos.map((elemento, indice) => {
          const ativo = elemento.id === selecionado
          return (
            <button
              key={elemento.id}
              type="button"
              onClick={() => onSelecionar(elemento.id)}
              className={`my-[5px] flex w-full items-center gap-2.5 border px-2.5 py-[13px] text-left text-sm transition ${
                ativo
                  ? 'border-[#f2a7ca] bg-accent-soft shadow-[inset_3px_0_var(--color-accent)]'
                  : 'border-transparent hover:bg-accent-soft/60'
              }`}
            >
              <span
                className={`size-[13px] shrink-0 rounded-[2px] border ${
                  ativo ? 'border-brand bg-brand-soft' : 'border-ink-dim'
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{elemento.name}</span>
              <span className="text-[11px] text-ink-dim">
                {String(indice + 1).padStart(2, '0')}
              </span>
            </button>
          )
        })}
      </div>

      {temFoto && (
        <button
          type="button"
          onClick={onNovo}
          className="mt-2.5 w-full rounded-md border border-dashed border-line-accent bg-raised px-[15px] py-[10px] text-xs font-medium text-ink-soft transition hover:border-accent hover:bg-accent-soft"
        >
          ＋ Novo elemento
        </button>
      )}

      <div className="mt-7 border-t border-line pt-6">
        <Rotulo>Referência do local</Rotulo>
        <div className="mt-3">
          <Botao largo onClick={onAdicionarFoto}>
            ＋ Adicionar fotografia
          </Botao>
        </div>
        <p className="mt-3 text-xs leading-[1.6] text-ink-dim">
          A foto original permanece como referência do levantamento — nada do que
          você fizer aqui a altera.
        </p>
      </div>

      <div className="mt-auto grid gap-[7px] pt-12">
        <span className="text-xs text-ink-dim">Unidade do projeto</span>
        <b className="text-[13px] font-medium">Metros (m)</b>
        <small className="text-xs text-ink-dim">Medidas vindas da escala da foto</small>
      </div>
    </div>
  )
}
