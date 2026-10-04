import { useLocation, useNavigate } from 'react-router-dom'
import { useTema } from '../hooks/useTema'
import * as visualApi from '../api/client'
import type { Project } from '../api/client'
import PresentationPanel from '../components/PresentationPanel'
import TakeoffPanel from '../components/TakeoffPanel'
import MasksDialog from '../components/MasksDialog'
import ProposalDialog from '../components/ProposalDialog'
import VersionsDialog from '../components/VersionsDialog'
import Cabecalho from '../components/layout/Cabecalho'
import ProjetosDialog from '../components/ProjetosDialog'
import JanelaPainel from '../components/JanelaPainel'
import CatalogPage from './CatalogPage'
import { useAuth } from '../auth/context'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createArea,
  createElement,
  getMediaLimits,
  listAreaPhotos,
  listAreas,
  listElements,
  uploadPhoto,
} from '../api/client'
import type { Area, MediaLimits, Photo, SurveyElement } from '../api/client'
import PhotoThumb from '../components/PhotoThumb'
import BlocoFotoAberta from '../components/prototipo/BlocoFotoAberta'
import CardsEtapa from '../components/prototipo/CardsEtapa'
import PainelEstrutura from '../components/prototipo/PainelEstrutura'
import PainelPropriedades from '../components/prototipo/PainelPropriedades'
import { Botao, Cartao, Rotulo, entradaClasse } from '../components/prototipo/pecas'
import Moldura from '../components/layout/Moldura'
import { useProjetoAtual } from '../contexts/ProjetoAtual'
import { ErrorNotice, Loading } from '../components/ui'

/**
 * A etapa 01 do protótipo, na estrutura dele: elementos à esquerda, o trabalho
 * no meio, propriedades à direita.
 *
 * ## Por que tudo mora aqui
 *
 * As três colunas conversam: escolher uma foto no meio troca a lista da
 * esquerda, e escolher um elemento na esquerda troca o painel da direita. Esse
 * estado tem de morar num lugar só, acima das três — senão cada coluna
 * adivinha o que as outras estão mostrando.
 *
 * ## O que substituiu os modais
 *
 * As propriedades do elemento abriam numa janela por cima. Agora ficam na
 * coluna da direita, visíveis enquanto se trabalha — como no protótipo. As
 * outras janelas (escala, máscaras, proposta, versões) continuam existindo e
 * seguem pelos botões de cada foto até terem sua própria fatia.
 */

type AreaComFotos = { area: Area; fotos: Photo[] }

const AREAS_DO_PROTOTIPO = ['Fachada principal', 'Lateral', 'Totem e acesso']
function nomesDeAreasDisponiveis(cadastradas: string[]) {
  return [...cadastradas, ...AREAS_DO_PROTOTIPO.filter(nome =>
    !cadastradas.some(atual => atual.toLocaleLowerCase() === nome.toLocaleLowerCase()))]
}

