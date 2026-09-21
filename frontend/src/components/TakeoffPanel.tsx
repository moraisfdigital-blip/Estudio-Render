import { useCallback, useState } from 'react'
import {
  addManualItem,
  errorMessage,
  generateTakeoff,
  getTakeoff,
  updateBudgetItem,
  type Takeoff,
  type TakeoffItem,
} from '../api/client'
import { Button, ErrorNotice, Loading, inputClass } from '../components/ui'
import { useResource } from '../hooks/useResource'

/**
 * Quantitativo e orçamento — a última etapa do fluxo.
 *
 * As linhas vêm dos elementos **conferidos**, com a área derivada das medidas.
 * A tela não calcula nada disso: quantidade, procedência, total da linha e
 * total do orçamento vêm do servidor.
 *
 * Três coisas que esta tela é obrigada a mostrar, e por quê:
 *
 * - **Estimativa rotulada.** `quantity_source_label` vem pronto, e aparece ao
 *   lado da quantidade. Quem fecha preço precisa saber que aquele número saiu
 *   de uma escala, não de uma trena.
 * - **Por que falta quantidade.** `quantity_note` explica no lugar do campo
 *   vazio, em vez de deixar a linha parecer um bug.
 * - **Total parcial.** Enquanto houver linha sem preço, o total aparece como
 *   parcial — somar zero faria um orçamento incompleto parecer fechado.
 */

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

/** Vírgula é como se digita número em português; aceita as duas formas. */
function parseNumero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\./g, '').replace(',', '.')
  if (!limpo) return null
  const valor = Number(limpo)
  return Number.isFinite(valor) && valor >= 0 ? valor : null
}

const UNIDADES = [
  { value: 'm2', label: 'm²' },
  { value: 'm', label: 'm' },
  { value: 'un', label: 'un' },
]

