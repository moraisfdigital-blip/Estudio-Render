import { useEffect, useState } from 'react'
import {
  applySpec,
  deleteElement,
  listFinishes,
  listMaterials,
  saveMeasurements,
  setConference,
  updateElement,
} from '../../api/client'
import type { Finish, Material, SurveyElement } from '../../api/client'
import { Botao, Campo, Grupo, Rotulo, entradaClasse } from './pecas'

/**
 * A coluna direita do protótipo: "Propriedades" do elemento selecionado.
 *
 * Mesma ordem e mesmos campos do protótipo: dimensões e posição, a marca de
 * medida conferida, material e acabamento com as amostras de cor redondas,
 * identidade visual, e as ações no pé.
 *
 * ## Duas diferenças, e por quê
 *
 * **As cores não são uma paleta no código.** No protótipo são nove valores
 * fixos; aqui vêm do catálogo cadastrado no servidor. Cor de ACM que o cliente
 * vai comprar não pode sair de uma lista inventada pela tela.
 *
 * **A medida sabe de onde veio.** No protótipo a caixinha "medidas conferidas"
 * é decorativa; aqui ela muda o dado, e o orçamento passa a tratar aquele
 * número como medido em vez de estimado.
 */

type Rascunho = { largura: string; altura: string; x: string; y: string; texto: string }

function paraCampo(valor: number | null | undefined) {
  return valor === null || valor === undefined ? '' : String(valor)
}