function LevantamentoPersistido({ projectId }: { projectId: string }) {
  const { projeto } = useProjetoAtual()
  const bibliotecaFotos = useRef<HTMLHeadingElement>(null)

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [grupos, setGrupos] = useState<AreaComFotos[]>([])
  const [limites, setLimites] = useState<MediaLimits | null>(null)

  const [areaDestino, setAreaDestino] = useState('')
  const [fotoAberta, setFotoAberta] = useState<string | null>(null)
  const [elementos, setElementos] = useState<SurveyElement[]>([])
  const [carregandoElementos, setCarregandoElementos] = useState(false)
  const [elementoAberto, setElementoAberto] = useState<string | null>(null)

  const [enviando, setEnviando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const seletorArquivo = useRef<HTMLInputElement>(null)

  const buscar = useCallback(() => listAreas(projectId)
    .then(async areas => {
      const comFotos = await Promise.all(areas.map(async area => ({ area, fotos: await listAreaPhotos(area.id) })))
      setGrupos(comFotos)
      setAreaDestino((atual) => atual || (areas[0]?.id ?? 'preset:Fachada principal'))
    }).catch(() => {
      setErro('Não foi possível carregar as áreas deste projeto.')
    }).finally(() => {
      setCarregando(false)
    }), [projectId])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    await buscar()
  }, [buscar])

  useEffect(() => {
    void buscar()
  }, [buscar])

  useEffect(() => {
    let vivo = true
    void getMediaLimits()
      .then((valor) => {
        if (vivo) setLimites(valor)
      })
      .catch(() => {
        if (vivo) setLimites(null)
      })
    return () => {
      vivo = false
    }
  }, [])

  // Os elementos são da foto aberta: trocar de foto troca a coluna da esquerda.
  useEffect(() => {
    if (!fotoAberta) return
    let vivo = true
    void listElements(fotoAberta)
      .then((lista) => {
        if (!vivo) return
        setElementos(lista)
        setElementoAberto(lista[0]?.id ?? null)
      })
      .catch(() => {
        if (vivo) setElementos([])
      })
      .finally(() => {
        if (vivo) setCarregandoElementos(false)
      })
    return () => {
      vivo = false
    }
  }, [fotoAberta])

  const todasAsFotos = useMemo(() => grupos.flatMap((g) => g.fotos), [grupos])

  const estado = useMemo(
    () => ({
      fotos: todasAsFotos.length,
      areas: grupos.length,
      calibradas: todasAsFotos.filter((f) => f.calibrated).length,
      elementos: elementos.length,
      conferidos: elementos.filter((e) => e.conference.status === 'conferido').length,
    }),
    [todasAsFotos, grupos.length, elementos],
  )

  const elementoSelecionado = elementos.find((e) => e.id === elementoAberto) ?? null
  const fotoSelecionada = todasAsFotos.find((f) => f.id === fotoAberta) ?? null

  async function novaArea() {
    const nome = window.prompt('Nome da nova área (ex.: Fachada principal)')?.trim()
    if (!nome) return
    try {
      const area = await createArea(projectId, { name: nome })
      setGrupos((atual) => [...atual, { area, fotos: [] }])
      setAreaDestino(area.id)
    } catch {
      setRecado('Não foi possível criar a área.')
    }
  }

  function escolherArquivos(areaId?: string) {
    if (areaId) setAreaDestino(areaId)
    setRecado(null)
    seletorArquivo.current?.click()
  }

  async function enviarArquivos(lista: FileList | null) {
    if (!lista || lista.length === 0) return
    let destino = areaDestino || grupos[0]?.area.id || 'preset:Fachada principal'
    setEnviando(true)
    setRecado(null)
    try {
      if (destino.startsWith('preset:')) {
        const nome = destino.slice('preset:'.length)
        const area = grupos.find(g => g.area.name.toLocaleLowerCase() === nome.toLocaleLowerCase())?.area
          ?? await createArea(projectId, { name: nome })
        destino = area.id
        setGrupos(atual => atual.some(g => g.area.id === area.id) ? atual : [...atual, { area, fotos: [] }])
        setAreaDestino(area.id)
      }
      for (const arquivo of Array.from(lista)) {
        const foto = await uploadPhoto(destino, arquivo, setProgresso)
        setGrupos((atual) =>
          atual.map((g) => (g.area.id === destino ? { ...g, fotos: [...g.fotos, foto] } : g)),
        )
      }
    } catch {
      setRecado('Não foi possível enviar. Confira o tamanho e o formato do arquivo.')
    } finally {
      setEnviando(false)
      setProgresso(0)
      if (seletorArquivo.current) seletorArquivo.current.value = ''
    }
  }

  async function novoElemento() {
    if (!fotoAberta) return
    const nome = window.prompt('Nome do elemento (ex.: Testeira principal)')?.trim()
    if (!nome) return
    try {
      const elemento = await createElement(fotoAberta, {
        name: nome,
        kind: 'outro',
        box: { x: 0, y: 0, width: 100, height: 100 },
      })
      setElementos((atual) => [...atual, elemento])
      setElementoAberto(elemento.id)
    } catch {
      setRecado('Não foi possível criar o elemento.')
    }
  }

  if (carregando) {
    return (
      <Moldura>
        <Loading label="Carregando levantamento…" />
      </Moldura>
    )
  }

  if (erro) {
    return (
      <Moldura>
        <ErrorNotice message={erro} onRetry={() => void carregar()} />
      </Moldura>
    )
  }

  return (
    <Moldura
      esquerda={
        <PainelEstrutura
          elementos={elementos}
          selecionado={elementoAberto}
          onSelecionar={setElementoAberto}
          onNovo={() => void novoElemento()}
          onAdicionarFoto={() => escolherArquivos()}
          temFoto={Boolean(fotoAberta)}
          carregando={carregandoElementos}
        />
      }
      direita={
        elementoSelecionado ? (
          <PainelPropriedades
            elemento={elementoSelecionado}
            onAtualizado={(atualizado) =>
              setElementos((atual) =>
                atual.map((e) => (e.id === atualizado.id ? atualizado : e)),
              )
            }
            onRemovido={(id) => {
              setElementos((atual) => atual.filter((e) => e.id !== id))
              setElementoAberto(null)
            }}
          />
        ) : undefined
      }
    >
      <input
        ref={seletorArquivo}
        type="file"
        accept={limites?.accepted_content_types.join(',')}
        multiple
        hidden
        onChange={(e) => void enviarArquivos(e.target.files)}
      />

      <div className="mb-[30px]">
        <Rotulo>Levantamento</Rotulo>
        <h1 className="mt-[7px] text-[27px] leading-tight font-medium tracking-[-1px]">
          A base do projeto.
        </h1>
      </div>

      <CardsEtapa projectId={projectId} atual={estado.fotos ? 2 : 1} estado={estado}
        onFotoDoLocal={() => {
          bibliotecaFotos.current?.scrollIntoView({ block: 'start' })
          bibliotecaFotos.current?.focus({ preventScroll: true })
        }}
      />

      {/* Projeto atual — o bloco em destaque do protótipo. */}
      <div className="mb-3.5 flex items-center justify-between gap-5 rounded border border-[#f1d2e1] border-l-4 border-l-accent bg-[linear-gradient(110deg,#fff3f8_0%,#fff_56%,#f1fbfa_100%)] px-5 py-[18px] shadow-[0_8px_24px_rgba(207,7,95,.05)] [html[data-theme=dark]_&]:bg-[linear-gradient(110deg,var(--color-accent-soft)_0%,var(--color-surface)_56%,var(--color-brand-soft)_100%)]">
        <div className="min-w-0">
          <Rotulo cor="marca">Projeto atual</Rotulo>
          <h2 className="mt-[7px] mb-1 truncate text-[19px] font-semibold">
            {projeto?.name ?? 'Projeto'}
          </h2>
          <p className="truncate text-xs text-ink-soft">
            {projeto?.client?.name ?? 'Cliente não informado'} ·{' '}
            {projeto?.location?.name ?? 'Endereço ou unidade ainda não informado.'}
          </p>
        </div>
      </div>

      {/* Biblioteca de fotos por área. */}
      <Cartao>
        <div className="flex items-start justify-between gap-5">
          <div>
            <Rotulo cor="destaque">Etapa 01 · Levantamento fotográfico</Rotulo>
            <h2 ref={bibliotecaFotos} tabIndex={-1} className="mt-2 mb-[5px] text-xl font-semibold">Fotos organizadas por área</h2>
            <p className="text-xs text-ink-dim">
              Adicione todas as vistas necessárias e calibre cada imagem separadamente.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Botao onClick={() => void novaArea()}>＋ Nova área</Botao>
            <Botao principal onClick={() => escolherArquivos()} disabled={enviando}>
              {enviando ? `Enviando… ${progresso}%` : '＋ Adicionar fotos'}
            </Botao>
          </div>
        </div>

        <div className="flex items-end justify-between gap-4 border-b border-line-soft pt-[18px] pb-3.5">
          <label className="m-0 min-w-[220px] text-xs text-ink-soft">
            Área das próximas fotos
            <select
              value={areaDestino}
              onChange={(e) => setAreaDestino(e.target.value)}
              className={entradaClasse}
            >
              {nomesDeAreasDisponiveis(grupos.map(g => g.area.name)).map(nome => {
                const area = grupos.find(g => g.area.name === nome)?.area
                return <option key={nome} value={area?.id ?? `preset:${nome}`}>{nome}</option>
              })}
            </select>
          </label>
          <small className="text-[11px] text-ink-dim">
            {limites
              ? `${limites.accepted_labels.join(', ')} · até ${limites.max_upload_mb} MB por imagem`
              : 'Carregando limites…'}
          </small>
        </div>

        {enviando && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-brand transition-all" style={{ width: `${progresso}%` }} />
          </div>
        )}

        <div className="mt-3.5 grid gap-2.5">
          {grupos.map(({ area, fotos }) => (
            <div key={area.id} className="border border-[#efdee6] bg-raised">
              <div className="flex items-center justify-between border-b border-[#efdee6] px-3 py-2.5">
                <div className="min-w-0">
                  <b className="text-xs">{area.name}</b>
                  <small className="ml-2 text-[10px] text-ink-dim">
                    {fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}
                  </small>
                </div>
                <Botao miudo onClick={() => escolherArquivos(area.id)} disabled={enviando}>
                  ＋ Foto
                </Botao>
              </div>

              {fotos.length === 0 ? (
                <div className="grid min-h-[56px] w-full place-items-center text-[11px] text-ink-dim">
                  Nenhuma imagem nesta área
                </div>
              ) : (
                <div className="flex min-h-[76px] gap-2 overflow-x-auto p-[9px]">
                  {fotos.map((foto) => {
                    const aberta = foto.id === fotoAberta
                    return (
                      <button
                        key={foto.id}
                        type="button"
                        onClick={() => {
                          setElementos([])
                          setElementoAberto(null)
                          setCarregandoElementos(!aberta)
                          setFotoAberta(aberta ? null : foto.id)
                        }}
                        aria-pressed={aberta}
                        className={`flex w-[205px] shrink-0 items-center gap-[9px] rounded border bg-surface p-1.5 text-left transition ${
                          aberta
                            ? 'border-brand shadow-[inset_0_0_0_1px_var(--color-brand)]'
                            : 'border-line hover:border-accent'
                        }`}
                      >
                        <span className="size-[52px] w-16 shrink-0 overflow-hidden rounded-[3px] bg-raised">
                          <PhotoThumb photo={foto} alt={foto.original_filename} />
                        </span>
                        <span className="min-w-0">
                          <b className="block max-w-[115px] truncate text-[10px] text-ink-soft">
                            {foto.original_filename}
                          </b>
                          <small
                            className={`mt-1.5 block text-[9px] ${
                              foto.calibrated ? 'text-accent-strong' : 'text-warn'
                            }`}
                          >
                            {foto.calibrated ? 'medida salva' : 'falta calibrar'}
                          </small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {grupos.length === 0 && (
          <div className="mt-3.5 border border-dashed border-line-accent bg-[linear-gradient(135deg,var(--color-surface)_0%,var(--color-accent-soft)_100%)] p-10 text-center">
            <Rotulo>Nenhuma área criada</Rotulo>
            <h2 className="mt-2 mb-2 text-[22px] font-medium">Comece pela fachada principal.</h2>
            <p className="mx-auto max-w-md text-[13px] leading-[1.7] text-ink-dim">
              A imagem real será usada para calibrar a escala e posicionar a nova
              identidade visual.
            </p>
            <div className="mt-5 inline-block">
              <Botao principal onClick={() => void novaArea()}>
                Criar a primeira área
              </Botao>
            </div>
          </div>
        )}

        {recado && <p className="mt-3 text-xs text-bad">{recado}</p>}
      </Cartao>

      {/* Assim que uma foto é escolhida, o trabalho dela aparece logo abaixo —
          é onde o protótipo põe a etapa 02. */}
      {fotoSelecionada && (
        <BlocoFotoAberta
          foto={fotoSelecionada}
          onMudou={() => void carregar()}
          onRemovida={(id) => {
            setGrupos((atual) =>
              atual.map((g) => ({ ...g, fotos: g.fotos.filter((f) => f.id !== id) })),
            )
            setFotoAberta(null)
          }}
        />
      )}
    </Moldura>
  )
}


// The approved HTML/CSS is isolated from Tailwind. Only this React-owned DOM island
// is imperative; authentication, routing, API client and existing tools stay intact.
const VISUAL_HTML = `
<header><a class="brand" href="./" aria-label="ENBY PRO"><img src="/enby-pro-logo.png" alt="ENBY PRO"></a><div class="project-name"><input id="projectName" aria-label="Nome do projeto" value="Estudo de identidade · Posto Horizonte"><small id="projectMeta">Projeto demonstrativo · local não informado</small></div><button id="openProjects" title="Abrir outro projeto">Projetos</button><button id="newProject">＋ Novo projeto</button><button id="download">Baixar estudo</button><button class="primary" id="present">Apresentar projeto ↗</button></header>
<nav class="stages" aria-label="Etapas do projeto"><button class="active" data-tab="survey">01 <span>Levantamento</span></button><button data-tab="design">02 <span>Projeto visual</span></button><button data-tab="presentation">03 <span>Apresentação</span></button><button class="prototype" id="serverTools" title="Abrir funções existentes e dados persistidos">Ferramentas do projeto</button></nav>
<div id="loadStatus" role="status"></div><main><aside class="left"><div class="section-title">ESTRUTURA DO PROJETO</div><h2>Elementos da obra</h2><p class="muted">Selecione um elemento para definir suas dimensões e acabamento.</p><div id="elements"></div><button class="add-element" id="addElement">＋ Novo elemento</button><div class="side-note"><span>REFERÊNCIA DO LOCAL</span><button id="uploadSide">＋ Adicionar fotografia</button><p>A foto original permanece como referência do levantamento.</p></div><div class="side-bottom"><span>Unidade do projeto</span><b>Metros (m)</b><small>Vista frontal proporcional</small></div></aside>
<section class="workspace"><div class="work-head"><div><span class="eyebrow" id="workEyebrow">LEVANTAMENTO</span><h1 id="workTitle">A base do projeto.</h1></div><div class="view-tools" hidden><div class="segmented" id="viewMode"><button class="active" data-view="elevation">Elevação</button><button data-view="photo">Sobre a foto</button></div><button id="dimensions" aria-pressed="true">Cotas visíveis</button><button id="resetView">Ajustar vista</button></div></div><div class="project-progress" id="projectProgress"><button class="active" data-go="survey"><span>01</span><div><b>Foto do local</b><small id="photoStatus">Adicionar fotografia</small></div></button><button data-go="survey"><span>02</span><div><b>Definir escala</b><small id="scaleStatus">Aguardando foto</small></div></button><button data-go="design"><span>03</span><div><b>Montar projeto</b><small id="elementStatus">4 elementos de exemplo</small></div></button><button data-go="presentation"><span>04</span><div><b>Apresentar</b><small id="presentationStatus">Pendente</small></div></button></div>
<section id="survey"><div class="survey-project"><div><span class="step-kicker">PROJETO ATUAL</span><h2 id="surveyProjectTitle">Posto Horizonte</h2><p id="surveyProjectMeta">Cliente e endereço ainda não informados.</p></div><button id="editProject">Editar dados</button></div><div class="photo-library"><div class="library-head"><div><span class="step-kicker">ETAPA 01 · LEVANTAMENTO FOTOGRÁFICO</span><h2>Fotos organizadas por área</h2><p>Adicione todas as vistas necessárias e calibre cada imagem separadamente.</p></div><div class="library-actions"><button id="addArea">＋ Nova área</button><button class="primary" id="uploadMain">＋ Adicionar fotos</button></div></div><div class="area-select-row"><label>Área das próximas fotos<select id="uploadArea"><option>Fachada principal</option><option>Lateral</option><option>Totem e acesso</option></select></label><small>JPG, PNG ou WebP · até 15 MB por imagem</small></div><div id="photoAreas" class="photo-areas"></div></div><div class="upload-box" id="uploadBox"><span class="step-kicker">NENHUMA FOTO ADICIONADA</span><h2>Comece pela fachada principal.</h2><p>A imagem real será usada para calibrar a escala e posicionar a nova identidade visual.</p><button class="primary" id="uploadEmpty">Selecionar fotografias</button></div><div id="calibration" hidden><div class="calibration-title"><div><span class="step-kicker">ETAPA 02 · ESCALA DA FOTOGRAFIA</span><h2 id="activePhotoName">Fotografia selecionada</h2></div><span id="activePhotoArea" class="area-badge">Fachada principal</span></div><div class="calibration-layout"><div class="photo-stage calibration-stage" id="calibrationStage"><img id="surveyPhoto" alt="Fotografia enviada do local"><svg id="calibrationOverlay" aria-label="Pontos usados para calibrar a fotografia"></svg><div class="stage-hint" id="stageHint">Clique no primeiro ponto da medida conhecida</div></div><aside class="calibration-panel"><span class="section-title">CALIBRAÇÃO DA ESCALA</span><h2>Uma medida conhecida</h2><p>Marque na foto as duas extremidades de uma medida conferida no local.</p><div class="calibration-points"><span id="pointA">Ponto A · aguardando</span><span id="pointB">Ponto B · aguardando</span></div><label>Distância real <span>m</span><input id="referenceDistance" placeholder="Informe a medida real" type="number" min="0.1" step="0.01" value=""></label><button id="calibrate" class="primary wide" disabled>Calibrar fotografia</button><button id="clearCalibration" class="wide">Marcar novamente</button><div class="calibration-result" id="calibrationResult">A escala ainda não foi definida.</div><button id="saveMeasurement" class="wide" disabled>Salvar medida desta foto</button><button id="usePhoto" class="wide" disabled>Usar no projeto visual →</button></aside></div></div></section>
<div id="design" hidden><div id="elevationView"><div class="drawing-board"><div class="board-label">ELEVAÇÃO FRONTAL <span>Estudo dimensional</span></div><svg id="drawing" role="img" aria-label="Elevação frontal do projeto com dimensões proporcionais"></svg><div class="board-bottom"><span id="extent"></span><span>Dimensões do exemplo, editáveis</span></div></div></div><div id="photoView" hidden><div class="surface-toolbar" id="surfaceToolbar"><div class="tool-group"><button id="markSurface" class="active-tool">⌖ Marcar área</button><button id="finishSurface" disabled>Concluir contorno</button><button id="undoSurface" disabled>Desfazer ponto</button><button id="clearSurface" disabled>Excluir área</button></div><div class="surface-status"><span></span><b id="surfaceStatus">Clique nos cantos da área que receberá ACM</b></div></div><div class="photo-stage composition-stage" id="compositionStage"><img id="compositionPhoto" alt="Fotografia de referência do projeto"><svg id="compositionOverlay" aria-label="Áreas de acabamento e projeto proporcional aplicados sobre a fotografia"></svg><div class="empty-photo" id="emptyPhoto"><b>Adicione e calibre uma fotografia</b><span>Depois você poderá marcar as áreas que receberão ACM.</span><button id="addPhotoFromDesign">Ir para levantamento</button></div></div></div><div class="under-board"><div><b id="selectionSummary">Testeira principal</b><span id="measureSummary"></span></div><label class="opacity-control" id="opacityControl" hidden>Opacidade <input type="range" min="20" max="100" value="82" id="overlayOpacity"><output id="opacityValue">82%</output></label><label class="zoom">Zoom <input type="range" min="70" max="150" value="100" id="zoom"><output id="zoomValue">100%</output></label></div></div>
<section id="presentation" hidden><div class="presentation-intro"><span class="step-kicker">ESTUDO DE COMUNICAÇÃO VISUAL</span><h2 id="presentationName"></h2><p id="presentationClient"></p><p>Simulação visual para avaliação de cores, materiais e composição.</p></div><div id="presentationPhotos"></div><h2>Elevação e dimensões</h2><div id="presentationDrawing" class="drawing-board"></div><div class="presentation-specs"><h2>Materiais e medidas</h2><div class="table-scroll"><table><thead><tr><th>Elemento / área</th><th>Material e acabamento</th><th>Cor</th><th>Dimensões</th><th>Conferência</th></tr></thead><tbody id="presentationMaterials"></tbody></table></div></div><div class="presentation-actions"><button id="exportSvg" class="primary">Baixar elevação SVG</button><button id="print">Imprimir estudo / PDF</button></div><p class="muted">Estudo visual — não constitui detalhamento de fabricação ou montagem.</p></section>
<footer><span>Estudo visual · salve a composição antes de sair</span><span id="stateNote">Sem medidas verificadas</span></footer></section>
<aside class="right"><div class="section-title">PROPRIEDADES</div><div id="elementProperties"><div class="object-heading"><h2 id="objectTitle"></h2><span id="objectType">Revestimento</span></div><form id="properties"><fieldset><legend>Dimensões e posição</legend><div class="fields"><label>Largura <span>m</span><input id="width" type="number" min="0.1" max="30" step="0.05" required></label><label>Altura <span>m</span><input id="height" type="number" min="0.1" max="15" step="0.05" required></label><label>Posição horizontal <span>m</span><input id="x" type="number" min="0" max="30" step="0.05" required></label><label>Altura da base <span>m</span><input id="y" type="number" min="0" max="15" step="0.05" required></label></div><label class="check"><input id="confirmed" type="checkbox"> Medidas conferidas no local</label></fieldset><fieldset><legend>Material e acabamento</legend><label>Material<select id="material"><option>ACM</option><option>Acrílico</option><option>Chapa pintada</option><option>Inox</option><option>PVC</option></select></label><label>Acabamento<select id="finish"><option>Fosco</option><option>Brilhante</option><option>Escovado</option></select></label><label>Cor de referência</label><div class="swatches" id="swatches"></div><div class="color-row"><input id="color" type="color" aria-label="Cor personalizada"><span id="colorName"></span></div><p class="hint">Paleta ilustrativa. Confira os materiais cadastrados e o catálogo físico.</p></fieldset><fieldset><legend>Identidade visual</legend><label>Texto aplicado<input id="label" maxlength="35" placeholder="Nome ou identificação"></label></fieldset><button class="primary wide" type="submit">Aplicar ao projeto</button><div class="object-actions"><button id="duplicateElement" type="button">Duplicar</button><button id="deleteElement" type="button">Excluir</button></div><p id="formMessage" role="status"></p></form></div><section id="surfaceProperties" hidden><div class="object-heading"><h2 id="surfaceTitle">Nova área de ACM</h2><span>Revestimento sobre a fotografia</span></div><fieldset><legend>Material</legend><label>Revestimento<select id="surfaceMaterial"><option>ACM</option><option>Acrílico</option><option>Chapa pintada</option><option>Adesivo</option></select></label><label>Acabamento<select id="surfaceFinish"><option>Brilhante</option><option>Fosco</option><option>Escovado</option></select></label></fieldset><fieldset><legend>Cores ACM</legend><p class="hint">Cores ilustrativas para estudo; conferir com o catálogo físico.</p><div class="catalog-grid" id="catalogColors"></div><div class="catalog-selected"><span id="catalogColorDot"></span><div><small>Cor selecionada</small><b id="catalogColorName">Branco</b></div></div></fieldset><fieldset><legend>Visualização</legend><div class="segmented surface-light" id="lightMode"><button class="active" data-light="day">Dia</button><button data-light="night">Noite</button></div><label class="surface-opacity">Intensidade do material<input type="range" min="25" max="95" value="74" id="surfaceOpacity"><output id="surfaceOpacityValue">74%</output></label><label class="check"><input id="preserveOpenings" type="checkbox" checked> Contorno respeita portas e janelas</label><p class="hint">Marque apenas o revestimento, sem incluir aberturas. Use Máscaras e proteção para preservar portas e janelas na geração.</p></fieldset><div class="surface-metrics"><span>Área marcada</span><b id="surfaceArea">Aguardando contorno</b><small>Estimativa pela escala da foto; confira no local.</small></div><button class="primary wide" id="applySurface" disabled>Aplicar acabamento</button><button class="wide" id="newSurface">＋ Marcar outra superfície</button><p id="surfaceMessage" role="status"></p></section></aside></main>
<input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp" multiple hidden><dialog id="projectDialog"><form method="dialog" id="projectForm"><div class="dialog-head"><div><span class="step-kicker">DADOS DO LEVANTAMENTO</span><h2>Novo projeto</h2></div><button type="button" id="closeProject" aria-label="Fechar">×</button></div><label>Nome do projeto<input id="dialogProjectName" required placeholder="Ex.: Identidade visual · Posto Horizonte"></label><label>Cliente<input id="clientName" required placeholder="Nome do cliente ou empresa"></label><label>Local da obra<input id="siteLocation" required placeholder="Cidade, endereço ou unidade"></label><div class="dialog-actions"><button type="button" id="cancelProject">Cancelar</button><button class="primary" type="submit">Salvar projeto</button></div></form></dialog><div class="toast" id="toast" role="status"></div>`;
const VISUAL_CSS = `:host{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#303337;background:#fff;font-size:14px;--line:#e5e6e8;--muted:#81858a}*{box-sizing:border-box}.visual-body{margin:0}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #dddfe2;background:white;color:#45494d;border-radius:6px;padding:10px 15px;font-weight:500}button:hover{background:#f2f3f4}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #547488;outline-offset:3px}button:disabled{cursor:not-allowed;opacity:.48}.primary{background:#303438;border-color:#303438;color:white}.primary:hover{background:#484d52}header{display:flex;align-items:center;gap:14px;height:88px;padding:0 28px;border-bottom:1px solid var(--line)}.brand{color:#282c30;text-decoration:none;font-size:23px;letter-spacing:2px;font-weight:800;min-width:210px}.brand span{display:block;font-size:9px;letter-spacing:2px;font-weight:500;margin-top:3px}.project-name{flex:1;border-left:1px solid var(--line);padding-left:24px}.project-name input{border:0;padding:0;font-weight:600;width:100%;background:transparent}.project-name small{display:block;font-size:12px;color:var(--muted);margin-top:7px}.stages{height:60px;display:flex;align-items:stretch;gap:32px;padding:0 28px;border-bottom:1px solid var(--line)}.stages button{border:0;border-radius:0;color:#92959a;font-size:12px;padding:0 2px;background:none}.stages button span{margin-left:8px;font-size:14px}.stages button.active{color:#303438;border-bottom:2px solid #303438}.prototype{margin-left:auto;align-self:center;color:#83878b;font-size:12px}main{display:grid;grid-template-columns:234px minmax(350px,1fr) 294px;min-height:calc(100vh - 148px)}aside{padding:27px 20px}.left{border-right:1px solid var(--line);display:flex;flex-direction:column}.right{border-left:1px solid var(--line)}.section-title,.eyebrow{font-size:10px;letter-spacing:1.5px;font-weight:600;color:#8a8e93}h2{font-size:17px;font-weight:600;letter-spacing:-.4px;margin:16px 0 9px}.muted{color:#80858a;line-height:1.65;font-size:13px}.element{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid transparent;padding:13px 10px;margin:5px 0}.element.active{background:#f0f2f3;border-color:#e0e3e6}.element .square{width:13px;height:13px;border:1px solid #a0a6ad;border-radius:2px}.element span:last-child{margin-left:auto;color:#949a9e;font-size:11px}.side-note{border-top:1px solid var(--line);margin-top:28px;padding-top:24px}.side-note>span{font-size:10px;letter-spacing:1px;color:#8a8e93}.side-note button{margin-top:13px;width:100%;font-size:12px}.side-note p,.side-bottom small{font-size:12px;color:#95999d;line-height:1.6}.side-bottom{margin-top:auto;padding-top:50px;display:grid;gap:7px}.side-bottom span{font-size:12px;color:#95999d}.side-bottom b{font-size:13px;font-weight:500}.workspace{background:#f7f8f9;padding:30px 28px 18px;min-width:0}.work-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:30px}h1{font-size:27px;font-weight:500;letter-spacing:-1px;margin:7px 0 0}.view-tools{display:flex;gap:7px}.view-tools button{font-size:12px;padding:8px 10px;background:transparent}.drawing-board{position:relative;background:#fff;border:1px solid #e2e5e7;border-radius:3px;min-height:410px;overflow:hidden;box-shadow:0 6px 22px #1b253003}.board-label{position:absolute;top:22px;left:22px;font-size:10px;letter-spacing:1.3px;color:#60676d}.board-label span{display:block;letter-spacing:0;color:#a0a5aa;margin-top:7px}#drawing{width:100%;height:480px;display:block}.board-bottom{display:flex;justify-content:space-between;font-size:10px;color:#969ca1;padding:0 22px 20px}.under-board{display:flex;justify-content:space-between;align-items:center;padding:19px 0;gap:12px}.under-board b{display:block;font-size:13px;font-weight:600}.under-board span{font-size:12px;color:#8a8e93;display:block;margin-top:4px}.zoom{display:flex;align-items:center;gap:9px;font-size:11px;color:#858b90}.zoom input{width:70px;accent-color:#686f74}.object-heading{padding-bottom:20px;border-bottom:1px solid var(--line)}.object-heading span{color:#8b9095;font-size:12px}.object-heading h2{margin-bottom:5px}fieldset{border:0;border-bottom:1px solid var(--line);margin:22px 0;padding:0 0 20px}legend{font-weight:600;font-size:13px;margin-bottom:16px}label{display:block;font-size:12px;color:#777e84;margin-bottom:12px}input:not([type=checkbox]):not([type=range]):not([type=color]),select{width:100%;display:block;margin-top:6px;padding:9px;border:1px solid #e0e3e6;border-radius:5px;color:#383e44;background:#fff;min-width:0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.fields label span{float:right;font-size:10px;color:#a8acb0}.check{display:flex;align-items:center;font-size:11px;gap:5px;margin:5px 0 0}.check input{accent-color:#545e64}.swatches{display:flex;gap:10px}.swatches button{height:24px;width:24px;padding:0;border:1px solid #ccc;border-radius:50%}.swatches button.selected{outline:1px solid #555;outline-offset:3px}.color-row{display:flex;align-items:center;gap:9px;font-size:12px;margin-top:15px}.color-row input{width:26px;height:24px;padding:0;border:0;background:none}.hint{font-size:11px;line-height:1.5;color:#95999d}.wide{width:100%}#formMessage{font-size:12px;color:#657581}footer{display:flex;justify-content:space-between;border-top:1px solid #e1e4e7;padding-top:18px;margin-top:25px;font-size:11px;color:#94999e;gap:15px}.upload-box{background:#fff;border:1px dashed #ccd2d7;padding:40px;text-align:center}.upload-box p{color:#828a91;line-height:1.7}.upload-box small{display:block;margin-top:15px;color:#94999e}.survey-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:22px 0}.survey-grid h3{font-size:14px}.survey-grid p{font-size:13px;line-height:1.6;color:#858b90}#surveyPhoto{width:100%;max-height:420px;object-fit:contain}.presentation-intro p{color:#858b90;line-height:1.7;max-width:520px}.presentation-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}#presentationDrawing svg{width:100%;height:430px}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:15px 20px;background:#303438;color:white;border-radius:7px;display:none;z-index:20}.toast.visible{display:block}[hidden]{display:none!important}.visual-body.presenting .left,.visual-body.presenting .right{display:none}.visual-body.presenting main{grid-template-columns:1fr}.visual-body.presenting .workspace{max-width:1300px;width:100%;margin:auto}svg [data-object]{cursor:pointer}svg [data-object]:hover{opacity:.8}@media(min-width:1600px){#drawing{height:580px}.workspace{padding:35px 40px}}@media(max-width:1150px){main{grid-template-columns:180px minmax(280px,1fr) 250px}aside{padding:22px 14px}.workspace{padding:24px 17px}.work-head{align-items:start;flex-direction:column}header{padding:0 18px}.brand{min-width:150px}header>button{font-size:12px}.project-name{padding-left:14px}}@media(max-width:850px){header{height:auto;min-height:85px;flex-wrap:wrap;padding:16px}.brand{min-width:130px}.project-name{min-width:160px}main{grid-template-columns:1fr}.left{border:0;padding-bottom:12px}.left>.muted,.side-note,.side-bottom{display:none}#elements{display:flex;flex-wrap:wrap}.element{width:auto}.workspace{order:2}.right{order:3;display:block}.right form{max-width:500px}.stages{padding:0 16px;gap:18px}.prototype{display:none}.stages button span{font-size:12px}.work-head{flex-direction:row}.view-tools{flex-direction:column}.under-board{flex-wrap:wrap}.survey-grid{grid-template-columns:1fr}#drawing{height:360px}.drawing-board{min-height:360px}}@media print{header,.stages,aside,.presentation-actions,footer,.work-head{display:none!important}main{display:block}.workspace{padding:0}#presentation{display:block!important}#design,#survey{display:none!important}.drawing-board{border:0}.visual-body{background:white}}

.segmented{display:flex;border:1px solid #dfe2e4;border-radius:6px;overflow:hidden}
.segmented button{border:0;border-radius:0;padding:8px 11px}
.segmented button.active{background:#34393d;color:#fff}
.photo-stage{position:relative;background:#e9ebed;overflow:hidden;border:1px solid #dfe2e4;min-height:440px;display:grid;place-items:center}
.photo-stage img{display:block;width:100%;height:100%;object-fit:contain;position:absolute;inset:0}
.photo-stage svg{position:absolute;inset:0;width:100%;height:100%;z-index:2}
.calibration-layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;background:#fff;border:1px solid #e1e4e6}
.calibration-stage{cursor:crosshair;border:0;border-right:1px solid #e1e4e6}
.calibration-panel{border:0;padding:22px;background:#fff}
.calibration-panel p{font-size:12px;line-height:1.55;color:#858b90}
.calibration-panel label span{float:right;color:#a0a5a9}
.calibration-points{display:grid;gap:7px;margin:18px 0}
.calibration-points span{font-size:11px;padding:9px;background:#f5f6f7;color:#7d8388;border-radius:4px}
.calibration-result{font-size:11px;line-height:1.5;color:#68747c;background:#f1f4f5;padding:11px;margin:12px 0}
.stage-hint{position:absolute;z-index:4;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(43,47,51,.88);color:#fff;font-size:11px;padding:8px 12px;border-radius:4px;white-space:nowrap}
.composition-stage{min-height:480px;background:#e4e6e8}
.composition-stage svg [data-photo-object]{cursor:pointer}
.empty-photo{position:relative;z-index:4;display:grid;text-align:center;justify-items:center;gap:8px;color:#747b80}
.empty-photo b{color:#4f5559}.empty-photo span{font-size:12px}.empty-photo button{margin-top:8px}
.opacity-control{display:flex;align-items:center;gap:9px;font-size:11px;color:#858b90;margin:0}
.opacity-control input{width:78px;accent-color:#686f74}
.calibration-mark{filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))}
@media(max-width:1000px){.calibration-layout{grid-template-columns:1fr}.calibration-stage{border-right:0;border-bottom:1px solid #e1e4e6}.calibration-panel{max-width:none}.photo-stage{min-height:360px}}
@media(max-width:850px){.view-tools{width:100%;flex-direction:row;flex-wrap:wrap}.calibration-layout{display:block}.composition-stage{min-height:360px}.opacity-control{width:100%}}
.add-element{width:100%;margin-top:10px;border-style:dashed;background:#fafbfb;font-size:12px}
.object-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}
.object-actions button{font-size:12px}
#deleteElement{color:#8a4141}
#compositionOverlay.dragging{cursor:grabbing}
#compositionOverlay [data-photo-object]{cursor:grab}
#compositionOverlay [data-photo-object].drag-active{filter:drop-shadow(0 4px 5px rgba(0,0,0,.25))}
.project-progress{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:-10px 0 24px}
.project-progress button{display:flex;align-items:center;gap:10px;text-align:left;padding:12px;background:#fff;border-color:#e3e5e7}
.project-progress button>span{width:27px;height:27px;display:grid;place-items:center;border-radius:50%;background:#f0f2f3;color:#777e83;font-size:10px;font-weight:700;flex:0 0 auto}
.project-progress button b{display:block;font-size:11px;color:#4b5155}
.project-progress button small{display:block;margin-top:3px;font-size:10px;color:#969b9f}
.project-progress button.active{border-color:#69757d;box-shadow:inset 0 -2px #69757d}
.project-progress button.complete>span{background:#4e5d55;color:#fff}
.project-progress button.complete small{color:#557061}
.step-kicker{font-size:10px;letter-spacing:1.3px;color:#8b9297}
.upload-box h2{font-size:22px;font-weight:500;margin-bottom:8px}
@media(max-width:1050px){.project-progress{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.project-progress{grid-template-columns:1fr}.project-progress button{padding:10px}}
.brand{display:flex;align-items:center;width:190px;height:70px;min-width:190px;font-size:0}
.brand img{display:block;width:100%;height:100%;object-fit:contain}
@media(max-width:1150px){.brand{width:160px;min-width:160px;height:59px}}
@media(max-width:850px){.brand{width:145px;min-width:145px;height:54px}}
.survey-project{display:flex;align-items:center;justify-content:space-between;gap:20px;background:#303438;color:#fff;padding:18px 20px;margin-bottom:14px;border-radius:4px}
.survey-project h2{font-size:19px;margin:7px 0 4px}.survey-project p{margin:0;color:#b8bec2;font-size:12px}.survey-project .step-kicker{color:#aeb5ba}.survey-project button{background:transparent;border-color:#60666b;color:#fff}
.photo-library{background:#fff;border:1px solid #e1e4e6;padding:20px;margin-bottom:14px}.library-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.library-head h2{font-size:20px;margin:8px 0 5px}.library-head p{font-size:12px;color:#858b90;margin:0}.library-actions{display:flex;gap:8px;flex:0 0 auto}.area-select-row{display:flex;align-items:end;justify-content:space-between;gap:16px;padding:18px 0 14px;border-bottom:1px solid #eceeef}.area-select-row label{margin:0;min-width:220px}.area-select-row select{margin-top:5px}.area-select-row small{color:#969b9f;font-size:11px}.photo-areas{display:grid;gap:10px;margin-top:14px}.area-group{border:1px solid #e6e8ea;background:#fafbfb}.area-group-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e6e8ea}.area-group-head b{font-size:12px}.area-group-head small{font-size:10px;color:#969b9f;margin-left:8px}.area-group-head button{padding:5px 8px;font-size:10px;background:#fff}.photo-strip{display:flex;gap:8px;overflow:auto;padding:9px;min-height:76px}.photo-card{display:flex;align-items:center;gap:9px;flex:0 0 205px;padding:6px;text-align:left;background:#fff;border-color:#e3e6e8}.photo-card.active{border-color:#4e5960;box-shadow:inset 0 0 0 1px #4e5960}.photo-card img{width:64px;height:52px;object-fit:cover;background:#e7e9ea;border-radius:3px}.photo-card span{min-width:0}.photo-card b,.photo-card small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.photo-card b{max-width:115px;font-size:10px;color:#555c61}.photo-card small{font-size:9px;color:#9a7b54;margin-top:6px}.photo-card small.saved{color:#51705c}.area-empty{display:grid;place-items:center;width:100%;min-height:56px;color:#a1a6aa;font-size:11px}.calibration-title{display:flex;align-items:center;justify-content:space-between;gap:14px;background:#fff;border:1px solid #e1e4e6;border-bottom:0;padding:16px 20px}.calibration-title h2{margin:7px 0 0}.area-badge{font-size:10px;color:#59646b;background:#eef1f2;padding:7px 9px;border-radius:20px}.calibration-panel #saveMeasurement{margin-top:10px;background:#edf1ee;border-color:#d4ded7;color:#425b4a}.calibration-panel #usePhoto{margin-top:8px}
dialog{border:0;border-radius:8px;padding:0;box-shadow:0 24px 80px rgba(23,28,32,.26);width:min(480px,calc(100vw - 32px));color:#303438}dialog::backdrop{background:rgba(31,35,38,.48)}dialog form{padding:24px}.dialog-head{display:flex;align-items:start;justify-content:space-between;margin-bottom:24px}.dialog-head h2{font-size:22px;margin:8px 0 0}.dialog-head button{border:0;font-size:22px;line-height:1;padding:5px 8px}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px;padding-top:18px;border-top:1px solid #e6e8ea}
@media(max-width:1050px){.library-head{display:block}.library-actions{margin-top:14px}.area-select-row{align-items:start;flex-direction:column}.area-select-row label{width:100%}}
@media(max-width:700px){.survey-project,.library-head{align-items:stretch;flex-direction:column}.library-actions{display:grid;grid-template-columns:1fr 1fr}.photo-library{padding:14px}.photo-card{flex-basis:190px}.calibration-title{align-items:start;flex-direction:column}}
.surface-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;background:#fff;border:1px solid #e1e4e6;border-bottom:0;padding:10px 12px}.tool-group{display:flex;gap:6px;flex-wrap:wrap}.tool-group button{font-size:11px;padding:7px 9px}.tool-group button.active-tool{background:#31373b;border-color:#31373b;color:#fff}.surface-status{display:flex;align-items:center;gap:8px;color:#72797e;font-size:11px;text-align:right}.surface-status span{width:7px;height:7px;border-radius:50%;background:#61746a;flex:0 0 auto}.composition-stage.night-mode{background:#171b1e}.composition-stage.night-mode>img{filter:brightness(.36) saturate(.76) contrast(1.08)}.composition-stage.night-mode #compositionOverlay polygon[data-surface-id]{filter:drop-shadow(0 0 5px rgba(255,255,255,.17))}.composition-stage img{transition:filter .25s ease}.catalog-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.catalog-grid button{display:grid;gap:6px;justify-items:center;padding:7px 4px;border-color:#e3e5e6;background:#fff}.catalog-grid button span{width:28px;height:28px;border-radius:50%;border:1px solid rgba(40,45,48,.16)}.catalog-grid button small{font-size:9px;color:#777e83;max-width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.catalog-grid button.selected{border-color:#505a60;box-shadow:inset 0 0 0 1px #505a60}.catalog-selected{display:flex;align-items:center;gap:10px;padding:12px;margin-top:12px;background:#f4f5f6}.catalog-selected>span{width:30px;height:30px;border-radius:50%;border:1px solid rgba(40,45,48,.16)}.catalog-selected small,.catalog-selected b{display:block}.catalog-selected small{font-size:9px;color:#8b9195;margin-bottom:3px}.catalog-selected b{font-size:12px}.surface-light{width:100%;margin-bottom:18px}.surface-light button{flex:1}.surface-opacity{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}.surface-opacity input{grid-column:1/2;width:100%;accent-color:#59636a}.surface-opacity output{grid-column:2/3;grid-row:2;color:#6e767b}.surface-metrics{display:grid;gap:4px;background:#f1f3f4;padding:12px;margin:0 0 14px}.surface-metrics span{font-size:10px;color:#878d91}.surface-metrics b{font-size:12px}.surface-metrics small{font-size:9px;color:#9a9fa3}.surface-metrics+#applySurface{margin-bottom:8px}#surfaceMessage{font-size:11px;color:#60736a}.composition-stage svg polygon[data-surface-id]{cursor:pointer}.composition-stage svg{touch-action:none}
@media(max-width:1100px){.surface-toolbar{align-items:flex-start;flex-direction:column}.surface-status{text-align:left}}
@media(max-width:600px){.catalog-grid{grid-template-columns:repeat(3,1fr)}.surface-toolbar{padding:9px}.tool-group button{flex:1}.surface-status{font-size:10px}}

/* Identidade ENBY PRO: base clara com acentos da marca */
:host{--brand-green:#00bdb5;--brand-green-dark:#008f89;--brand-red:#f20a76;--brand-red-dark:#cf075f;--brand-orange:#f28a2e;--brand-green-soft:#eefaf9;--brand-red-soft:#fff1f7;--brand-orange-soft:#fff6eb;--line:#dce8e7;--muted:#727d80;color:#2d3438}
.visual-body{background:#fff}
button{border-color:#efbfd5;color:#354044}
button:hover{background:var(--brand-red-soft);border-color:#ed79af}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline-color:var(--brand-green)}
.primary{background:var(--brand-green);border-color:var(--brand-green);color:#fff}
.primary:hover{background:var(--brand-green-dark);border-color:var(--brand-green-dark)}
header{position:relative;background:#fff}
header:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:linear-gradient(90deg,var(--brand-red) 0 43%,var(--brand-green) 43% 84%,var(--brand-orange) 84%)}
.workspace{background:#fff9fc}
.stages{background:#fff}
.stages button{color:#7b8588}
.stages button:hover{color:var(--brand-red-dark);background:transparent}
.stages button.active{color:var(--brand-green);border-bottom-color:var(--brand-green)}
.section-title,.eyebrow,.step-kicker{color:var(--brand-red-dark)}
.left,.right{background:#fff}
.element.active{background:var(--brand-red-soft);border-color:#f2a7ca;box-shadow:inset 3px 0 var(--brand-red)}
.element.active .square{border-color:var(--brand-green);background:var(--brand-green-soft)}
.drawing-board,.photo-library,.calibration-layout,.calibration-title,.surface-toolbar{border-color:#efdae4;box-shadow:0 8px 28px rgba(207,7,95,.055)}
.survey-project{background:linear-gradient(110deg,#fff3f8 0%,#fff 56%,#f1fbfa 100%);color:#2d3438;border:1px solid #f1d2e1;border-left:4px solid var(--brand-red);box-shadow:0 8px 24px rgba(207,7,95,.05)}
.survey-project p{color:#697477}
.survey-project .step-kicker{color:var(--brand-green)}
.survey-project button{background:#fff;border-color:#8ed7d2;color:var(--brand-green-dark)}
.survey-project button:hover{background:var(--brand-green-soft);border-color:var(--brand-green)}
.project-progress button{border-color:#eddae4}
.project-progress button:hover{border-color:#ee96bf;background:var(--brand-red-soft)}
.project-progress button.active{border-color:var(--brand-green);box-shadow:inset 0 -3px var(--brand-green);background:var(--brand-green-soft)}
.project-progress button.active>span{background:var(--brand-green);color:#fff}
.project-progress button.complete>span{background:var(--brand-red);color:#fff}
.project-progress button.complete small{color:var(--brand-red-dark)}
.upload-box{border-color:#f0a0c6;background:linear-gradient(135deg,#fff 0%,#fff3f8 100%)}
.add-element{border-color:#f0a0c6;background:var(--brand-red-soft);color:var(--brand-red-dark)}
.area-group{border-color:#efdee6;background:#fffdfd}
.photo-card.active{border-color:var(--brand-green);box-shadow:inset 0 0 0 1px var(--brand-green)}
.photo-card small{color:var(--brand-orange)}
.photo-card small.saved{color:var(--brand-red-dark)}
.area-badge{color:var(--brand-red-dark);background:var(--brand-red-soft);border:1px solid #f1bed7}
.calibration-points span{background:var(--brand-red-soft);color:#775267}
.calibration-result{background:var(--brand-orange-soft);color:#76512e;border-left:3px solid var(--brand-orange)}
.calibration-panel #saveMeasurement{background:var(--brand-red-soft);border-color:#f0adcd;color:var(--brand-red-dark)}
.segmented{border-color:#edbdd3}
.segmented button.active{background:var(--brand-red);color:#fff}
.tool-group button.active-tool{background:var(--brand-red);border-color:var(--brand-red);color:#fff}
.surface-status span{background:var(--brand-orange)}
.catalog-grid button.selected{border-color:var(--brand-green);box-shadow:inset 0 0 0 1px var(--brand-green)}
.catalog-selected{background:linear-gradient(90deg,var(--brand-red-soft),var(--brand-green-soft))}
.surface-metrics{background:var(--brand-orange-soft);border-left:3px solid var(--brand-orange)}
#surfaceMessage,#formMessage{color:var(--brand-red-dark)}
.zoom input,.opacity-control input,.surface-opacity input{accent-color:var(--brand-green)}
.check input{accent-color:var(--brand-red)}
.toast{background:#263638;border-left:4px solid var(--brand-red)}

/* Apresentação ao cliente */
.presentation-intro{padding:24px;background:white;border:1px solid var(--line);border-top:3px solid var(--brand-green);margin-bottom:24px}
.presentation-intro h2{font-size:26px}.presentation-intro p{font-size:14px}
.presentation-photo{background:#fff;border:1px solid var(--line);margin-bottom:24px;break-inside:avoid}
.presentation-photo-head{padding:18px;border-bottom:1px solid var(--line)}.presentation-photo-head h3{margin:0 0 8px;font-size:16px}.presentation-photo-head span{font-size:12px;color:#626d70;overflow-wrap:anywhere}
.comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:18px}.comparison figure{margin:0;min-width:0}.comparison figcaption{font-size:14px;font-weight:600;margin-bottom:10px}.comparison svg{display:block;width:100%;height:auto;background:#fafafa}
.presentation-empty{padding:24px;background:#fff;border:1px dashed var(--line);line-height:1.6;margin-bottom:20px}
.presentation-specs{margin:28px 0}.table-scroll{overflow-x:auto}.presentation-specs table{width:100%;border-collapse:collapse;background:#fff;font-size:14px}.presentation-specs th,.presentation-specs td{padding:13px;text-align:left;border-bottom:1px solid var(--line)}.presentation-specs th{background:#eefaf9}.material-dot{display:inline-block;width:13px;height:13px;border:1px solid #aaa;border-radius:50%;vertical-align:middle;margin-right:7px}
@media(max-width:700px){.comparison{grid-template-columns:1fr}.presentation-intro{padding:18px}}
@media print{.project-progress{display:none!important}.workspace{background:#fff!important;max-width:none!important}.comparison{grid-template-columns:1fr 1fr}.presentation-specs table{font-size:10pt}.presentation-specs th,.presentation-specs td{padding:7px}.table-scroll{overflow:visible}.presentation-intro,.presentation-photo,.presentation-specs{break-inside:avoid}#presentationDrawing svg{height:260px}.visual-body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}

:host{display:block;line-height:normal;color-scheme:light;font-weight:400;text-align:left}.visual-body{min-height:100vh}#serverTools{border:0;padding:0;background:none;font-weight:400}#loadStatus:not(:empty){padding:12px 28px;background:#fff6eb;color:#76512e}#loadStatus button{margin-left:12px}`;


type VisualEvent = Event & { target: HTMLInputElement & { closest: Element['closest'] }; currentTarget: HTMLElement; clientX:number; clientY:number; key:string };
type VisualElement = { name: string; type: string; width: number; height: number; x: number; y: number; color: string; material: string; finish: string; label: string; confirmed: boolean; record?: SurveyElement; estimated?: boolean };
type VisualPoint = { x: number; y: number };
type VisualSurface = { id: string; name: string; points: VisualPoint[]; material: string; finish: string; color: string; colorName: string; opacity: number; preserveOpenings: boolean };
type VisualPhoto = { id: string; name: string; area: string; url: string; width: number; height: number; points: VisualPoint[]; referenceDistance: number; pixelsPerMeter: number | null; origin: VisualPoint | null; saved: boolean; surfaces: VisualSurface[]; records?: SurveyElement[] };
type PhotoAction = 'mascaras' | 'proposta' | 'versoes';
type Janela = 'catalogo' | 'pdf' | 'orcamento';
type VisualBridge = { onJanela: (nome: Janela) => void; project: Project | null; onTab: (tab: string) => void; onTools: (tool?: string) => void; onPhotoAction: (id: string, action: PhotoAction) => void; onProject: (project: Project) => void; onProjects: () => void };
type VisualController = { setTab: (tab: string) => void; reload: () => Promise<void>; destroy: () => void };

/** Sem `projectId`, abre a mesa como o protótipo, com o exemplo e sem salvar nada. */
export default function Levantamento({ projectId }: { projectId?: string }) {
  const { tema, alternar } = useTema();
  const themeAction = useRef(alternar);
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<VisualController | null>(null);
  const { projeto, definir } = useProjetoAtual();
  const location = useLocation();
  const navigate = useNavigate();
  const [tools, setTools] = useState(false);
  const [projetos, setProjetos] = useState(false);
  const [janela, setJanela] = useState<Janela | null>(null);
  const { state: auth, signOut } = useAuth();
  const ehOwner = auth.kind === 'authenticated' && auth.session.user.role === 'owner';
  const sair = useRef(signOut);
  const [tool, setTool] = useState('levantamento');
  const [photoAction, setPhotoAction] = useState<{photo: Photo; action: PhotoAction} | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toolsDialog = useRef<HTMLDialogElement>(null);
  const tab = location.pathname.endsWith('/entrega') ? 'presentation' : /\/(especificacao|proposta)$/.test(location.pathname) ? 'design' : 'survey';
  const nav = useRef(navigate);

  const tabRef = useRef(tab);

  const projectRef = useRef(projeto);

  const definirRef = useRef(definir);

  useEffect(() => {
    themeAction.current = alternar; nav.current = navigate; tabRef.current = tab; sair.current = signOut;
    projectRef.current = projeto; definirRef.current = definir;
  }, [alternar, navigate, tab, projeto, definir, signOut]);
  useEffect(() => {
    if (!host.current) return;
    if (projectId && (!projectRef.current || projectRef.current.id !== projectId)) return;
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    const style = window.document.createElement('style');
    style.textContent = VISUAL_CSS;
    const body = window.document.createElement('div');
    body.className = 'visual-body';
    // Static, reviewed markup copied from the ZIP; user data is escaped by the renderer.
    body.innerHTML = VISUAL_HTML;
    const themeButton = window.document.createElement('button');
    themeButton.id = 'themeToggle';
    themeButton.style.cssText = 'align-self:center;margin-left:14px;font-size:12px;padding:6px 10px';
    themeButton.onclick = () => themeAction.current();
    body.querySelector('.stages')!.append(themeButton);
    const signOutButton = window.document.createElement('button');
    signOutButton.id = 'signOut';
    signOutButton.textContent = 'Sair';
    signOutButton.title = 'Sair da conta';
    signOutButton.style.cssText = 'align-self:center;margin-left:8px;font-size:12px;padding:6px 10px';
    signOutButton.onclick = () => { void sair.current(); };
    body.querySelector('.stages')!.append(signOutButton);
    const refreshTheme = () => {
      const dark = window.document.documentElement.dataset.theme === 'dark';
      body.classList.toggle('dark-ui', dark);
      themeButton.textContent = dark ? '☀ Modo claro' : '☾ Modo escuro';
      themeButton.setAttribute('aria-label', dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro');
    };
    refreshTheme();
    const observer = new MutationObserver(refreshTheme);
    observer.observe(window.document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    style.textContent += DARK_VISUAL_CSS;
    shadow.replaceChildren(style, body);
    const instance = mountVisual(body, tabRef.current, {
      project: projectId ? projectRef.current : null,
      onTab: (next) => {
        if (next === tabRef.current) return;
        const route = { survey: 'levantamento', design: 'especificacao', presentation: 'entrega' }[next];
        if (route) nav.current((projectId ? '/projeto/' + projectId : '/estudio') + '/' + route);
      },
      onTools: (nextTool = 'levantamento') => { setTool(nextTool); setTools(true); },
      onPhotoAction: (id, action) => {
        setActionError(null);
        void visualApi.api.get<Photo>('/photos/' + id)
          .then(({data})=>setPhotoAction({photo:data, action}))
          .catch(error=>setActionError(visualApi.errorMessage(error,'Não foi possível abrir a fotografia.')));
      },
      onProject: (p) => { definirRef.current(p); if (p.id !== projectId) nav.current('/projeto/' + p.id + '/levantamento'); },
      onProjects: () => setProjetos(true),
      onJanela: (nome) => setJanela(nome),
    });
    controller.current = instance;
    return () => { observer.disconnect(); instance.destroy(); controller.current = null; shadow.replaceChildren(); };
  }, [projectId, projeto?.id]);
  useEffect(() => { controller.current?.setTab(tab); }, [tab]);
  useEffect(() => { if (tools) toolsDialog.current?.showModal(); }, [tools]);
  async function closeTools() {
    toolsDialog.current?.close();
    setTools(false);
    await controller.current?.reload();
  }
  return <>
    {actionError && <div role="alert" className="p-3 text-bad">{actionError}</div>}
    {janela === 'catalogo' && <JanelaPainel rotulo="Material e acabamento" titulo="Catálogo de materiais" onClose={() => { setJanela(null); void controller.current?.reload(); }}><CatalogPage canManage={ehOwner} /></JanelaPainel>}
    {janela === 'pdf' && projectId && <JanelaPainel rotulo="Apresentação" titulo="Apresentação aprovada e PDF" onClose={() => setJanela(null)}><PresentationPanel projectId={projectId} emJanela /></JanelaPainel>}
    {janela === 'orcamento' && projectId && <JanelaPainel rotulo="Apresentação" titulo="Quantitativo e orçamento" onClose={() => setJanela(null)}><TakeoffPanel projectId={projectId} emJanela /></JanelaPainel>}
    {projetos && <ProjetosDialog atual={projectId ?? ''} onClose={() => setProjetos(false)} onAbrir={(id) => { setProjetos(false); navigate('/projeto/' + id + '/levantamento'); }} />}
    {photoAction?.action === 'mascaras' && <MasksDialog photo={photoAction.photo} onClose={()=>setPhotoAction(null)} onSaved={()=>{ void controller.current?.reload(); }} />}
    {photoAction?.action === 'proposta' && <ProposalDialog photo={photoAction.photo} onClose={()=>setPhotoAction(null)} onGenerated={()=>{ void controller.current?.reload(); }} />}
    {photoAction?.action === 'versoes' && <VersionsDialog photo={photoAction.photo} onClose={()=>setPhotoAction(null)} onChanged={()=>{ void controller.current?.reload(); }} />}
    <div ref={host} data-theme={tema} data-artelux-visual="true" style={{ flex: 1, minWidth: 0 }} />
    {tools && projectId && <dialog ref={toolsDialog} onCancel={() => { void closeTools(); }} className="fixed inset-0 m-auto h-[92vh] w-[96vw] max-w-none overflow-auto rounded-lg border border-line bg-app p-0 text-ink backdrop:bg-black/40">
      <div className="flex items-center justify-between border-b border-line p-4"><h2 className="font-semibold">Ferramentas do projeto · dados salvos</h2><button type="button" onClick={() => void closeTools()} className="rounded border border-line-accent px-4 py-2">Voltar ao estudo visual</button></div>
      <Cabecalho />
      <div className="p-4"><label>Ferramentas <select aria-label="Ferramentas" value={tool} onChange={e=>setTool(e.target.value)} className="rounded border border-line bg-surface p-2"><option value="levantamento">Fotos, elementos, catálogo, máscaras, geração e versões</option><option value="entrega">Apresentação, PDF e orçamento</option></select></label></div>
      <div className="flex min-h-[65vh] flex-col">{tool === 'levantamento' ? <LevantamentoPersistido projectId={projectId} /> : <div className="p-5"><PresentationPanel projectId={projectId} /><TakeoffPanel projectId={projectId} /></div>}</div>
    </dialog>}
  </>;
}

function mountVisual(body: HTMLDivElement, initialTab: string, bridge: VisualBridge): VisualController {
const $ = (selector: string): any => body.querySelector(selector);
const document = { querySelectorAll: (selector: string): any[] => Array.from(body.querySelectorAll(selector)), body, createElement: window.document.createElement.bind(window.document) };
const abort = new AbortController();
const urls = new Set<string>();
let disposed = false;
let dirty = false;
let currentTab = initialTab;
const listen = (name: string, handler: any) => window.addEventListener(name, handler, { signal: abort.signal });
const later = (callback: () => void) => window.requestAnimationFrame(() => { if (!disposed) callback(); });

let objects: VisualElement[] = [
  { name: 'Testeira principal', type: 'Revestimento', width: 12.4, height: 1.2, x: 0, y: 4.1, color: '#737b80', material: 'ACM', finish: 'Fosco', label: 'HORIZONTE', confirmed: false },
  { name: 'Pilar esquerdo', type: 'Revestimento de pilar', width: .55, height: 4.1, x: .7, y: 0, color: '#d7d9d9', material: 'ACM', finish: 'Fosco', label: '', confirmed: false },
  { name: 'Pilar direito', type: 'Revestimento de pilar', width: .55, height: 4.1, x: 11.15, y: 0, color: '#d7d9d9', material: 'ACM', finish: 'Fosco', label: '', confirmed: false },
  { name: 'Totem de identificação', type: 'Sinalização', width: 1.35, height: 4.3, x: 13.6, y: 0, color: '#424b53', material: 'ACM', finish: 'Fosco', label: 'HORIZONTE', confirmed: false }
];

const colors = [
  ['Branco', '#eceeec'],
  ['Prata', '#d7d9d9'],
  ['Cinza', '#737b80'],
  ['Grafite', '#424b53'],
  ['Preto', '#282b2f']
];

const catalogColors = [
  ['Branco', '#eef0ee'],
  ['Prata', '#c8cccd'],
  ['Grafite', '#41464a'],
  ['China Red', '#b82027'],
  ['Yellow', '#f2c51f'],
  ['Orange', '#e76b22'],
  ['Dark Green', '#17533c'],
  ['Blue GM', '#174d82'],
  ['Green Apple', '#66a93f']
];

let selected = 0;
let showDimensions = true;
let zoom = 100;
let projectData = {
  name: 'Estudo de identidade · Posto Horizonte',
  client: 'Posto Horizonte',
  location: ''
};
let areaNames = ['Fachada principal', 'Lateral', 'Totem e acesso'];
let photos: VisualPhoto[] = [];
let activePhotoId: string | null = null;
let overlayOpacity = 82;
let activeView = 'elevation';
let dragState: {index:number;startX:number;startY:number;objectX:number;objectY:number;imageScale:number} | null = null;
let surfaceDrawing = false;
let surfacePoints: VisualPoint[] = [];
let selectedSurfaceId: string | null = null;
let selectedSurfaceColor = catalogColors[0][1];
let selectedSurfaceName = catalogColors[0][0];
let surfaceOpacity = 74;
let lightMode = 'day';

const activePhoto = () => photos.find((photo) => photo.id === activePhotoId) || null;
const activeSurface = () => {
  const photo = activePhoto();
  return photo ? (photo.surfaces || []).find((surface) => surface.id === selectedSurfaceId) || null : null;
};

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char] ?? char));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string) {
  if (disposed) return;
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3000);
}

function syncProjectUI() {
  $('#projectName').value = projectData.name;
  $('#projectMeta').textContent = projectData.client + (projectData.location ? ' · ' + projectData.location : ' · local não informado');
  $('#surveyProjectTitle').textContent = projectData.client;
  $('#surveyProjectMeta').textContent = projectData.location || 'Endereço ou unidade ainda não informado.';
}

function openProjectDialog(blank = false) {
  $('#projectDialog').dataset.mode = blank ? 'new' : 'edit';
  $('#dialogProjectName').value = blank ? '' : projectData.name;
  $('#clientName').value = blank ? '' : projectData.client;
  $('#siteLocation').value = blank ? '' : projectData.location;
  $('#projectDialog').showModal();
  later(() => $('#dialogProjectName').focus());
}

function renderPhotoLibrary() {
  const selectedArea = $('#uploadArea').value;
  const availableAreas = nomesDeAreasDisponiveis(areaNames);
  $('#uploadArea').innerHTML = availableAreas.map((area) => '<option>' + escapeHtml(area) + '</option>').join('');
  if (availableAreas.includes(selectedArea)) $('#uploadArea').value = selectedArea;
  $('#uploadBox').hidden = photos.length > 0;
  $('#photoAreas').innerHTML = areaNames.map((area) => {
    const areaPhotos = photos.filter((photo) => photo.area === area);
    return '<section class="area-group"><div class="area-group-head"><div><b>' + escapeHtml(area) + '</b><small>' + areaPhotos.length + (areaPhotos.length === 1 ? ' foto' : ' fotos') + '</small></div><button type="button" data-add-to-area="' + escapeHtml(area) + '">＋ Foto</button></div><div class="photo-strip">' + (areaPhotos.length ? areaPhotos.map((photo) => '<button type="button" class="photo-card ' + (photo.id === activePhotoId ? 'active' : '') + '" data-photo-id="' + photo.id + '"><img src="' + photo.url + '" alt=""><span><b>' + escapeHtml(photo.name) + '</b><small class="' + (photo.saved ? 'saved' : '') + '">' + (photo.saved ? 'Medida salva' : photo.pixelsPerMeter ? 'Escala calculada' : 'Sem escala') + '</small></span></button>').join('') : '<div class="area-empty">Nenhuma imagem nesta área</div>') + '</div></section>';
  }).join('');
  updateProgress('survey');
}

let loadActivePhoto = function(photoId: string) {
  const photo = photos.find((item) => item.id === photoId);
  if (!photo) return;
  if (!photo.surfaces) photo.surfaces = [];
  activePhotoId = photo.id;
  selectedSurfaceId = photo.surfaces[0]?.id || null;
  surfaceDrawing = false;
  surfacePoints = [];
  $('#surveyPhoto').src = photo.url;
  $('#compositionPhoto').src = photo.url;
  $('#activePhotoName').textContent = photo.name;
  $('#activePhotoArea').textContent = photo.area;
  $('#referenceDistance').value = photo.referenceDistance || '';
  $('#calibration').hidden = false;
  $('#calibrationResult').innerHTML = photo.pixelsPerMeter ? '<b>Escala definida</b><br>' + photo.pixelsPerMeter.toFixed(1) + ' pixels por metro · referência de ' + Number(photo.referenceDistance).toFixed(2) + ' m' : 'A escala ainda não foi definida.';
  $('#saveMeasurement').disabled = !photo.pixelsPerMeter;
  $('#usePhoto').disabled = !photo.saved;
  $('#stageHint').textContent = photo.saved ? 'Medida salva para esta fotografia' : photo.points.length === 2 ? 'Informe a distância real e calibre' : 'Clique no primeiro ponto da medida conhecida';
  renderPhotoLibrary();
  later(() => {
    drawCalibration();
    drawPhotoOverlay();
    syncSurfaceUI();
  });
}

function renderCatalog() {
  $('#catalogColors').innerHTML = catalogColors.map(([name, color]) =>
    '<button type="button" data-catalog-color="' + color + '" data-catalog-name="' + escapeHtml(name) + '" class="' + (color === selectedSurfaceColor ? 'selected' : '') + '" title="' + escapeHtml(name) + '"><span style="background:' + color + '"></span><small>' + escapeHtml(name) + '</small></button>'
  ).join('');
  $('#catalogColorDot').style.background = selectedSurfaceColor;
  $('#catalogColorName').textContent = selectedSurfaceName;
}

function syncSurfaceUI() {
  const photo = activePhoto();
  const surface = activeSurface();
  const hasPhoto = Boolean(photo && photo.saved);
  $('#markSurface').disabled = !hasPhoto;
  $('#finishSurface').disabled = !surfaceDrawing || surfacePoints.length < 3;
  $('#undoSurface').disabled = !surfaceDrawing || surfacePoints.length === 0;
  $('#clearSurface').disabled = !surfaceDrawing && !surface;
  $('#applySurface').disabled = !surface;
  $('#newSurface').disabled = !hasPhoto;
  $('#markSurface').classList.toggle('active-tool', surfaceDrawing);
  if (!photo) {
    $('#surfaceStatus').textContent = 'Adicione uma fotografia no levantamento';
    $('#surfaceArea').textContent = 'Aguardando fotografia';
  } else if (!photo.saved) {
    $('#surfaceStatus').textContent = 'Calibre e salve a medida da fotografia';
    $('#surfaceArea').textContent = 'Escala ainda não salva';
  } else if (surfaceDrawing) {
    $('#surfaceStatus').textContent = surfacePoints.length < 3 ? 'Marque pelo menos 3 cantos da superfície' : surfacePoints.length + ' pontos marcados · conclua o contorno';
    $('#surfaceArea').textContent = surfacePoints.length + ' pontos no contorno';
  } else if (surface) {
    $('#surfaceStatus').textContent = 'Área selecionada · escolha o acabamento';
    $('#surfaceArea').textContent = surface.points.length + ' pontos · escala da foto preservada';
    $('#surfaceTitle').textContent = surface.name;
    selectedSurfaceColor = surface.color;
    selectedSurfaceName = surface.colorName;
    surfaceOpacity = surface.opacity;
    $('#surfaceOpacity').value = surfaceOpacity;
    $('#surfaceOpacityValue').value = surfaceOpacity + '%';
    $('#surfaceMaterial').value = surface.material;
    $('#surfaceFinish').value = surface.finish;
    $('#preserveOpenings').checked = surface.preserveOpenings;
  } else {
    $('#surfaceStatus').textContent = 'Clique em “Marcar área” e contorne a superfície';
    $('#surfaceArea').textContent = 'Aguardando contorno';
    $('#surfaceTitle').textContent = 'Nova área de ACM';
  }
  renderCatalog();
}

function beginSurfaceDrawing() {
  const photo = activePhoto();
  if (!photo || !photo.saved) {
    notify('Primeiro calibre e salve a medida da fotografia.');
    return;
  }
  surfaceDrawing = true;
  surfacePoints = [];
  selectedSurfaceId = null;
  syncSurfaceUI();
  drawPhotoOverlay();
}

function finishSurfaceDrawing() {
  dirty = true;
  const photo = activePhoto();
  if (!photo || surfacePoints.length < 3) return;
  const surface = {
    id: String(Date.now()) + '-surface',
    name: 'Superfície ' + (photo.surfaces.length + 1),
    points: surfacePoints.map((point) => ({ ...point })),
    material: $('#surfaceMaterial').value,
    finish: $('#surfaceFinish').value,
    color: selectedSurfaceColor,
    colorName: selectedSurfaceName,
    opacity: surfaceOpacity,
    preserveOpenings: $('#preserveOpenings').checked
  };
  photo.surfaces.push(surface);
  selectedSurfaceId = surface.id;
  surfaceDrawing = false;
  surfacePoints = [];
  syncSurfaceUI();
  drawPhotoOverlay();
  notify('Contorno concluído. Escolha o material e a cor.');
}

function updateProgress(activeTab?: string) {
  const saved = photos.filter((photo) => photo.saved).length;
  const areasUsed = new Set(photos.map((photo) => photo.area)).size;
  $('#photoStatus').textContent = photos.length ? photos.length + ' fotos · ' + areasUsed + ' áreas' : 'Adicionar fotografias';
  $('#scaleStatus').textContent = photos.length ? saved + ' de ' + photos.length + ' medidas salvas' : 'Aguardando fotos';
  const confirmed = objects.filter((object) => object.confirmed).length;
  $('#elementStatus').textContent = objects.length + ' elementos · ' + confirmed + ' conferidos';
  $('#presentationStatus').textContent = saved && objects.length ? 'Disponível para revisar' : 'Pendente';
  const progressButtons = [...document.querySelectorAll('#projectProgress button')];
  progressButtons[0].classList.toggle('complete', photos.length > 0);
  progressButtons[1].classList.toggle('complete', photos.length > 0 && saved === photos.length);
  progressButtons[2].classList.toggle('complete', objects.length > 0 && confirmed === objects.length);
  progressButtons[3].classList.toggle('complete', Boolean(saved && objects.length));
  if (activeTab) {
    progressButtons.forEach((button) => button.classList.remove('active'));
    const activeIndex = activeTab === 'survey' ? (photos.length ? 1 : 0) : activeTab === 'design' ? 2 : 3;
    progressButtons[activeIndex].classList.add('active');
  }
}

let updateForm = function() {
  if (!objects[selected]) return;
  const object = objects[selected];
  $('#objectTitle').textContent = object.name;
  $('#objectType').textContent = object.type;
  (['width', 'height', 'x', 'y', 'material', 'finish', 'label', 'color'] as const).forEach((key) => {
    $('#' + key).value = object[key];
  });
  $('#confirmed').checked = object.confirmed;
  $('#selectionSummary').textContent = object.name;
  $('#measureSummary').textContent = object.width.toFixed(2) + ' × ' + object.height.toFixed(2) + ' m · ' + object.material;
  updateColor();
  $('#formMessage').textContent = '';
}

function updateColor() {
  const color = $('#color').value;
  $('#colorName').textContent = (colors.find((item) => item[1] === color) || ['Personalizada'])[0];
  document.querySelectorAll('[data-color]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.color === color);
  });
}

function projectBounds() {
  return {
    maxX: Math.max(1, ...objects.map((object) => object.x + object.width)),
    maxY: Math.max(1, ...objects.map((object) => object.y + object.height))
  };
}

function drawingMarkup(maxY: number) {
  let markup = '<line x1="-.6" y1="' + maxY + '" x2="' + (projectBounds().maxX + .6) + '" y2="' + maxY + '" stroke="#bec5c9" stroke-width=".025"/>';
  objects.forEach((object, index) => {
    const y = maxY - object.y - object.height;
    const selectedStroke = selected === index ? '#526c7d' : '#4e565c';
    markup += '<g data-object="' + index + '" tabindex="0" role="button" aria-label="' + escapeHtml(object.name) + '">';
    markup += '<rect x="' + object.x + '" y="' + y + '" width="' + object.width + '" height="' + object.height + '" fill="' + object.color + '" stroke="' + selectedStroke + '" stroke-width="' + (selected === index ? '.04' : '.015') + '"/>';
    if (object.label) {
      const labelColor = ['#eceeec', '#d7d9d9'].includes(object.color) ? '#303438' : 'white';
      const labelSize = Math.min(.45, object.width / Math.max(object.label.length, 1) * 1.3);
      markup += '<text x="' + (object.x + object.width / 2) + '" y="' + (y + Math.min(object.height * .6, .75)) + '" text-anchor="middle" fill="' + labelColor + '" font-family="Arial,sans-serif" font-size="' + labelSize + '" letter-spacing=".025">' + escapeHtml(object.label) + '</text>';
    }
    markup += '</g>';
    if (showDimensions && selected === index) {
      const dimensionY = y - .45;
      markup += '<g stroke="#71818c" stroke-width=".018" fill="none"><path d="M ' + object.x + ' ' + (y - .12) + ' V ' + (dimensionY - .15) + ' M ' + (object.x + object.width) + ' ' + (y - .12) + ' V ' + (dimensionY - .15) + ' M ' + object.x + ' ' + dimensionY + ' H ' + (object.x + object.width) + '"/><path d="M ' + (object.x - .12) + ' ' + y + ' H ' + (object.x - .5) + ' M ' + (object.x - .12) + ' ' + (y + object.height) + ' H ' + (object.x - .5) + ' M ' + (object.x - .38) + ' ' + y + ' V ' + (y + object.height) + '"/></g>';
      markup += '<g font-family="Arial" font-size=".2" fill="#617786"><text x="' + (object.x + object.width / 2) + '" y="' + (dimensionY - .12) + '" text-anchor="middle">' + object.width.toFixed(2) + ' m</text><text x="' + (object.x - .55) + '" y="' + (y + object.height / 2) + '" text-anchor="middle" transform="rotate(-90 ' + (object.x - .55) + ' ' + (y + object.height / 2) + ')">' + object.height.toFixed(2) + ' m</text></g>';
    }
  });
  return markup;
}

function draw() {
  if (!objects.length) return;
  const { maxX, maxY } = projectBounds();
  const padding = 2.1;
  const viewBox = [-padding, -padding, maxX + padding * 2, maxY + padding * 2];
  const centerX = viewBox[0] + viewBox[2] / 2;
  const centerY = viewBox[1] + viewBox[3] / 2;
  viewBox[2] *= 100 / zoom;
  viewBox[3] *= 100 / zoom;
  viewBox[0] = centerX - viewBox[2] / 2;
  viewBox[1] = centerY - viewBox[3] / 2;
  $('#drawing').setAttribute('viewBox', viewBox.join(' '));
  $('#drawing').innerHTML = drawingMarkup(maxY);
  $('#extent').textContent = 'Conjunto · ' + maxX.toFixed(2) + ' × ' + maxY.toFixed(2) + ' m';
  $('#stateNote').textContent = (objects.some(o=>o.estimated) ? 'Estimativas rotuladas · ' : '') + objects.filter((object) => object.confirmed).length + ' de ' + objects.length + ' elementos com medidas conferidas';
  $('#elements').innerHTML = objects.map((object, index) =>
    '<button class="element ' + (index === selected ? 'active' : '') + '" data-select="' + index + '"><span class="square"></span>' + escapeHtml(object.name) + '<span>' + String(index + 1).padStart(2, '0') + '</span></button>'
  ).join('');
  $('#presentationDrawing').innerHTML = '<svg viewBox="-2.1 -2.1 ' + (maxX + 4.2) + ' ' + (maxY + 4.2) + '" role="img" aria-label="Elevação do projeto">' + drawingMarkup(maxY) + '</svg>';
  drawPhotoOverlay();
  updateProgress();
}

function selectObject(index: number) {
  selected = index;
  updateForm();
  draw();
}

function createElement(copyFrom?: VisualElement) {
  dirty = true;
  const source = copyFrom || objects[selected];
  const number = objects.length + 1;
  const object = {
    name: copyFrom ? source.name + ' · cópia' : 'Novo painel ' + number,
    type: copyFrom ? source.type : 'Revestimento',
    width: copyFrom ? source.width : 2.4,
    height: copyFrom ? source.height : .8,
    x: Math.max(0, source.x + .45),
    y: Math.max(0, source.y + .35),
    color: copyFrom ? source.color : '#737b80',
    material: copyFrom ? source.material : 'ACM',
    finish: copyFrom ? source.finish : 'Fosco',
    label: copyFrom ? source.label : '',
    confirmed: false
  };
  objects.push(object);
  selectObject(objects.length - 1);
  notify(copyFrom ? 'Elemento duplicado.' : 'Novo elemento adicionado ao projeto.');
}

function deleteSelectedElement() {
  dirty = true;
  if (objects.length === 1) {
    notify('O projeto precisa manter pelo menos um elemento.');
    return;
  }
  const removed = objects[selected].name;
  objects.splice(selected, 1);
  selected = Math.min(selected, objects.length - 1);
  updateForm();
  draw();
  notify(removed + ' removido do estudo local. Registros salvos não foram excluídos.');
}

function stageSize(stage: HTMLElement) {
  return { width: Math.max(stage.clientWidth, 1), height: Math.max(stage.clientHeight, 1) };
}

function drawCalibration() {
  const photo = activePhoto();
  if (!photo) return;
  const stage = $('#calibrationStage');
  const overlay = $('#calibrationOverlay');
  const size = photo ? { width: photo.width || 1, height: photo.height || 1 } : stageSize(stage);
  overlay.setAttribute('viewBox', '0 0 ' + size.width + ' ' + size.height);
  let markup = '';
  if (photo.points[0]) {
    markup += '<circle class="calibration-mark" cx="' + photo.points[0].x + '" cy="' + photo.points[0].y + '" r="7" fill="#fff" stroke="#293238" stroke-width="3"/>';
  }
  if (photo.points[1]) {
    markup += '<line class="calibration-mark" x1="' + photo.points[0].x + '" y1="' + photo.points[0].y + '" x2="' + photo.points[1].x + '" y2="' + photo.points[1].y + '" stroke="#fff" stroke-width="4"/>';
    markup += '<line x1="' + photo.points[0].x + '" y1="' + photo.points[0].y + '" x2="' + photo.points[1].x + '" y2="' + photo.points[1].y + '" stroke="#293238" stroke-width="1.5"/>';
    markup += '<circle class="calibration-mark" cx="' + photo.points[1].x + '" cy="' + photo.points[1].y + '" r="7" fill="#fff" stroke="#293238" stroke-width="3"/>';
  }
  overlay.innerHTML = markup;
  $('#pointA').textContent = photo.points[0] ? 'Ponto A · marcado' : 'Ponto A · aguardando';
  $('#pointB').textContent = photo.points[1] ? 'Ponto B · marcado' : 'Ponto B · aguardando';
  $('#calibrate').disabled = photo.points.length < 2;
  if (!photo.saved) $('#stageHint').textContent = photo.points.length === 0 ? 'Clique no primeiro ponto da medida conhecida' : photo.points.length === 1 ? 'Clique no segundo ponto' : 'Informe a distância real e calibre';
}

function clearCalibration() {
  const photo = activePhoto();
  if (!photo) return;
  photo.points = [];
  photo.pixelsPerMeter = null;
  photo.origin = null;
  photo.saved = false;
  $('#calibrationResult').textContent = 'A escala ainda não foi definida.';
  $('#saveMeasurement').disabled = true;
  $('#usePhoto').disabled = true;
  drawCalibration();
  drawPhotoOverlay();
  renderPhotoLibrary();
}

function drawPhotoOverlay() {
  const photo = activePhoto();
  const stage = $('#compositionStage');
  const overlay = $('#compositionOverlay');
  const size = photo ? { width: photo.width || 1, height: photo.height || 1 } : stageSize(stage);
  overlay.setAttribute('viewBox', '0 0 ' + size.width + ' ' + size.height);
  $('#emptyPhoto').hidden = Boolean(photo);
  $('#compositionPhoto').hidden = !photo;
  if (!photo || !photo.pixelsPerMeter || !photo.origin) {
    overlay.innerHTML = '';
    return;
  }
  const opacity = overlayOpacity / 100;
  let markup = '';
  (photo.surfaces || []).forEach((surface) => {
    const points = surface.points.map((point) => point.x + ',' + point.y).join(' ');
    const selectedStroke = surface.id === selectedSurfaceId ? '#ffffff' : 'rgba(255,255,255,.75)';
    markup += '<polygon data-surface-id="' + surface.id + '" points="' + points + '" fill="' + surface.color + '" fill-opacity="' + (surface.opacity / 100) + '" stroke="' + selectedStroke + '" stroke-width="' + (surface.id === selectedSurfaceId ? 3 : 1.5) + '"/>';
    if (surface.id === selectedSurfaceId) {
      surface.points.forEach((point) => {
        markup += '<circle cx="' + point.x + '" cy="' + point.y + '" r="5" fill="#fff" stroke="#30373c" stroke-width="2"/>';
      });
    }
  });
  if (surfaceDrawing && surfacePoints.length) {
    const draftPoints = surfacePoints.map((point) => point.x + ',' + point.y).join(' ');
    markup += '<polyline points="' + draftPoints + '" fill="' + (surfacePoints.length > 2 ? selectedSurfaceColor : 'none') + '" fill-opacity=".32" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 5"/>';
    surfacePoints.forEach((point, index) => {
      markup += '<circle cx="' + point.x + '" cy="' + point.y + '" r="7" fill="#fff" stroke="#30373c" stroke-width="2"/><text x="' + point.x + '" y="' + (point.y - 12) + '" text-anchor="middle" fill="#fff" font-family="Arial" font-size="11">' + (index + 1) + '</text>';
    });
  }
  objects.forEach((object, index) => {
    const x = photo.origin!.x + object.x * photo.pixelsPerMeter!;
    const y = photo.origin!.y - (object.y + object.height) * photo.pixelsPerMeter!;
    const width = object.width * photo.pixelsPerMeter!;
    const height = object.height * photo.pixelsPerMeter!;
    const stroke = selected === index ? '#fff' : 'rgba(255,255,255,.7)';
    markup += '<g data-photo-object="' + index + '" opacity="' + opacity + '"><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="1" fill="' + object.color + '" stroke="' + stroke + '" stroke-width="' + (selected === index ? 3 : 1.2) + '"/>';
    if (object.label) {
      const labelColor = ['#eceeec', '#d7d9d9'].includes(object.color) ? '#303438' : '#fff';
      const labelSize = Math.max(9, Math.min(28, height * .42));
      markup += '<text x="' + (x + width / 2) + '" y="' + (y + Math.min(height * .62, 38)) + '" text-anchor="middle" fill="' + labelColor + '" font-family="Arial,sans-serif" font-size="' + labelSize + '">' + escapeHtml(object.label) + '</text>';
    }
    if (selected === index) {
      markup += '<circle cx="' + (x + width) + '" cy="' + (y + height) + '" r="5" fill="#fff" stroke="#354149" stroke-width="2"/>';
    }
    markup += '</g>';
  });
  overlay.innerHTML = markup;
}

function setView(view: string) {
  activeView = view;
  $('#elevationView').hidden = view !== 'elevation';
  $('#photoView').hidden = view !== 'photo';
  $('#opacityControl').hidden = view !== 'photo';
  $('.zoom').hidden = view !== 'elevation';
  $('#elementProperties').hidden = view === 'photo';
  $('#surfaceProperties').hidden = view !== 'photo';
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'photo') later(() => {
    syncSurfaceUI();
    drawPhotoOverlay();
  });
}

function setTab(tabName: string) {
  currentTab = tabName;
  bridge.onTab(tabName);
  ['design', 'survey', 'presentation'].forEach((id) => $('#' + id).hidden = id !== tabName);
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabName));
  $('#workEyebrow').textContent = ({ design: 'PROJETO VISUAL', survey: 'LEVANTAMENTO', presentation: 'APRESENTAÇÃO' } as Record<string,string>)[tabName];
  $('#workTitle').textContent = ({ design: 'Identidade em escala.', survey: 'A base do projeto.', presentation: 'Pronto para visualizar.' } as Record<string,string>)[tabName];
  $('.view-tools').hidden = tabName !== 'design';
  if (tabName !== 'design') {
    $('#elementProperties').hidden = false;
    $('#surfaceProperties').hidden = true;
  } else {
    $('#elementProperties').hidden = activeView === 'photo';
    $('#surfaceProperties').hidden = activeView !== 'photo';
  }
  updateProgress(tabName);
  if (tabName === 'presentation') { draw(); renderPresentation(); }
  if (tabName === 'survey' && activePhoto()) later(drawCalibration);
}

$('#elements').onclick = (event: VisualEvent) => {
  const button = event.target.closest<HTMLElement>('[data-select]');
  if (button) selectObject(Number(button.dataset.select));
};

$('#drawing').onclick = (event: VisualEvent) => {
  const object = event.target.closest<HTMLElement>('[data-object]');
  if (object) selectObject(Number(object.dataset.object));
};

$('#drawing').onkeydown = (event: VisualEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    const object = event.target.closest<HTMLElement>('[data-object]');
    if (object) {
      event.preventDefault();
      selectObject(Number(object.dataset.object));
    }
  }
};

