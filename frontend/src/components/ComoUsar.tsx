import type { ReactNode } from 'react'
import { Rotulo } from './prototipo/pecas'

/**
 * "Como usar" — o passo a passo da ferramenta, aberto pela barra do painel.
 *
 * Escrito para quem usa (equipe da obra/comercial), não para quem programa:
 * o que fazer em cada etapa e o que cuidar para o resultado sair com
 * qualidade. Descreve só o que a ferramenta faz hoje; quando o fluxo mudar,
 * este texto muda junto.
 */

type Passo = { titulo: string; onde: string; itens: ReactNode[] }

const PASSOS: Passo[] = [
  {
    titulo: 'Crie o projeto',
    onde: 'Botão "＋ Novo projeto", no topo',
    itens: [
      'Informe o nome do projeto, o cliente e o local da obra.',
      'Para abrir outro projeto depois, use o botão "Projetos" (ou clique no logo).',
    ],
  },
  {
    titulo: 'Fotografe e envie as fotos',
    onde: 'Aba 01 Levantamento › Fotos organizadas por área',
    itens: [
      <>Fotografe <b>de frente</b> para a fachada, com ela inteira no quadro. Foto muito de lado perde precisão de medida.</>,
      'Boa luz, sem zoom digital e sem filtro. Prefira a câmera normal do celular.',
      'Uma foto por vista; escolha a área (Fachada principal, Lateral, Totem) antes de enviar.',
      'A foto original nunca é alterada: tudo o que se faz depois é uma cópia.',
    ],
  },
  {
    titulo: 'Calibre a escala de cada foto',
    onde: 'Aba 01 › clique na foto › Calibração da escala',
    itens: [
      <>Marque na foto as <b>duas pontas de uma medida conferida no local</b> (ex.: a largura da testeira ou de uma porta).</>,
      <>Quanto <b>maior</b> a medida usada, mais precisa fica a escala. Evite medidas pequenas.</>,
      'Informe a distância real em metros, clique em "Calibrar fotografia" e depois em "Salvar medida desta foto".',
      'Sem calibração, as medidas são só estimativa — e aparecem marcadas assim.',
    ],
  },
  {
    titulo: 'Monte o projeto',
    onde: 'Aba 01 › Propriedades',
    itens: [
      'Escolha o elemento (testeira, pilar, totem) e ajuste largura, altura, posição, material, cor e texto.',
      <>Marque "Medidas conferidas no local" <b>só</b> quando a medida foi conferida de verdade.</>,
      'Clique em "Aplicar ao projeto" e, no topo, em "Salvar estudo" para não perder a composição.',
    ],
  },
  {
    titulo: 'Cadastre os elementos para o orçamento',
    onde: 'Aba 02 Projeto visual › Elementos e medidas',
    itens: [
      'Os elementos cadastrados aqui, com medida conferida, são os que entram no quantitativo e no orçamento.',
    ],
  },
  {
    titulo: 'Marque onde a imagem pode mudar',
    onde: 'Aba 02 › Máscaras e proteção',
    itens: [
      <>Desenhe a <b>área de intervenção</b>: só ali a imagem pode mudar.</>,
      <>Marque como <b>proteção</b> portas, janelas e o que não pode ser alterado.</>,
      'Marque só o revestimento, sem incluir as aberturas.',
    ],
  },
  {
    titulo: 'Renderize o projeto',
    onde: 'Aba 02 › Renderizar projeto',
    itens: [
      <>Antes do render, monte as peças <b>sobre a foto</b> (aba 02 › Sobre a foto) e salve o estudo. A ferramenta desenha uma <b>prévia em escala</b> com as medidas da calibração.</>,
      <>A IA só dá o acabamento realista. O <b>tamanho e o contorno</b> de cada peça são os da prévia: o que a IA desenhar fora disso é descartado.</>,
      <>Tudo o que está <b>fora</b> da área marcada em Máscaras sai idêntico à foto original. Peça fora dessa área não é renderizada — a tela avisa.</>,
      <>Leia a <b>conferência</b> abaixo do render: "Escala garantida" quando está tudo certo, ou os avisos do que conferir. Letras pequenas ainda podem sair imperfeitas: confira o texto.</>,
      'Se não gostar, clique em "Renderizar de novo". Há um limite de renders por hora.',
    ],
  },
  {
    titulo: 'Compare, aprove e apresente',
    onde: 'Aba 02 › Versões e aprovação · Aba 03 Apresentação',
    itens: [
      'Guarde até 3 versões por foto, compare e aprove uma.',
      'Na aba 03, gere a apresentação em PDF e o quantitativo/orçamento.',
    ],
  },
]

const QUALIDADE = [
  'Foto de frente e calibrada com uma medida grande e conferida é o que mais melhora o resultado.',
  'Proteja portas e janelas antes de gerar.',
  'Salve o estudo antes de sair da tela.',
  'A proposta é um estudo visual: não substitui o detalhamento de fabricação e montagem.',
]

export default function ComoUsar() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        O caminho completo, do levantamento à apresentação. Siga na ordem: cada etapa usa o que foi feito na anterior.
      </p>
      <ol className="flex flex-col gap-3">
        {PASSOS.map((passo, i) => (
          <li key={passo.titulo} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-baseline gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-ink">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-ink">{passo.titulo}</h3>
                <p className="text-xs text-ink-dim">{passo.onde}</p>
              </div>
            </div>
            <ul className="mt-2 ml-10 list-disc space-y-1 text-sm text-ink-soft">
              {passo.itens.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <section className="rounded-lg border border-accent bg-accent-soft p-4">
        <Rotulo cor="destaque">Para manter a qualidade</Rotulo>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-ink">
          {QUALIDADE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
