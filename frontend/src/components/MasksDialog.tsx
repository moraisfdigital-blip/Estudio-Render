import { useCallback, useEffect, useRef, useState } from 'react'
import {
  errorMessage,
  fetchPhotoBlob,
  getMasks,
  saveMasks,
  setArchitectureLock,
  type MaskKind,
  type MaskLayer,
  type MaskLayerInput,
  type MaskPoint,
  type MasksState,
  type Photo,
} from '../api/client'
import { useAuth } from '../auth/context'
import { Button, ErrorNotice, Loading } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { useFotoGeometria } from '../hooks/useFotoGeometria'

/**
 * Máscaras de intervenção e proteção — o Architecture Lock desenhado.
 *
 * Duas camadas com significados opostos: `intervention` marca onde a geração
 * **poderá** mexer, `protect` marca o que precisa sobreviver intacto. A Fase 9
 * só terá permissão de escrever dentro de intervenção e fora de proteção.
 *
 * Como na calibração, o overlay é um `<svg>` sobre um `<img>`; nada aqui
 * desenha sobre o arquivo. O `viewBox` é o tamanho natural da foto, então todo
 * vértice já nasce em coordenada de pixel do original — exatamente o que o
 * servidor valida contra as dimensões reais.
 *
 * **O veredito da geração não é calculado aqui.** `generation_ready` e o texto
 * de `blocked_reason` vêm do servidor, com a mesma mensagem que a API usará ao
 * recusar. A tela exibe o que recebeu; não há regra de bloqueio duplicada neste
 * arquivo.
 */

const KIND_STYLES: Record<MaskKind, { stroke: string; fill: string; chip: string; nome: string }> = {
  intervention: {
    stroke: '#38bdf8',
    fill: '#38bdf82e',
    chip: 'border-sky-900 bg-sky-950/60 text-sky-300',
    nome: 'Intervenção',
  },
  protect: {
    stroke: '#fb923c',
    fill: '#fb923c2e',
    chip: 'border-orange-900 bg-orange-950/60 text-orange-300',
    nome: 'Proteção',
  },
}

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Camada como ela vive na tela: ainda sem id do servidor enquanto não salva. */
type Rascunho = { kind: MaskKind; label: string; points: MaskPoint[] }

function paraRascunho(layer: MaskLayer): Rascunho {
  return { kind: layer.kind, label: layer.label, points: layer.points }
}

function paraEnvio(rascunho: Rascunho): MaskLayerInput {
  return {
    kind: rascunho.kind,
    label: rascunho.label.trim() || undefined,
    points: rascunho.points,
  }
}