$('#compositionOverlay').onpointerdown = (event: VisualEvent) => {
  const photo = activePhoto();
  if (surfaceDrawing && photo) {
    const point = imagePoint(event, event.currentTarget, photo);
    if (!point) return;
    surfacePoints.push(point);
    syncSurfaceUI();
    drawPhotoOverlay();
    event.preventDefault();
    return;
  }
  const surface = event.target.closest<HTMLElement>('[data-surface-id]');
  if (surface) {
    selectedSurfaceId = surface.dataset.surfaceId ?? null;
    syncSurfaceUI();
    drawPhotoOverlay();
    event.preventDefault();
    return;
  }
  const group = event.target.closest<HTMLElement>('[data-photo-object]');
  if (!group || !photo || !photo.pixelsPerMeter) return;
  const index = Number(group.dataset.photoObject);
  selectObject(index);
  dragState = {
    index,
    startX: event.clientX,
    startY: event.clientY,
    objectX: objects[index].x,
    objectY: objects[index].y,
    imageScale: Math.min($('#compositionStage').clientWidth / photo.width, $('#compositionStage').clientHeight / photo.height)
  };
  $('#compositionOverlay').classList.add('dragging');
  event.preventDefault();
};

listen('pointermove', (event: PointerEvent) => {
  const photo = activePhoto();
  if (!dragState || !photo || !photo.pixelsPerMeter) return;
  const object = objects[dragState.index];
  object.x = Math.max(0, dragState.objectX + (event.clientX - dragState.startX) / (photo.pixelsPerMeter * dragState.imageScale));
  object.y = Math.max(0, dragState.objectY - (event.clientY - dragState.startY) / (photo.pixelsPerMeter * dragState.imageScale));
  $('#x').value = object.x.toFixed(2);
  $('#y').value = object.y.toFixed(2);
  $('#measureSummary').textContent = object.width.toFixed(2) + ' × ' + object.height.toFixed(2) + ' m · posição ' + object.x.toFixed(2) + ', ' + object.y.toFixed(2) + ' m';
  drawPhotoOverlay();
});