export default function PainelPropriedades({
  elemento,
  onAtualizado,
  onRemovido,
}: {
  elemento: SurveyElement
  onAtualizado: (elemento: SurveyElement) => void
  onRemovido: (id: string) => void
}) {
  const [rascunho, setRascunho] = useState<Rascunho>({
    largura: '',
    altura: '',
    x: '',
    y: '',
    texto: '',
  })
  const [materiais, setMateriais] = useState<Material[]>([])
  const [acabamentos, setAcabamentos] = useState<Finish[]>([])
  const [materialId, setMaterialId] = useState('')
  const [acabamentoId, setAcabamentoId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    setRascunho({
      largura: paraCampo(elemento.measurements.width?.value),
      altura: paraCampo(elemento.measurements.height?.value),
      x: paraCampo(elemento.box.x),
      y: paraCampo(elemento.box.y),
      texto: elemento.notes ?? '',
    })
    setMaterialId(elemento.spec.material?.id ?? '')
    setAcabamentoId(elemento.spec.finish?.id ?? '')
    setRecado(null)
    setErro(null)
  }, [elemento])

  useEffect(() => {
    let vivo = true
    void listMaterials()
      .then((lista) => {
        if (vivo) setMateriais(lista)
      })
      .catch(() => {
        if (vivo) setMateriais([])
      })
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    let vivo = true
    if (!materialId) {
      setAcabamentos([])
      return
    }
    void listFinishes(materialId)
      .then((lista) => {
        if (vivo) setAcabamentos(lista)
      })
      .catch(() => {
        if (vivo) setAcabamentos([])
      })
    return () => {
      vivo = false
    }
  }, [materialId])

  const conferida = elemento.conference.status === 'conferido'
  const corEscolhida = acabamentos.find((a) => a.id === acabamentoId)

  async function aplicar(evento: React.FormEvent) {
    evento.preventDefault()
    setSalvando(true)
    setRecado(null)
    setErro(null)
    try {
      let atual = elemento

      const largura = Number(rascunho.largura.replace(',', '.'))
      const altura = Number(rascunho.altura.replace(',', '.'))
      if (largura > 0 && altura > 0) {
        // A origem é "medida" porque o número foi digitado por quem esteve no
        // local. Estimativa é o que o servidor calcula da escala da foto, e ela
        // continua rotulada como tal.
        atual = await saveMeasurements(atual.id, {
          unit: 'm',
          width: { value: largura, source: 'user_measured' },
          height: { value: altura, source: 'user_measured' },
        })
      }

      const x = Number(rascunho.x.replace(',', '.'))
      const y = Number(rascunho.y.replace(',', '.'))
      const texto = rascunho.texto.trim()
      const mexeuNaCaixa = x !== elemento.box.x || y !== elemento.box.y
      const mexeuNoTexto = texto !== (elemento.notes ?? '')
      if (Number.isFinite(x) && Number.isFinite(y) && (mexeuNaCaixa || mexeuNoTexto)) {
        atual = await updateElement(atual.id, {
          box: { ...atual.box, x, y },
          notes: texto,
        })
      }

      if (materialId && acabamentoId) {
        atual = await applySpec(atual.id, { material_id: materialId, finish_id: acabamentoId })
      }

      onAtualizado(atual)
      setRecado('Aplicado ao projeto.')
    } catch {
      setErro('Não foi possível aplicar. Confira os valores e tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  async function alternarConferencia(marcado: boolean) {
    try {
      onAtualizado(await setConference(elemento.id, marcado ? 'conferido' : 'pendente'))
    } catch {
      setErro('Não foi possível mudar a conferência.')
    }
  }

  async function excluir() {
    if (!window.confirm(`Excluir "${elemento.name}"? Isso não pode ser desfeito.`)) return
    try {
      await deleteElement(elemento.id)
      onRemovido(elemento.id)
    } catch {
      setErro('Não foi possível excluir.')
    }
  }

  return (
    <div>
      <Rotulo>Propriedades</Rotulo>

      <div className="border-b border-line pb-5">
        <h2 className="mt-4 mb-1.5 text-[17px] font-semibold tracking-[-0.4px]">{elemento.name}</h2>
        <span className="text-xs text-ink-dim">{elemento.kind_label}</span>
      </div>

      <form onSubmit={(e) => void aplicar(e)}>
        <Grupo titulo="Dimensões e posição">
          <div className="grid grid-cols-2 gap-x-3">
            <Campo rotulo="Largura" unidade="m">
              <input
                type="number"
                min="0.1"
                step="0.05"
                value={rascunho.largura}
                onChange={(e) => setRascunho({ ...rascunho, largura: e.target.value })}
                className={entradaClasse}
              />
            </Campo>
            <Campo rotulo="Altura" unidade="m">
              <input
                type="number"
                min="0.1"
                step="0.05"
                value={rascunho.altura}
                onChange={(e) => setRascunho({ ...rascunho, altura: e.target.value })}
                className={entradaClasse}
              />
            </Campo>
            <Campo rotulo="Posição horizontal" unidade="px">
              <input
                type="number"
                step="1"
                value={rascunho.x}
                onChange={(e) => setRascunho({ ...rascunho, x: e.target.value })}
                className={entradaClasse}
              />
            </Campo>
            <Campo rotulo="Altura da base" unidade="px">
              <input
                type="number"
                step="1"
                value={rascunho.y}
                onChange={(e) => setRascunho({ ...rascunho, y: e.target.value })}
                className={entradaClasse}
              />
            </Campo>
          </div>

          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-soft">
            <input
              type="checkbox"
              checked={conferida}
              onChange={(e) => void alternarConferencia(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Medidas conferidas no local
          </label>

          {!conferida && (
            <p className="mt-2 text-[11px] leading-[1.5] text-warn">
              Sem conferência a medida vale como estimativa, e aparece rotulada
              assim no orçamento.
            </p>
          )}
        </Grupo>

        <Grupo titulo="Material e acabamento">
          <Campo rotulo="Material">
            <select
              value={materialId}
              onChange={(e) => {
                setMaterialId(e.target.value)
                setAcabamentoId('')
              }}
              className={entradaClasse}
            >
              <option value="">Selecione…</option>
              {materiais.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Acabamento">
            <select
              value={acabamentoId}
              onChange={(e) => setAcabamentoId(e.target.value)}
              disabled={!materialId}
              className={entradaClasse}
            >
              <option value="">{materialId ? 'Selecione…' : 'Escolha o material antes'}</option>
              {acabamentos.map((acabamento) => (
                <option key={acabamento.id} value={acabamento.id}>
                  {acabamento.name}
                </option>
              ))}
            </select>
          </Campo>

          <span className="mb-3 block text-xs text-ink-soft">Cor de referência</span>
          <div className="flex flex-wrap gap-2.5">
            {acabamentos.map((acabamento) => (
              <button
                key={acabamento.id}
                type="button"
                onClick={() => setAcabamentoId(acabamento.id)}
                title={`${acabamento.name} · ${acabamento.color_name}`}
                aria-label={`${acabamento.name}, cor ${acabamento.color_name}`}
                aria-pressed={acabamento.id === acabamentoId}
                className={`size-6 rounded-full border border-line ${
                  acabamento.id === acabamentoId
                    ? 'outline outline-1 outline-offset-[3px] outline-ink-soft'
                    : ''
                }`}
                style={{ background: acabamento.color_hex }}
              />
            ))}
            {materialId && acabamentos.length === 0 && (
              <span className="text-[11px] text-ink-dim">
                Este material ainda não tem acabamento cadastrado.
              </span>
            )}
          </div>

          {corEscolhida && (
            <div className="mt-[15px] flex items-center gap-2.5 text-xs">
              <span
                className="size-[18px] rounded-[3px] border border-line"
                style={{ background: corEscolhida.color_hex }}
              />
              {corEscolhida.color_name}
            </div>
          )}

          <p className="mt-3 text-[11px] leading-[1.5] text-ink-dim">
            As cores vêm do catálogo cadastrado, não de uma paleta da tela.
          </p>
        </Grupo>

        <Grupo titulo="Identidade visual">
          <Campo rotulo="Texto aplicado">
            <input
              maxLength={200}
              value={rascunho.texto}
              onChange={(e) => setRascunho({ ...rascunho, texto: e.target.value })}
              placeholder="Nome ou identificação"
              className={entradaClasse}
            />
          </Campo>
          <p className="text-[11px] leading-[1.5] text-ink-dim">
            Guardado junto das observações do elemento: o servidor ainda não tem
            um campo próprio para o texto aplicado.
          </p>
        </Grupo>

        <Botao tipo="submit" principal largo disabled={salvando}>
          {salvando ? 'Aplicando…' : 'Aplicar ao projeto'}
        </Botao>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Botao
            onClick={() => setErro('Duplicar ainda não existe no servidor.')}
            title="Ainda não disponível"
          >
            Duplicar
          </Botao>
          <Botao onClick={() => void excluir()}>Excluir</Botao>
        </div>

        {recado && <p className="mt-3 text-xs text-good">{recado}</p>}
        {erro && <p className="mt-3 text-xs text-bad">{erro}</p>}
      </form>
    </div>
  )
}
