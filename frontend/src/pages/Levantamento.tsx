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

export default function Levantamento({ projectId }: { projectId: string }) {
  const { projeto } = useProjetoAtual()

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

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const areas = await listAreas(projectId)
      const comFotos = await Promise.all(
        areas.map(async (area) => ({ area, fotos: await listAreaPhotos(area.id) })),
      )
      setGrupos(comFotos)
      setAreaDestino((atual) => atual || (areas[0]?.id ?? ''))
    } catch {
      setErro('Não foi possível carregar as áreas deste projeto.')
    } finally {
      setCarregando(false)
    }
  }, [projectId])

  useEffect(() => {
    void carregar()
  }, [carregar])

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
    if (!fotoAberta) {
      setElementos([])
      setElementoAberto(null)
      return
    }
    let vivo = true
    setCarregandoElementos(true)
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
    const destino = areaDestino || grupos[0]?.area.id
    if (!destino) {
      setRecado('Crie uma área antes de adicionar fotos.')
      return
    }
    setEnviando(true)
    setRecado(null)
    try {
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

      <CardsEtapa projectId={projectId} atual={estado.fotos ? 2 : 1} estado={estado} />

      {/* Projeto atual — o bloco em destaque do protótipo. */}
      <div className="mb-3.5 flex items-center justify-between gap-5 rounded border border-[#f1d2e1] border-l-4 border-l-accent bg-[linear-gradient(110deg,#fff3f8_0%,#fff_56%,#f1fbfa_100%)] px-5 py-[18px] shadow-[0_8px_24px_rgba(207,7,95,.05)] dark:bg-[linear-gradient(110deg,var(--color-accent-soft)_0%,var(--color-surface)_56%,var(--color-brand-soft)_100%)]">
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
        <a
          href={`/projeto/${projectId}/editar`}
          className="shrink-0 rounded-md border border-[#8ed7d2] bg-surface px-[15px] py-[10px] text-sm font-medium text-brand-hover transition hover:border-brand hover:bg-brand-soft"
        >
          Editar dados
        </a>
      </div>

      {/* Biblioteca de fotos por área. */}
      <Cartao>
        <div className="flex items-start justify-between gap-5">
          <div>
            <Rotulo cor="destaque">Etapa 01 · Levantamento fotográfico</Rotulo>
            <h2 className="mt-2 mb-[5px] text-xl font-semibold">Fotos organizadas por área</h2>
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
              {grupos.length === 0 && <option value="">Crie uma área primeiro</option>}
              {grupos.map(({ area }) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
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
                        onClick={() => setFotoAberta(aberta ? null : foto.id)}
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