listen('pointerup', () => {
  if (!dragState) return;
  dragState = null;
  $('#compositionOverlay').classList.remove('dragging');
  draw();
  $('#formMessage').textContent = 'Posição atualizada diretamente sobre a fotografia.';
});

$('#properties').onsubmit = (event: VisualEvent) => {
  event.preventDefault();
  dirty = true;
  const object = objects[selected];
  (['width', 'height', 'x', 'y'] as const).forEach((key) => object[key] = Number($('#' + key).value));
  (['material', 'finish', 'label', 'color'] as const).forEach((key) => object[key] = $('#' + key).value);
  object.confirmed = $('#confirmed').checked;
  draw();
  updateForm();
  $('#formMessage').textContent = 'Dimensões e propriedades aplicadas ao estudo.';
};

$('#addElement').onclick = () => createElement();
$('#duplicateElement').onclick = () => createElement(objects[selected]);
$('#deleteElement').onclick = deleteSelectedElement;

$('#swatches').innerHTML = colors.map(([name, color]) =>
  '<button type="button" data-color="' + color + '" style="background:' + color + '" aria-label="' + name + '" title="' + name + '"></button>'
).join('');
$('#swatches').onclick = (event: VisualEvent) => {
  if (event.target.dataset.color) {
    $('#color').value = event.target.dataset.color;
    updateColor();
  }
};
$('#color').oninput = updateColor;