function Procedencia({ item }: { item: TakeoffItem }) {
  if (!item.quantity_source_label) return null
  const estimativa = item.quantity_source === 'estimated'
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
        estimativa
          ? 'border-warn bg-warn-soft text-warn'
          : 'border-line text-ink-soft'
      }`}
    >
      {item.quantity_source_label}
    </span>
  )
}

function Linha({
  item,
  ocupado,
  onPreco,
  onQuantidade,
}: {
  item: TakeoffItem
  ocupado: boolean
  onPreco: (valor: number) => void
  onQuantidade: (valor: number) => void
}) {
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-3">
        <p className="text-ink">{item.description}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-dim">
          {item.kind_label && <span>{item.kind_label}</span>}
          {item.material_name && <span>· {item.material_name}</span>}
          {item.finish_name && (
            <span className="flex items-center gap-1">
              · {item.finish_name}
              {item.color_hex && (
                <span
                  className="inline-block size-2.5 rounded-sm border border-ink-dim"
                  style={{ backgroundColor: item.color_hex }}
                  title={item.color_name ?? undefined}
                />
              )}
            </span>
          )}
          {item.origin === 'manual' && <span>· linha manual</span>}
        </p>
        {/* Por que não há quantidade. Melhor do que um campo vazio sem explicação. */}
        {item.quantity_note && (
          <p className="mt-1 text-[11px] text-warn">{item.quantity_note}</p>
        )}
      </td>

      <td className="py-2 pr-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <input
            defaultValue={item.quantity === null ? '' : number.format(item.quantity)}
            placeholder="—"
            disabled={ocupado}
            onBlur={(event) => {
              const valor = parseNumero(event.target.value)
              if (valor !== null && valor > 0 && valor !== item.quantity) onQuantidade(valor)
            }}
            className={`${inputClass} w-24 text-right text-xs`}
          />
          <span className="text-[10px] text-ink-dim">
            {UNIDADES.find((u) => u.value === item.unit)?.label ?? item.unit}
          </span>
        </div>
        <div className="mt-1">
          <Procedencia item={item} />
        </div>
      </td>

      <td className="py-2 pr-3 whitespace-nowrap">
        <input
          defaultValue={item.unit_price === null ? '' : number.format(item.unit_price)}
          placeholder="—"
          disabled={ocupado}
          onBlur={(event) => {
            const valor = parseNumero(event.target.value)
            if (valor !== null && valor !== item.unit_price) onPreco(valor)
          }}
          className={`${inputClass} w-28 text-right text-xs`}
        />
      </td>

      <td className="py-2 text-right whitespace-nowrap text-ink">
        {item.line_total === null ? (
          <span className="text-xs text-ink-dim">—</span>
        ) : (
          money.format(item.line_total)
        )}
      </td>
    </tr>
  )
}

export default function TakeoffPanel({ projectId }: { projectId: string }) {
  const carregar = useCallback(() => getTakeoff(projectId), [projectId])
  const { resource, reload } = useResource(
    carregar,
    'Não foi possível carregar o quantitativo.',
  )

  const [atual, setAtual] = useState<Takeoff | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [novaDescricao, setNovaDescricao] = useState('')
  const [novaQuantidade, setNovaQuantidade] = useState('1')
  const [novaUnidade, setNovaUnidade] = useState('un')

  const [hidratadoDe, setHidratadoDe] = useState<Takeoff | null>(null)
  if (resource.kind === 'ready' && resource.data !== hidratadoDe) {
    setHidratadoDe(resource.data)
    setAtual(resource.data)
  }

  async function executar(acao: () => Promise<Takeoff>, padrao: string) {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    try {
      setAtual(await acao())
    } catch (caught) {
      setErro(errorMessage(caught, padrao))
    } finally {
      setOcupado(false)
    }
  }

  function adicionarManual() {
    const quantidade = parseNumero(novaQuantidade)
    if (!novaDescricao.trim() || quantidade === null || quantidade <= 0) return
    void executar(async () => {
      const resultado = await addManualItem(projectId, {
        description: novaDescricao.trim(),
        quantity: quantidade,
        unit: novaUnidade,
      })
      setNovaDescricao('')
      setNovaQuantidade('1')
      return resultado
    }, 'Não foi possível adicionar a linha.')
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-ink">Quantitativo e orçamento</h2>
      <p className="mt-1 text-sm text-ink-dim">
        Sai dos elementos conferidos. O preço é sempre informado por você — não existe tabela
        nem valor de referência neste sistema.
      </p>

      {resource.kind === 'loading' && <Loading label="Carregando quantitativo…" />}
      {resource.kind === 'error' && (
        <div className="mt-4">
          <ErrorNotice message={resource.message} onRetry={reload} />
        </div>
      )}

      {resource.kind === 'ready' && atual && (
        <div className="mt-4 flex flex-col gap-4">
          {erro && <ErrorNotice message={erro} />}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={ocupado}
              onClick={() =>
                void executar(
                  () => generateTakeoff(projectId),
                  'Não foi possível gerar o quantitativo.',
                )
              }
            >
              {ocupado ? 'Processando…' : atual.generated ? 'Atualizar quantitativo' : 'Gerar quantitativo'}
            </Button>
            {atual.generated && (
              <span className="text-xs text-ink-dim">
                Atualizar recalcula as medidas e mantém os preços digitados.
              </span>
            )}
          </div>

          {/* Estado vazio da fatia. */}
          {atual.items.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-4">
              <p className="text-sm text-ink-soft">Nenhuma linha no quantitativo</p>
              <p className="mt-1 text-xs text-ink-dim">
                Só entram elementos <strong>conferidos</strong>. Confira as medidas no
                levantamento e gere o quantitativo.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[10px] tracking-wide text-ink-dim uppercase">
                      <th className="pb-2 pr-3 font-normal">Item</th>
                      <th className="pb-2 pr-3 font-normal">Quantidade</th>
                      <th className="pb-2 pr-3 font-normal">Preço unitário</th>
                      <th className="pb-2 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atual.items.map((item) => (
                      <Linha
                        key={item.id}
                        item={item}
                        ocupado={ocupado}
                        onPreco={(valor) =>
                          void executar(
                            () => updateBudgetItem(item.id, { unit_price: valor }),
                            'Não foi possível salvar o preço.',
                          )
                        }
                        onQuantidade={(valor) =>
                          void executar(
                            () => updateBudgetItem(item.id, { quantity: valor }),
                            'Não foi possível salvar a quantidade.',
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* O total e as pendências que o tornam parcial. */}
              <div className="rounded-md border border-line bg-surface p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs tracking-wide text-ink-dim uppercase">
                    {atual.items_without_price > 0 ? 'Total parcial' : 'Total'}
                  </span>
                  <span className="text-lg text-ink">
                    {atual.total === null ? '—' : money.format(atual.total)}
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-dim">
                  {atual.items_without_price > 0 && (
                    <li className="text-warn">
                      {atual.items_without_price === 1
                        ? '1 linha ainda sem preço — ela não está somada.'
                        : `${atual.items_without_price} linhas ainda sem preço — elas não estão somadas.`}
                    </li>
                  )}
                  {atual.items_with_estimate > 0 && (
                    <li className="text-warn">
                      {atual.items_with_estimate === 1
                        ? '1 linha usa quantidade estimada, não medida em campo.'
                        : `${atual.items_with_estimate} linhas usam quantidade estimada, não medida em campo.`}
                    </li>
                  )}
                  {atual.skipped_without_measurement > 0 && (
                    <li>
                      {atual.skipped_without_measurement === 1
                        ? '1 elemento conferido está sem medida suficiente para calcular a área.'
                        : `${atual.skipped_without_measurement} elementos conferidos estão sem medida suficiente para calcular a área.`}
                    </li>
                  )}
                  {atual.items_without_price === 0 && atual.items_with_estimate === 0 && (
                    <li>Todas as linhas têm preço e quantidade medida em campo.</li>
                  )}
                </ul>
              </div>
            </>
          )}

          {/* Linha manual: instalação, frete, projeto. */}
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-xs tracking-wide text-ink-dim uppercase">
              Adicionar linha manual
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-[10px] text-ink-dim">Descrição</span>
                <input
                  value={novaDescricao}
                  onChange={(event) => setNovaDescricao(event.target.value)}
                  placeholder="Instalação, frete, projeto…"
                  className={`${inputClass} text-xs`}
                />
              </label>
              <label className="flex w-24 flex-col gap-1">
                <span className="text-[10px] text-ink-dim">Quantidade</span>
                <input
                  value={novaQuantidade}
                  onChange={(event) => setNovaQuantidade(event.target.value)}
                  className={`${inputClass} text-right text-xs`}
                />
              </label>
              <label className="flex w-20 flex-col gap-1">
                <span className="text-[10px] text-ink-dim">Unidade</span>
                <select
                  value={novaUnidade}
                  onChange={(event) => setNovaUnidade(event.target.value)}
                  className={`${inputClass} text-xs`}
                >
                  {UNIDADES.map((unidade) => (
                    <option key={unidade.value} value={unidade.value}>
                      {unidade.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={ocupado || !novaDescricao.trim()}
                onClick={adicionarManual}
              >
                Adicionar
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