function caminho(points: MaskPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Shoelace, só para a tela mostrar o tamanho antes de o servidor responder. */
function areaDe(points: MaskPoint[]): number {
  let total = 0
  for (let i = 0; i < points.length; i += 1) {
    const atual = points[i]
    const proximo = points[(i + 1) % points.length]
    total += atual.x * proximo.y - proximo.x * atual.y
  }
  return Math.abs(total) / 2
}

// ---------------------------------------------------------------------------

function Overlay({
  url,
  camadas,
  desenho,
  selecionada,
  onPonto,
  onSelecionar,
  disabled,
}: {
  url: string
  camadas: Rascunho[]
  desenho: Rascunho | null
  selecionada: number | null
  onPonto: (point: MaskPoint) => void
  onSelecionar: (indice: number) => void
  disabled: boolean
}) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  // Mesma conta do diálogo de calibração, no mesmo lugar: o clique só vira
  // pixel certo se descontar a tarja do encaixe da foto na caixa.
  const { natural, scale, medir, paraOriginal } = useFotoGeometria(imageRef)

  function coordenadaDo(event: React.PointerEvent<SVGSVGElement>): MaskPoint | null {
    // Clique fora da imagem não vira vértice: o servidor recusaria, e recusar
    // aqui evita o usuário desenhar algo que não pode ser salvo.
    const ponto = paraOriginal(event.clientX, event.clientY)
    return ponto && { x: Math.round(ponto.x), y: Math.round(ponto.y) }
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <img
        ref={imageRef}
        src={url}
        alt="Foto original do levantamento"
        className="block w-full select-none"
        draggable={false}
        onLoad={medir}
      />
      {natural && (
        <svg
          viewBox={`0 0 ${natural.width} ${natural.height}`}
          className={`absolute inset-0 h-full w-full ${disabled ? '' : 'cursor-crosshair'}`}
          onPointerDown={(event) => {
            if (disabled) return
            const ponto = coordenadaDo(event)
            if (ponto) onPonto(ponto)
          }}
        >
          {camadas.map((camada, indice) => {
            const estilo = KIND_STYLES[camada.kind]
            const ativa = indice === selecionada
            return (
              <polygon
                key={indice}
                points={caminho(camada.points)}
                fill={estilo.fill}
                stroke={estilo.stroke}
                strokeWidth={(ativa ? 3 : 2) * scale}
                strokeDasharray={camada.kind === 'protect' ? `${8 * scale} ${6 * scale}` : undefined}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelecionar(indice)
                }}
                className="cursor-pointer"
              />
            )
          })}

          {/* Polígono em construção: linha aberta + vértices já marcados. */}
          {desenho && desenho.points.length > 0 && (
            <>
              <polyline
                points={caminho(desenho.points)}
                fill="none"
                stroke={KIND_STYLES[desenho.kind].stroke}
                strokeWidth={2 * scale}
              />
              {desenho.points.map((ponto, indice) => (
                <circle
                  key={indice}
                  cx={ponto.x}
                  cy={ponto.y}
                  r={4 * scale}
                  fill={KIND_STYLES[desenho.kind].stroke}
                  stroke="#0a0a0a"
                  strokeWidth={1 * scale}
                />
              ))}
            </>
          )}
        </svg>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function MasksDialog({
  photo,
  onClose,
  onSaved,
}: {
  photo: Photo
  onClose: () => void
  onSaved: (estado: MasksState) => void
}) {
  const { state } = useAuth()
  // Desenhar é do editor; ligar/desligar o lock é do owner. O texto muda, mas
  // quem recusa de verdade é a API (403).
  const podeMexerNoLock = state.kind === 'authenticated' && state.session.user.role === 'owner'

  const carregar = useCallback(() => getMasks(photo.id), [photo.id])
  const { resource, reload } = useResource(
    carregar,
    'Não foi possível carregar as máscaras desta foto.',
  )

  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [camadas, setCamadas] = useState<Rascunho[]>([])
  const [desenho, setDesenho] = useState<Rascunho | null>(null)
  const [tipo, setTipo] = useState<MaskKind>('intervention')
  const [selecionada, setSelecionada] = useState<number | null>(null)
  const [sujo, setSujo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [estado, setEstado] = useState<MasksState | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)
  const [mudandoLock, setMudandoLock] = useState(false)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob = await fetchPhotoBlob(photo.id)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
      } catch (caught) {
        if (alive) setImageError(errorMessage(caught, 'Não foi possível carregar a foto original.'))
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id])

  // Máscara existente hidrata a tela: reabrir mostra o desenho de antes, para
  // conferir ou corrigir. Mesmo padrão da calibração — ajuste na renderização,
  // com a identidade da resposta guardada para não sobrescrever o que o
  // usuário mexeu depois.
  const [hidratadoDe, setHidratadoDe] = useState<MasksState | null>(null)
  if (resource.kind === 'ready' && resource.data !== hidratadoDe) {
    const atual = resource.data
    setHidratadoDe(atual)
    setEstado(atual)
    setCamadas(atual.layers.map(paraRascunho))
    setDesenho(null)
    setSujo(false)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Esc cancela o polígono em construção antes de fechar o diálogo:
        // fechar e perder o desenho no primeiro Esc seria hostil.
        if (desenho) setDesenho(null)
        else onClose()
      }
      if (event.key === 'Enter' && desenho && desenho.points.length >= 3) {
        event.preventDefault()
        // Mesma transição do botão "Fechar área", escrita aqui para o efeito
        // depender só de `desenho` — sem capturar função recriada a cada render.
        setCamadas((atuais) => [...atuais, desenho])
        setDesenho(null)
        setSujo(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, desenho])

  function adicionarPonto(ponto: MaskPoint) {
    setSaveError(null)
    setDesenho((atual) =>
      atual === null
        ? { kind: tipo, label: '', points: [ponto] }
        : { ...atual, points: [...atual.points, ponto] },
    )
  }

  function fecharPoligono() {
    if (!desenho || desenho.points.length < 3) return
    setCamadas((atuais) => [...atuais, desenho])
    setDesenho(null)
    setSujo(true)
  }

  function removerCamada(indice: number) {
    setCamadas((atuais) => atuais.filter((_, i) => i !== indice))
    setSelecionada(null)
    setSujo(true)
  }

  function renomear(indice: number, label: string) {
    setCamadas((atuais) => atuais.map((c, i) => (i === indice ? { ...c, label } : c)))
    setSujo(true)
  }

  async function salvar() {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const resultado = await saveMasks(photo.id, camadas.map(paraEnvio))
      setEstado(resultado)
      setCamadas(resultado.layers.map(paraRascunho))
      setSujo(false)
      onSaved(resultado)
    } catch (caught) {
      setSaveError(errorMessage(caught, 'Não foi possível salvar as máscaras.'))
    } finally {
      setSaving(false)
    }
  }

  async function alternarLock() {
    if (!estado || mudandoLock) return
    setMudandoLock(true)
    setLockError(null)
    try {
      const projeto = await setArchitectureLock(photo.project_id, !estado.architecture_lock)
      // Recarrega para o veredito da geração vir recalculado do servidor, em
      // vez de a tela deduzir o novo bloqueio por conta própria.
      const atualizado = await getMasks(photo.id)
      setEstado({ ...atualizado, architecture_lock: projeto.architecture_lock })
      onSaved(atualizado)
    } catch (caught) {
      setLockError(errorMessage(caught, 'Não foi possível alterar o Architecture Lock.'))
    } finally {
      setMudandoLock(false)
    }
  }

  const intervencoes = camadas.filter((c) => c.kind === 'intervention').length
  const protecoes = camadas.length - intervencoes

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Máscaras de ${photo.original_filename}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-5xl rounded-xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-100">Máscaras e Architecture Lock</h2>
            <p className="truncate text-sm text-neutral-500" title={photo.original_filename}>
              {photo.original_filename}
            </p>
          </div>
          <Button variant="ghost" type="button" onClick={onClose}>
            Fechar
          </Button>
        </header>

        {resource.kind === 'loading' && <Loading label="Carregando máscaras…" />}
        {resource.kind === 'error' && (
          <div className="mt-4">
            <ErrorNotice message={resource.message} onRetry={reload} />
          </div>
        )}

        {resource.kind === 'ready' && (
          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="flex flex-col gap-3">
              {imageError && <ErrorNotice message={imageError} />}
              {!imageError && !imageUrl && <Loading label="Carregando foto original…" />}
              {imageUrl && (
                <Overlay
                  url={imageUrl}
                  camadas={camadas}
                  desenho={desenho}
                  selecionada={selecionada}
                  onPonto={adicionarPonto}
                  onSelecionar={setSelecionada}
                  disabled={saving}
                />
              )}
              <p className="text-xs text-neutral-500">
                A foto original não é alterada: as máscaras são um overlay e ficam salvas como um
                registro à parte.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Veredito da geração — texto do servidor, exibido como veio. */}
              {estado && (
                <div
                  className={`rounded-md border p-3 ${
                    estado.generation_ready
                      ? 'border-emerald-900 bg-emerald-950/40'
                      : 'border-amber-900 bg-amber-950/30'
                  }`}
                >
                  <p className="text-xs tracking-wide text-neutral-400 uppercase">
                    {estado.generation_ready ? 'Pronta para gerar' : 'Geração bloqueada'}
                  </p>
                  {estado.blocked_reason ? (
                    <p className="mt-1 text-xs text-neutral-300">{estado.blocked_reason}</p>
                  ) : (
                    <p className="mt-1 text-xs text-neutral-300">
                      Há recorte de intervenção e o lock está ligado. A geração da próxima fase vai
                      alterar só o que está dentro dessas áreas.
                    </p>
                  )}
                  {estado.updated_at && (
                    <p className="mt-1 text-xs text-neutral-600">
                      Máscaras salvas em {dateTimeFormat.format(new Date(estado.updated_at))}
                    </p>
                  )}
                </div>
              )}

              {/* Architecture Lock: estado + quem pode mexer. */}
              {estado && (
                <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-neutral-100">Architecture Lock</p>
                      <p className="text-xs text-neutral-500">
                        {estado.architecture_lock
                          ? 'Ligado: a arquitetura original é preservada.'
                          : 'Desligado: a geração está recusada até religar.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!podeMexerNoLock || mudandoLock}
                      onClick={() => void alternarLock()}
                    >
                      {mudandoLock ? '…' : estado.architecture_lock ? 'Desligar' : 'Ligar'}
                    </Button>
                  </div>
                  {!podeMexerNoLock && (
                    <p className="mt-2 text-[11px] text-neutral-600">
                      Só o owner do workspace liga ou desliga o lock.
                    </p>
                  )}
                  {lockError && (
                    <div className="mt-2">
                      <ErrorNotice message={lockError} />
                    </div>
                  )}
                </div>
              )}

              {/* Ferramenta de desenho. */}
              <div className="flex flex-col gap-2">
                <p className="text-xs tracking-wide text-neutral-500 uppercase">Desenhar</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['intervention', 'protect'] as MaskKind[]).map((valor) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => setTipo(valor)}
                      className={`rounded-md border px-2 py-1.5 text-xs ${
                        tipo === valor
                          ? KIND_STYLES[valor].chip
                          : 'border-neutral-800 text-neutral-400'
                      }`}
                    >
                      {KIND_STYLES[valor].nome}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-neutral-600">
                  {tipo === 'intervention'
                    ? 'Onde a peça pode mudar na proposta.'
                    : 'O que não pode ser tocado: janela, telhado, prédio vizinho.'}
                </p>

                {desenho ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      disabled={desenho.points.length < 3}
                      onClick={fecharPoligono}
                    >
                      Fechar área ({desenho.points.length})
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setDesenho(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <p className="text-[11px] text-neutral-600">
                    Clique na foto para marcar os vértices. Três pontos fecham uma área (Enter
                    fecha, Esc cancela).
                  </p>
                )}
              </div>

              {/* Lista de camadas — o "vazio" desta fatia. */}
              <div className="flex flex-col gap-2">
                <p className="text-xs tracking-wide text-neutral-500 uppercase">
                  Camadas ({intervencoes} intervenção · {protecoes} proteção)
                </p>

                {camadas.length === 0 ? (
                  <div className="rounded-md border border-dashed border-neutral-800 p-3">
                    <p className="text-sm text-neutral-300">Nenhuma área marcada</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Sem recorte de intervenção não há onde gerar — e gerar por fora alteraria a
                      arquitetura do cliente.
                    </p>
                  </div>
                ) : (
                  <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
                    {camadas.map((camada, indice) => (
                      <li
                        key={indice}
                        className={`rounded-md border p-2 ${
                          indice === selecionada ? 'border-neutral-600' : 'border-neutral-800'
                        }`}
                        onPointerEnter={() => setSelecionada(indice)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${
                              KIND_STYLES[camada.kind].chip
                            }`}
                          >
                            {KIND_STYLES[camada.kind].nome}
                          </span>
                          <button
                            type="button"
                            className="text-[11px] text-neutral-500 hover:text-neutral-300"
                            onClick={() => removerCamada(indice)}
                          >
                            Remover
                          </button>
                        </div>
                        <input
                          value={camada.label}
                          placeholder={KIND_STYLES[camada.kind].nome}
                          onChange={(event) => renomear(indice, event.target.value)}
                          className="mt-1.5 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                        />
                        <p className="mt-1 text-[10px] text-neutral-600">
                          {camada.points.length} vértices ·{' '}
                          {numberFormat.format(areaDe(camada.points))} px²
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {saveError && <ErrorNotice message={saveError} />}

              <div className="flex items-center gap-2">
                <Button type="button" onClick={() => void salvar()} disabled={saving || !sujo}>
                  {saving ? 'Salvando…' : 'Salvar máscaras'}
                </Button>
                {sujo && !saving && (
                  <span className="text-[11px] text-amber-500">alterações não salvas</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