document.querySelectorAll('[data-tab]').forEach((button) => button.onclick = () => setTab(button.dataset.tab));
document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => setView(button.dataset.view));
document.querySelectorAll('[data-go]').forEach((button) => button.onclick = () => {
  setTab(button.dataset.go);
  if (button.querySelector('#photoStatus')) {
    const library = $('.photo-library h2');
    library.tabIndex = -1;
    library.scrollIntoView({ block: 'start' });
    library.focus({ preventScroll: true });
  }
});

$('#dimensions').onclick = () => {
  showDimensions = !showDimensions;
  $('#dimensions').textContent = showDimensions ? 'Cotas visíveis' : 'Mostrar cotas';
  $('#dimensions').setAttribute('aria-pressed', showDimensions);
  draw();
};

$('#zoom').oninput = (event: VisualEvent) => {
  zoom = Number(event.target.value);
  $('#zoomValue').value = zoom + '%';
  draw();
};

$('#overlayOpacity').oninput = (event: VisualEvent) => {
  overlayOpacity = Number(event.target.value);
  $('#opacityValue').value = overlayOpacity + '%';
  drawPhotoOverlay();
};

$('#markSurface').onclick = beginSurfaceDrawing;
$('#newSurface').onclick = beginSurfaceDrawing;
$('#finishSurface').onclick = finishSurfaceDrawing;
$('#undoSurface').onclick = () => {
  if (!surfaceDrawing || !surfacePoints.length) return;
  surfacePoints.pop();
  syncSurfaceUI();
  drawPhotoOverlay();
};
$('#clearSurface').onclick = () => {
  const photo = activePhoto();
  if (surfaceDrawing) {
    surfacePoints = [];
    surfaceDrawing = false;
  } else if (photo && selectedSurfaceId) {
    photo.surfaces = photo.surfaces.filter((surface) => surface.id !== selectedSurfaceId);
    selectedSurfaceId = photo.surfaces[0]?.id || null;
  }
  syncSurfaceUI();
  drawPhotoOverlay();
};

$('#catalogColors').onclick = (event: VisualEvent) => {
  const button = event.target.closest<HTMLElement>('[data-catalog-color]');
  if (!button) return;
  selectedSurfaceColor = button.dataset.catalogColor ?? selectedSurfaceColor;
  selectedSurfaceName = button.dataset.catalogName ?? selectedSurfaceName;
  const surface = activeSurface();
  if (surface) {
    surface.color = selectedSurfaceColor;
    surface.colorName = selectedSurfaceName;
  }
  renderCatalog();
  drawPhotoOverlay();
};

$('#surfaceOpacity').oninput = (event: VisualEvent) => {
  surfaceOpacity = Number(event.target.value);
  $('#surfaceOpacityValue').value = surfaceOpacity + '%';
  const surface = activeSurface();
  if (surface) surface.opacity = surfaceOpacity;
  drawPhotoOverlay();
};

document.querySelectorAll('[data-light]').forEach((button) => button.onclick = () => {
  lightMode = button.dataset.light;
  document.querySelectorAll('[data-light]').forEach((item) => item.classList.toggle('active', item === button));
  $('#compositionStage').classList.toggle('night-mode', lightMode === 'night');
});

$('#applySurface').onclick = () => {
  const surface = activeSurface();
  if (!surface) return;
  surface.material = $('#surfaceMaterial').value;
  surface.finish = $('#surfaceFinish').value;
  surface.color = selectedSurfaceColor;
  surface.colorName = selectedSurfaceName;
  surface.opacity = surfaceOpacity;
  surface.preserveOpenings = $('#preserveOpenings').checked;
  $('#surfaceMessage').textContent = 'Acabamento aplicado na simulação visual.';
  dirty = true;
  drawPhotoOverlay();
  notify('Acabamento aplicado à área marcada.');
};

$('#resetView').onclick = () => {
  zoom = 100;
  $('#zoom').value = 100;
  $('#zoomValue').value = '100%';
  draw();
};

$('#present').onclick = () => {
  document.body.classList.toggle('presenting');
  $('#present').textContent = document.body.classList.contains('presenting') ? 'Voltar ao projeto' : 'Apresentar projeto ↗';
  setTab(document.body.classList.contains('presenting') ? 'presentation' : 'design');
};

['uploadMain', 'uploadEmpty', 'uploadSide'].forEach((id) => $('#' + id).onclick = () => $('#photoInput').click());
$('#addPhotoFromDesign').onclick = () => setTab('survey');

$('#calibrationStage').onclick = (event: VisualEvent) => {
  const photo = activePhoto();
  if (!photo || photo.points.length >= 2) return;
  const point = imagePoint(event, event.currentTarget, photo);
  if (!point) return;
  photo.points.push(point);
  photo.saved = false;
  drawCalibration();
};

$('#clearCalibration').onclick = clearCalibration;

$('#calibrate').onclick = () => {
  const photo = activePhoto();
  const distance = Number($('#referenceDistance').value);
  if (!photo || !distance || distance <= 0 || photo.points.length < 2) {
    notify('Informe uma distância real válida.');
    return;
  }
  const dx = photo.points[1].x - photo.points[0].x;
  const dy = photo.points[1].y - photo.points[0].y;
  const pixelDistance = Math.hypot(dx, dy);
  if (pixelDistance < 2 || !Number.isFinite(distance)) { notify('Marque dois pontos diferentes e informe uma distância válida.'); return; }
  photo.referenceDistance = distance;
  photo.pixelsPerMeter = pixelDistance / distance;
  photo.origin = {
    x: Math.min(photo.points[0].x, photo.points[1].x),
    y: Math.max(photo.points[0].y, photo.points[1].y)
  };
  photo.saved = false;
  $('#calibrationResult').innerHTML = '<b>Escala calculada</b><br>' + photo.pixelsPerMeter.toFixed(1) + ' pixels por metro · referência de ' + distance.toFixed(2) + ' m';
  $('#saveMeasurement').disabled = false;
  $('#usePhoto').disabled = true;
  $('#stageHint').textContent = 'Confira e salve a medida desta foto';
  drawPhotoOverlay();
  updateProgress('survey');
  renderPhotoLibrary();
};

$('#usePhoto').onclick = () => {
  setTab('design');
  setView('photo');
  notify('Projeto proporcional aplicado sobre a fotografia.');
};

$('#photoAreas').onclick = (event: VisualEvent) => {
  const photoButton = event.target.closest<HTMLElement>('[data-photo-id]');
  if (photoButton) {
    if (photoButton.dataset.photoId) loadActivePhoto(photoButton.dataset.photoId);
    return;
  }
  const areaButton = event.target.closest<HTMLElement>('[data-add-to-area]');
  if (areaButton) {
    if (pedirProjeto('As fotos ficam guardadas no projeto.')) return;
    $('#uploadArea').value = areaButton.dataset.addToArea;
    $('#photoInput').click();
  }
};

$('#newProject').onclick = () => openProjectDialog(true);
$('#editProject').onclick = () => openProjectDialog(false);
$('#closeProject').onclick = () => $('#projectDialog').close();
$('#cancelProject').onclick = () => $('#projectDialog').close();
function download(data: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#download').onclick = () => download(JSON.stringify({
  project: projectData,
  units: 'm',
  kind: 'estudo-visual',
  revision: studyRevision,
  photos: photos.map(({ name, area, referenceDistance, pixelsPerMeter, saved, surfaces = [] }) => ({
    name,
    area,
    referenceDistance,
    pixelsPerMeter,
    saved,
    surfaces: surfaces.map(({ name: surfaceName, material, finish, colorName, opacity, preserveOpenings, points }) => ({
      name: surfaceName,
      material,
      finish,
      colorName,
      opacity,
      preserveOpenings,
      points
    }))
  })),
  objects
}, null, 2), 'application/json', 'artelux-estudo.json');

$('#exportSvg').onclick = () => download(
  $('#drawing').outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
  'image/svg+xml',
  'artelux-elevacao.svg'
);

$('#print').onclick = () => { renderPresentation(); window.print(); };
listen('resize', () => {
  if (activePhoto()) {
    drawCalibration();
    drawPhotoOverlay();
  }
});

function imagePoint(event: {clientX:number;clientY:number}, stage: Element, photo: VisualPhoto) {
  if (!photo.width || !photo.height) return null;
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(rect.width / photo.width, rect.height / photo.height);
  const x = (event.clientX - rect.left - (rect.width - photo.width * scale) / 2) / scale;
  const y = (event.clientY - rect.top - (rect.height - photo.height * scale) / 2) / scale;
  return x >= 0 && y >= 0 && x <= photo.width && y <= photo.height ? {x, y} : null;
}

function presentationPhoto(photo: VisualPhoto, proposed: boolean) {
  const w = photo.width, h = photo.height;
  let markup = '<image href="' + escapeHtml(photo.url) + '" width="' + w + '" height="' + h + '"' + (proposed && lightMode === 'night' ? ' style="filter:brightness(.36) saturate(.76)"' : '') + '/>';
  if (proposed && photo.saved) {
    markup += (photo.surfaces || []).map(surface => '<polygon points="' + surface.points.map(p => p.x + ',' + p.y).join(' ') + '" fill="' + surface.color + '" fill-opacity="' + surface.opacity / 100 + '"/>').join('');
    (photo.id === objectPhotoId ? objects : localElements.get(photo.id) ?? []).forEach(object => {
      const x = photo.origin!.x + object.x * photo.pixelsPerMeter!;
      const y = photo.origin!.y - (object.y + object.height) * photo.pixelsPerMeter!;
      const width = object.width * photo.pixelsPerMeter!, height = object.height * photo.pixelsPerMeter!;
      markup += '<g opacity="' + overlayOpacity / 100 + '"><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" fill="' + object.color + '"/>';
      if (object.label) markup += '<text x="' + (x + width / 2) + '" y="' + (y + height * .6) + '" text-anchor="middle" fill="white" font-family="Arial" font-size="' + Math.min(height * .42, width / Math.max(object.label.length, 1) * 1.3) + '">' + escapeHtml(object.label) + '</text>';
      markup += '</g>';
    });
  }
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + (proposed ? 'Simulação visual' : 'Foto original') + '">' + markup + '</svg>';
}

function renderPresentation() {
  $('#presentationName').textContent = projectData.name;
  $('#presentationClient').textContent = projectData.client + (projectData.location ? ' · ' + projectData.location : ' · Local não informado');
  $('#presentationPhotos').innerHTML = photos.length ? photos.map(photo => '<article class="presentation-photo"><div class="presentation-photo-head"><h3>' + escapeHtml(photo.area) + '</h3><span>' + escapeHtml(photo.name) + ' · ' + (photo.saved ? 'Referência: ' + photo.referenceDistance.toFixed(2) + ' m' : 'Escala pendente') + '</span></div><div class="comparison"><figure><figcaption>Foto original</figcaption>' + presentationPhoto(photo, false) + '</figure><figure><figcaption>Simulação · ' + (lightMode === 'night' ? 'Noite' : 'Dia') + '</figcaption>' + (photo.saved ? presentationPhoto(photo, true) : '<p class="presentation-empty">Calibre e salve a medida desta foto para visualizar a proposta.</p>') + '</figure></div></article>').join('') : '<div class="presentation-empty">Adicione uma fotografia no levantamento para comparar o antes e depois. A elevação abaixo mostra os elementos do estudo.</div>';
  $('#presentationMaterials').innerHTML = objects.map(o => '<tr><td>' + escapeHtml(o.name) + '</td><td>' + escapeHtml(o.material + ' · ' + o.finish) + '</td><td><span class="material-dot" style="background:' + o.color + '"></span>' + escapeHtml((colors.find(c => c[1] === o.color) || [o.color])[0]) + '</td><td>' + o.width.toFixed(2) + ' × ' + o.height.toFixed(2) + ' m</td><td>' + (o.estimated ? 'Estimativa' : o.confirmed ? 'Conferida' : 'A conferir') + '</td></tr>').join('') + photos.flatMap(photo => (photo.surfaces || []).map(surface => '<tr><td>' + escapeHtml(photo.area + ' · ' + surface.name) + '</td><td>' + escapeHtml(surface.material + ' · ' + surface.finish) + '</td><td><span class="material-dot" style="background:' + surface.color + '"></span>' + escapeHtml(surface.colorName) + '</td><td>Contorno na fotografia</td><td>Estudo visual</td></tr>')).join('');
}

updateForm();
syncProjectUI();
renderPhotoLibrary();
renderCatalog();
syncSurfaceUI();
draw();
updateProgress('survey');

// Integration boundary: all server operations go through the existing API client.
// Illustrative palette, surface polygons, duplicate objects and elevation edits stay local.
let areas: Area[] = [];
let limits: visualApi.MediaLimits | null = null;
let catalog: visualApi.Material[] = [];
let finishes: visualApi.Finish[] = [];
let applying = false;
let loading = false;
let uploading = false;
let projectSaving = false;
let studyRevision = 0;
let studyLoaded = false;
let studySaving = false;
let savedStudyJson = '';
const saveStudyButton = window.document.createElement('button');
saveStudyButton.id = 'saveStudy';
saveStudyButton.textContent = 'Salvar estudo';
saveStudyButton.className = 'primary';
saveStudyButton.disabled = true;
$('#download').before(saveStudyButton);
const saveStatus = window.document.createElement('span');
saveStatus.setAttribute('role','status');
saveStatus.style.cssText = 'font-size:12px;align-self:center';
saveStudyButton.after(saveStatus);
// Sem projeto, a mesa abre como o protótipo: o exemplo do Posto Horizonte só
// na tela. Explorar é livre; o que precisa ser guardado pede o projeto antes.
const projectId: string | null = bridge.project?.id ?? null;
if (bridge.project) projectData = { name: bridge.project.name, client: bridge.project.client?.name ?? '', location: bridge.project.location?.name ?? '' };
function pedirProjeto(motivo: string): boolean {
  if (projectId) return false;
  notify(motivo + ' Crie o projeto para salvar.');
  openProjectDialog(true);
  return true;
}
if (!projectId) {
  ['uploadMain', 'uploadEmpty', 'uploadSide'].forEach((id) => $('#' + id).onclick = () => { pedirProjeto('As fotos ficam guardadas no projeto.'); });
  saveStudyButton.disabled = false;
  saveStatus.textContent = 'Exemplo · nada é salvo';
}
const localElements = new Map<string, VisualElement[]>();
localElements.set('examples', objects);
let objectPhotoId = 'examples';
function studyElement(object: VisualElement): visualApi.StudyElement {
  const { record, ...draft } = object;
  return { ...draft, estimated: object.estimated ?? true, record_id: record?.id ?? null };
}
function studySnapshot(): visualApi.VisualStudy {
  localElements.set(objectPhotoId, objects);
  return {
    revision: studyRevision,
    objects: (localElements.get('examples') ?? []).map(studyElement),
    photos: photos.map(photo => ({ photo_id:photo.id,
      objects:(localElements.get(photo.id) ?? []).map(studyElement), surfaces:photo.surfaces })),
    light_mode: lightMode === 'night' ? 'night' : 'day',
    overlay_opacity:overlayOpacity, active_photo_id:activePhotoId,
  };
}
function studyContent(study: visualApi.VisualStudy) {
  const { revision: _revision, updated_at: _updated, ...content } = study;
  return JSON.stringify(content);
}
async function persistStudy() {
  if (pedirProjeto('O exemplo não é salvo.')) return;
  if (!studyLoaded || studySaving || loading || disposed) return;
  studySaving = true; saveStudyButton.disabled = true;
  saveStatus.textContent = 'Salvando…';
  const snapshot = studySnapshot();
  try {
    const saved = await visualApi.saveVisualStudy(projectId!, snapshot);
    if (disposed) return;
    studyRevision = saved.revision;
    savedStudyJson = studyContent(snapshot);
    dirty = studyContent(studySnapshot()) !== savedStudyJson;
    saveStatus.textContent = dirty ? 'Há alterações posteriores para salvar' : 'Estudo salvo';
  } catch(error) {
    if (!disposed) saveStatus.textContent = visualApi.errorMessage(error,'Não foi possível salvar o estudo.');
  } finally {
    studySaving = false;
    if (!disposed) saveStudyButton.disabled = false;
  }
}
saveStudyButton.onclick = () => { void persistStudy(); };
function restoreStudy(study: visualApi.VisualStudy) {
  studyRevision = study.revision;
  if (study.revision > 0) {
    localElements.clear();
    const restore = (draft: visualApi.StudyElement, photo?: VisualPhoto): VisualElement => {
      const {record_id, ...object} = draft;
      return {...object, record: photo?.records?.find(record=>record.id===record_id)};
    };
    localElements.set('examples', study.objects.map(draft=>restore(draft)));
    for (const saved of study.photos) {
      const photo = photos.find(p=>p.id===saved.photo_id);
      if (!photo) continue;
      photo.surfaces = saved.surfaces;
      if (saved.objects.length) localElements.set(photo.id,saved.objects.map(draft=>restore(draft,photo)));
    }
    objects = localElements.get('examples') ?? [];
    objectPhotoId = 'examples';
    activePhotoId = study.active_photo_id;
    lightMode = study.light_mode; overlayOpacity = study.overlay_opacity;
    $('#overlayOpacity').value = overlayOpacity;
    $('#opacityValue').value = overlayOpacity + '%';
    $('#compositionStage').classList.toggle('night-mode', lightMode==='night');
  }
}
const selectPhotoOriginal = loadActivePhoto;
loadActivePhoto = (id: string) => {
  localElements.set(objectPhotoId, objects);
  objectPhotoId = id;
  const photo = photos.find(p=>p.id === id)!;
  const imported = photo.pixelsPerMeter && photo.origin ? (photo.records ?? []).map(record=>elementFromRecord(record,photo)) : [];
  objects = localElements.get(id) ?? (imported.length ? imported : localElements.get('examples')!.map(o => ({ ...o, confirmed: false })));
  if (!imported.length) $('#formMessage').textContent = 'Elementos ilustrativos do estudo. Cadastre as medidas conferidas nas Ferramentas do projeto.';
  localElements.set(id, objects);
  selected = Math.min(selected, objects.length - 1);
  selectPhotoOriginal(id);
  updateForm(); draw();
};

// Convert the server's top-left pixel coordinates to the prototype's bottom-left
// metre coordinates. This is a display transform; estimates keep their provenance.
function elementFromRecord(record: SurveyElement, photo: VisualPhoto): VisualElement {
  const ppm = photo.pixelsPerMeter!;
  const factor = record.measurements.unit === 'cm' ? 0.01 : 1;
  const width = record.measurements.width ? record.measurements.width.value * factor : record.box.width / ppm;
  const height = record.measurements.height ? record.measurements.height.value * factor : record.box.height / ppm;
  return { name:record.name, type:record.kind_label, width, height,
    x:(record.box.x - photo.origin!.x) / ppm,
    y:(photo.origin!.y - record.box.y - record.box.height) / ppm,
    material:record.spec.material?.name ?? '',finish:record.spec.finish?.name ?? '',
    color:record.spec.finish?.color_hex ?? '#737b80',label:record.notes ?? '',
    confirmed:record.conference.status === 'conferido',record,
    estimated: !record.measurements.width || !record.measurements.height || record.measurements.has_estimate };
}
const initialMaterialOptions = $('#material').innerHTML;
const initialFinishOptions = $('#finish').innerHTML;
const originalUpdateForm = updateForm;
function finishOptions(materialId: string) {
  $('#finish').innerHTML = '<option value="">Selecione…</option>' + finishes.filter(f=>f.material_id===materialId).map(f=>'<option value="'+escapeHtml(f.id)+'">'+escapeHtml(f.name+' · '+f.color_name)+'</option>').join('');
  $('#swatches').innerHTML = finishes.filter(f=>f.material_id===materialId).map(f=>'<button type="button" data-finish-id="'+escapeHtml(f.id)+'" style="background:'+escapeHtml(f.color_hex)+'" aria-label="'+escapeHtml(f.name+' · '+f.color_name)+'" title="'+escapeHtml(f.name+' · '+f.color_name)+'"></button>').join('');
}
updateForm = () => {
  originalUpdateForm();
  const object = objects[selected]; if (!object) return;
  // Converted pixel positions need not fall on the prototype's 5 cm grid.
  for (const id of ['width','height','x','y']) {
    $('#'+id).step = object.record ? 'any' : '0.05';
  }
  $('.board-bottom span:last-child').textContent = object.record ? 'Medidas cadastradas · estimativas identificadas' : 'Dimensões do exemplo, editáveis';
  if (object.record) {
    $('#material').innerHTML = '<option value="">Selecione…</option>'+catalog.map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.name)+'</option>').join('');
    $('#material').value = object.record.spec.material?.id ?? '';
    finishOptions($('#material').value);
    $('#finish').value = object.record.spec.finish?.id ?? '';
    $('#properties .hint').textContent = 'Catálogo cadastrado. Cores personalizadas ficam no estudo visual, sem alterar o catálogo.';
    $('#formMessage').textContent = object.estimated ? 'Há dimensões estimadas; elas não equivalem a medidas conferidas em campo.' : '';
    $('#width').readOnly = false; $('#height').readOnly = false;
    $('#colorName').textContent = object.record.spec.finish?.color_name ?? 'Sem acabamento';
  } else {
    $('#material').innerHTML = initialMaterialOptions; $('#material').value=object.material;
    $('#finish').innerHTML = initialFinishOptions; $('#finish').value=object.finish;
    $('#swatches').innerHTML = colors.map(([name,color])=>'<button type="button" data-color="'+color+'" style="background:'+color+'" aria-label="'+name+'" title="'+name+'"></button>').join('');
    $('#properties .hint').textContent = 'Paleta ilustrativa. Use Salvar estudo para guardar esta composição. Confira cores no catálogo físico.';
    updateColor();
  }
};
$('#material').onchange = () => { if(objects[selected]?.record) finishOptions($('#material').value); };
$('#finish').onchange = () => {
  if (!objects[selected]?.record) return;
  const finish=finishes.find(f=>f.id===$('#finish').value);
  if(finish) { $('#color').value=finish.color_hex; $('#colorName').textContent=finish.color_name; }
};
const originalSwatches = $('#swatches').onclick;
$('#swatches').onclick = (event: VisualEvent) => {
  const button = event.target.closest<HTMLElement>('[data-finish-id]');
  if (!button) { originalSwatches(event); return; }
  $('#finish').value=button.dataset.finishId;
  $('#finish').onchange();
};
const applyLocal = $('#properties').onsubmit;
$('#properties').onsubmit = async (event: Event) => {
  const object = objects[selected], photo = activePhoto();
  if (!object.record || !photo?.pixelsPerMeter || !photo.origin) { applyLocal(event); return; }
  event.preventDefault();
  if(applying) return;
  applying=true;
  $('#properties button[type=submit]').disabled=true;
  let record=object.record;
  const width=Number($('#width').value),height=Number($('#height').value),x=Number($('#x').value),y=Number($('#y').value);
  const text=$('#label').value.trim(), color=$('#color').value;
  const finish=finishes.find(f=>f.id===$('#finish').value && f.material_id===$('#material').value);
  try {
    // Only values explicitly edited by the user are persisted as measured.
    if(width!==object.width || height!==object.height) {
      const measurements: visualApi.MeasurementsInput={unit:'m'};
      const factor = record.measurements.unit === 'cm' ? 0.01 : 1;
      // PUT replaces the whole measurement set: preserve untouched dimensions
      // and their provenance, including depth, before applying edited values.
      for (const dimension of ['width','height','depth'] as const) {
        const previous = record.measurements[dimension];
        if (previous) measurements[dimension] = { value: previous.value * factor, source: previous.source };
      }
      if(width!==object.width) measurements.width={value:width,source:'user_measured'};
      if(height!==object.height) measurements.height={value:height,source:'user_measured'};
      record=await visualApi.saveMeasurements(record.id,measurements);
    }
    if(x!==object.x || y!==object.y || text!==object.label) {
      record=await visualApi.updateElement(record.id,{box:{...record.box,
        x:photo.origin.x + x*photo.pixelsPerMeter,
        y:photo.origin.y - y*photo.pixelsPerMeter - record.box.height},notes:text});
    }
    if(finish && finish.id!==record.spec.finish?.id) record=await visualApi.applySpec(record.id,{material_id:finish.material_id,finish_id:finish.id});
    const conference=$('#confirmed').checked ? 'conferido' : 'pendente';
    // Changing dimensions invalidates conference on the server. Never restore
    // the old check automatically; only honor an explicit checkbox change.
    if(conference!==object.record.conference.status) record=await visualApi.setConference(record.id,conference);
    if(disposed) return;
    Object.assign(object,elementFromRecord(record,photo));
    if(color !== finish?.color_hex) object.color=color;
    updateForm(); draw();
    $('#formMessage').textContent='Dados do elemento salvos. Use Salvar estudo para guardar também a composição visual.';
  } catch(error) {
    object.record=record;
    $('#formMessage').textContent=visualApi.errorMessage(error,'Não foi possível aplicar todas as alterações. Confira os dados salvos nas Ferramentas do projeto.');
  } finally { applying=false; if(!disposed) $('#properties button[type=submit]').disabled=false; }
};

function setLoadError(error: unknown) {
  if (disposed) return;
  const target = $('#loadStatus');
  target.textContent = visualApi.errorMessage(error, 'Não foi possível carregar os dados do projeto.');
  const retry = window.document.createElement('button');
  retry.textContent = 'Tentar novamente';
  retry.onclick = () => { void reload(); };
  target.append(retry);
}

async function toPhoto(record: Photo, area: string): Promise<VisualPhoto> {
  const [blob, scale, records] = await Promise.all([visualApi.fetchPhotoBlob(record.id), visualApi.getCalibration(record.id), visualApi.listElements(record.id)]);
  if (disposed) throw new Error('Visualização encerrada.');
  const url = URL.createObjectURL(blob);
  urls.add(url);
  const size = await new Promise<{ width: number; height: number }>((resolve,reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => { URL.revokeObjectURL(url); urls.delete(url); reject(new Error('Não foi possível abrir a fotografia.')); };
    image.src = url;
  });
  const old = photos.find(p => p.id === record.id);
  const points = scale.point_a && scale.point_b ? [scale.point_a,scale.point_b] : [];
  return { id: record.id, name: record.original_filename, area, url, ...size, points,
    referenceDistance: scale.real_length == null ? 0 : scale.real_length / (scale.unit === 'cm' ? 100 : 1),
    pixelsPerMeter: scale.pixels_per_meter, origin: points.length === 2 ? { x: Math.min(points[0].x,points[1].x), y: Math.max(points[0].y,points[1].y) } : null,
    saved: scale.calibrated, surfaces: old?.surfaces ?? [], records };
}

async function reload() {
  if (loading || disposed || !projectId) return;
  loading = true;
  $('#loadStatus').textContent = 'Carregando fotos e medidas salvas…';
  ['uploadMain','uploadEmpty','uploadSide','addArea'].forEach(id => $( '#' + id).disabled = true);
  try {
    const [nextAreas,nextLimits,nextCatalog,study] = await Promise.all([visualApi.listAreas(projectId!),visualApi.getMediaLimits(),visualApi.listMaterials(),studyLoaded ? Promise.resolve(null) : visualApi.getVisualStudy(projectId!)]);
    const nextFinishes = (await Promise.all(nextCatalog.map(m=>visualApi.listFinishes(m.id)))).flat();
    const nextPhotos = await Promise.all(nextAreas.map(async area => {
      const records = await visualApi.listAreaPhotos(area.id);
      return Promise.all(records.map(p => toPhoto(p,area.name)));
    }));
    if (disposed) return;
    const oldUrls = photos.map(p=>p.url);
    areas = nextAreas; limits = nextLimits; catalog = nextCatalog; finishes = nextFinishes;
    areaNames = areas.map(a=>a.name); photos = nextPhotos.flat();
    if (study) restoreStudy(study);
    oldUrls.forEach(url=>{ URL.revokeObjectURL(url); urls.delete(url); });
    $('#photoInput').accept = limits.accepted_content_types.join(',');
    $('.area-select-row small').textContent = limits.accepted_labels.join(', ') + ' · até ' + limits.max_upload_mb + ' MB por imagem';
    renderPhotoLibrary();
    if (activePhotoId && photos.some(p=>p.id === activePhotoId)) loadActivePhoto(activePhotoId);
    else { activePhotoId = null; $('#calibration').hidden = true; $('#compositionPhoto').removeAttribute('src'); }
    $('#loadStatus').textContent = '';
    setTab(currentTab); drawPhotoOverlay();
    if (!studyLoaded) {
      studyLoaded = true; savedStudyJson = studyContent(studySnapshot());
      saveStatus.textContent = studyRevision ? 'Estudo salvo carregado' : 'Estudo ainda não salvo';
      saveStudyButton.disabled = false;
    }
  } catch (error) { setLoadError(error); }
  finally {
    loading = false;
    if (!disposed) ['uploadMain','uploadEmpty','uploadSide','addArea'].forEach(id=>$('#'+id).disabled = false);
  }
}

$('#serverTools').onclick = () => { if (!pedirProjeto('As ferramentas usam os dados salvos do projeto.')) bridge.onTools(); };
const proposalActions = window.document.createElement('div');
proposalActions.className = 'surface-toolbar';
proposalActions.setAttribute('aria-label','Proposta e aprovação');
for (const [label,action] of [['Máscaras e proteção','mascaras'],['Gerar proposta com IA','proposta'],['Versões e aprovação','versoes']] as const) {
  const button = window.document.createElement('button');
  button.textContent = label;
  if (action==='proposta') button.className='primary';
  button.onclick = () => {
    if (!activePhotoId) { notify('Selecione uma fotografia no levantamento para continuar.'); setTab('survey'); return; }
    bridge.onPhotoAction(activePhotoId,action);
  };
  proposalActions.append(button);
}
$('#design').prepend(proposalActions);
const deliveryButton = window.document.createElement('button');
deliveryButton.textContent = 'Apresentação aprovada e PDF';
deliveryButton.className = 'primary';
deliveryButton.onclick = () => { if (!pedirProjeto('A apresentação aprovada usa os dados salvos do projeto.')) bridge.onJanela('pdf'); };
const budgetButton = window.document.createElement('button');
budgetButton.textContent = 'Quantitativo e orçamento';
budgetButton.onclick = () => { if (!pedirProjeto('O orçamento usa os dados salvos do projeto.')) bridge.onJanela('orcamento'); };
const catalogButton = window.document.createElement('button');
catalogButton.type = 'button';
catalogButton.className = 'wide';
catalogButton.textContent = 'Catálogo de materiais';
catalogButton.style.marginTop = '10px';
catalogButton.onclick = () => bridge.onJanela('catalogo');
$('#colorName').closest('fieldset').append(catalogButton);
$('.presentation-actions').prepend(deliveryButton);
deliveryButton.after(budgetButton);
$('.brand').href = '/';
$('.brand').onclick = (event: Event) => { event.preventDefault(); bridge.onProjects(); };
$('#openProjects').onclick = () => bridge.onProjects();
$('#addArea').onclick = async () => {
  if (pedirProjeto('As áreas ficam guardadas no projeto.')) return;
  const name = window.prompt('Nome da nova área do levantamento:')?.trim();
  if (!name || loading) return;
  $('#addArea').disabled = true;
  try {
    const area = await visualApi.createArea(projectId!, { name });
    if (disposed) return;
    areas.push(area); areaNames = areas.map(a=>a.name);
    renderPhotoLibrary(); $('#uploadArea').value = area.name;
    notify('Área salva no projeto.');
  } catch(error) { notify(visualApi.errorMessage(error,'Não foi possível criar a área.')); }
  finally { if (!disposed) $('#addArea').disabled = false; }
};
$('#photoInput').onchange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length || uploading || loading) return;
  const areaName = $('#uploadArea').value;
  let area = areas.find(a=>a.name === areaName);
  if (!area && !AREAS_DO_PROTOTIPO.includes(areaName)) { notify('Selecione uma área antes de adicionar fotos.'); input.value=''; return; }
  uploading = true;
  let firstId: string | null = null;
  try {
    if (!area) {
      area = await visualApi.createArea(projectId!, { name: areaName });
      if (disposed) return;
      areas.push(area); areaNames = areas.map(a=>a.name);
      renderPhotoLibrary(); $('#uploadArea').value = area.name;
    }
    for (const file of files) {
      const record = await visualApi.uploadPhoto(area.id,file,p=>{ if (!disposed) $('#loadStatus').textContent = 'Enviando fotografia… ' + p + '%'; });
      const photo = await toPhoto(record,area.name);
      if (disposed) return;
      photos.push(photo); firstId ??= photo.id;
      renderPhotoLibrary();
    }
    if (firstId) loadActivePhoto(firstId);
    setTab('survey'); notify('Fotografias salvas no projeto. Informe uma medida real para calibrar.');
  } catch(error) { notify(visualApi.errorMessage(error,'Não foi possível enviar a fotografia.')); }
  finally { uploading = false; if (!disposed) { input.value=''; $('#loadStatus').textContent=''; } }
};
$('#saveMeasurement').onclick = async () => {
  const photo = activePhoto();
  if (!photo || !photo.pixelsPerMeter || photo.points.length !== 2) return;
  $('#saveMeasurement').disabled = true;
  try {
    const result = await visualApi.saveCalibration(photo.id,{ point_a:photo.points[0], point_b:photo.points[1], real_length:photo.referenceDistance, unit:'m' });
    if (disposed) return;
    photo.saved = result.calibrated;
    photo.pixelsPerMeter = result.pixels_per_meter;
    $('#calibrationResult').textContent = 'Medida salva · ' + photo.referenceDistance.toFixed(2) + ' m · ' + photo.pixelsPerMeter?.toFixed(1) + ' pixels por metro';
    $('#usePhoto').disabled = !photo.saved;
    $('#stageHint').textContent = 'Medida salva para esta fotografia';
    renderPhotoLibrary(); notify('Escala salva no projeto.');
  } catch(error) { $('#saveMeasurement').disabled = false; notify(visualApi.errorMessage(error,'Não foi possível salvar a escala.')); }
};
// Editing a distance invalidates the local calculation until the user recalibrates.
$('#referenceDistance').oninput = () => {
  const photo = activePhoto(); if (!photo) return;
  photo.saved = false; photo.pixelsPerMeter = null;
  $('#saveMeasurement').disabled = true; $('#usePhoto').disabled = true;
  $('#calibrationResult').textContent = 'Recalcule a escala com a nova medida.';
};
$('#projectName').onchange = async () => {
  const name = $('#projectName').value.trim();
  if (!name) { syncProjectUI(); return; }
  if (!projectId) { projectData.name = name; syncProjectUI(); return; }
  $('#projectName').disabled = true;
  try {
    const updated = await visualApi.updateProject(projectId!,{ name });
    if (disposed) return;
    projectData.name = updated.name; bridge.onProject(updated); syncProjectUI();
  } catch(error) { syncProjectUI(); notify(visualApi.errorMessage(error,'Não foi possível salvar o nome.')); }
  finally { if (!disposed) $('#projectName').disabled = false; }
};
$('#projectForm').onsubmit = async (event: Event) => {
  event.preventDefault();
  if (projectSaving) return;
  const isNew = $('#projectDialog').dataset.mode === 'new';
  const name = $('#dialogProjectName').value.trim(), clientName = $('#clientName').value.trim(), site = $('#siteLocation').value.trim();
  projectSaving = true;
  const submit = $('#projectForm button[type=submit]'); submit.disabled = true;
  let errorNotice = $('#projectForm [role=status]');
  if (!errorNotice) {
    errorNotice = window.document.createElement('p');
    errorNotice.setAttribute('role','status');
    $('#projectForm').append(errorNotice);
  }
  errorNotice.textContent = '';
  try {
    const result = await visualApi.salvarProjetoPorNomes({ name,clientName,locationName:site }, isNew || !projectId ? undefined : projectId);
    if (disposed) return;
    projectData = { name:result.name,client:result.client?.name ?? clientName,location:result.location?.name ?? site };
    syncProjectUI(); $('#projectDialog').close(); bridge.onProject(result); notify('Projeto salvo.');
  } catch(error) { errorNotice.textContent = visualApi.errorMessage(error,'Não foi possível salvar o projeto.'); }
  finally { projectSaving=false; if (!disposed) submit.disabled=false; }
};
// Local edits are never sent as catalog, mask, measurement or approval mutations.
const trackStudy = () => {
  if (!studyLoaded || disposed || studySaving) return;
  dirty = studyContent(studySnapshot()) !== savedStudyJson;
  saveStatus.textContent = dirty ? 'Alterações não salvas' : (studyRevision ? 'Estudo salvo' : 'Estudo ainda não salvo');
};
body.addEventListener('change',trackStudy,{signal:abort.signal});
body.addEventListener('click',()=>{ later(trackStudy); },{signal:abort.signal});
body.addEventListener('pointerup',()=>{ later(trackStudy); },{signal:abort.signal});
listen('beforeunload',(event: BeforeUnloadEvent)=>{ if(dirty){ event.preventDefault(); event.returnValue=''; } });
syncProjectUI(); setTab(initialTab); void reload();
return {
  setTab,
  reload,
  destroy: () => { disposed=true; abort.abort(); clearTimeout(toastTimer); urls.forEach(url=>URL.revokeObjectURL(url)); },
};
}

// Theme affects interface chrome only: photos, material swatches and the study
// retain their colors. Day/night remains a separate composition control.
const DARK_VISUAL_CSS = `
.dark-ui {color-scheme:dark;color:#e7ecee;background:#0f1416;--line:#26322f;--muted:#a7b5b8;--brand-green-soft:#06272a;--brand-red-soft:#2a0a1b;--brand-orange-soft:#2a2011;--brand-red-dark:#ff69af;--brand-green-dark:#19d6ce}
.dark-ui header,.dark-ui .stages,.dark-ui .left,.dark-ui .right,.dark-ui .photo-library,.dark-ui .calibration-layout,.dark-ui .calibration-title,.dark-ui .calibration-panel,.dark-ui .surface-toolbar,.dark-ui .presentation-intro,.dark-ui .presentation-photo,.dark-ui .presentation-specs table,.dark-ui dialog {background:#151b1e;color:#e7ecee;border-color:#334044}
.dark-ui .workspace {background:#0f1416}
.dark-ui button {background:#1b2225;color:#e7ecee;border-color:#6b3550}
.dark-ui button:hover {background:#2a0a1b;border-color:#ed79af}
.dark-ui .primary {background:#00bdb5;color:#fff;border-color:#00bdb5}
.dark-ui .primary:hover {background:#008f89}
.dark-ui .stages button {background:none;color:#a7b5b8}
.dark-ui .stages button.active {color:#00bdb5}
.dark-ui .project-name input,.dark-ui input:not([type=checkbox]):not([type=range]):not([type=color]),.dark-ui select {color:#e7ecee;background:#1b2225;border-color:#465258}
.dark-ui .survey-project {background:linear-gradient(110deg,#2a0a1b,#151b1e 56%,#06272a);color:#e7ecee;border-color:#6b3550;border-left-color:#f20a76}
.dark-ui .survey-project p,.dark-ui .muted,.dark-ui label,.dark-ui .hint,.dark-ui .library-head p,.dark-ui .calibration-panel p,.dark-ui .project-name small,.dark-ui .side-note p,.dark-ui .side-bottom small,.dark-ui footer,.dark-ui .presentation-intro p,.dark-ui .presentation-photo-head span {color:#a7b5b8}
.dark-ui .project-progress button {background:#151b1e;border-color:#6b3550}
.dark-ui .project-progress button b,.dark-ui .photo-card b,.dark-ui .catalog-selected b {color:#e7ecee}
.dark-ui .project-progress button small,.dark-ui .area-empty,.dark-ui .catalog-grid button small {color:#a7b5b8}
.dark-ui .project-progress button.active {background:#06272a;border-color:#00bdb5}
.dark-ui .area-group,.dark-ui .photo-card,.dark-ui .presentation-empty {background:#1b2225;border-color:#334044}
.dark-ui .upload-box {background:linear-gradient(135deg,#151b1e,#2a0a1b);border-color:#99466c}
.dark-ui .calibration-points span {color:#ff9ccb}
.dark-ui .calibration-result,.dark-ui .surface-metrics {color:#efcda9}
.dark-ui .presentation-specs th {background:#06272a}
.dark-ui .catalog-selected {background:linear-gradient(90deg,#2a0a1b,#06272a)}
.dark-ui .drawing-board {color-scheme:light}
.dark-ui .toast {color:#fff}
@media(max-width:850px){.stages{height:auto;min-height:60px;flex-wrap:wrap;gap:0 18px}.stages>button{min-height:44px}#serverTools{display:block;margin-left:0}.stages #themeToggle{margin-left:auto!important}}
@media print {.dark-ui,.dark-ui .workspace,.dark-ui .presentation-intro,.dark-ui .presentation-photo,.dark-ui .presentation-specs table {background:white!important;color:#303438!important}}
`;
