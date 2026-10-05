import { useState } from 'react'
import { deletePhoto, fetchPhotoOriginalBlob } from '../../api/client'
import type { Photo } from '../../api/client'
import CalibrationDialog from '../CalibrationDialog'
import ElementsDialog from '../ElementsDialog'
import MasksDialog from '../MasksDialog'
import ProposalDialog from '../ProposalDialog'
import VersionsDialog from '../VersionsDialog'
import { Botao, Cartao, Rotulo } from './pecas'

/**
 * O bloco que o protótipo mostra assim que uma foto é escolhida — lá é a
 * "ETAPA 02 · ESCALA DA FOTOGRAFIA", logo abaixo da biblioteca.
 *
 * ## Por que ele existe
 *
 * Calibrar escala, marcar elementos, marcar máscaras, gerar proposta e
 * escolher versão são cinco trabalhos que já funcionam, e ficavam pendurados
 * em cada cartãozinho de foto. Ao trazer a biblioteca para o formato do
 * protótipo eles perderiam o lugar — e some função que existe, sem aviso.
 * Aqui eles ficam reunidos, e cada botão diz o estado atual em vez de só
 * repetir o nome da ação.
 *
 * As janelas continuam sendo as mesmas de sempre: nenhuma foi reescrita.
 */
export default function BlocoFotoAberta({
  foto,
  onMudou,
  onRemovida,
}: {
  foto: Photo
  onMudou: () => void
  onRemovida: (id: string) => void
}) {
  const [aberto, setAberto] = useState<
    'escala' | 'elementos' | 'mascaras' | 'proposta' | 'versoes' | null
  >(null)
  const [ocupado, setOcupado] = useState<'original' | 'remover' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function verOriginal() {
    setOcupado('original')
    setErro(null)
    try {
      // A rota do original exige token, e `window.open` não manda cabeçalho:
      // os bytes vêm autenticados e viram uma aba com object URL.
      const blob = await fetchPhotoOriginalBlob(foto.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      setErro('Não foi possível abrir o original.')
    } finally {
      setOcupado(null)
    }
  }

  async function remover() {
    if (!window.confirm(`Remover "${foto.original_filename}"? Isso não pode ser desfeito.`)) return
    setOcupado('remover')
    setErro(null)
    try {
      await deletePhoto(foto.id)
      onRemovida(foto.id)
    } catch {
      setErro('Não foi possível remover a foto.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <>
      <Cartao>
        <div className="flex flex-wrap items-start justify-between gap-3.5 border-b border-line-soft pb-4">
          <div className="min-w-0">
            <Rotulo cor="destaque">Etapa 02 · Escala e marcações</Rotulo>
            <h2 className="mt-[7px] truncate text-xl font-semibold">{foto.original_filename}</h2>
          </div>
          <span
            className={`shrink-0 rounded-full border px-[9px] py-[7px] text-[10px] ${
              foto.calibrated
                ? 'border-[#f1bed7] bg-accent-soft text-accent-strong'
                : 'border-warn/40 bg-warn-soft text-warn'
            }`}
          >
            {foto.calibrated ? 'Escala definida' : 'Sem escala'}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Botao principal onClick={() => setAberto('escala')}>
            {foto.calibrated ? 'Conferir escala' : 'Calibrar fotografia'}
          </Botao>
          <Botao onClick={() => setAberto('elementos')}>
            {foto.element_count === 0
              ? 'Marcar elementos'
              : `${foto.element_count} ${foto.element_count === 1 ? 'elemento' : 'elementos'}`}
          </Botao>
          <Botao onClick={() => setAberto('mascaras')}>
            {foto.intervention_count === 0
              ? 'Marcar máscaras'
              : `${foto.intervention_count} ${foto.intervention_count === 1 ? 'área de intervenção' : 'áreas de intervenção'}`}
          </Botao>
          <Botao onClick={() => setAberto('proposta')}>Proposta visual</Botao>
          <Botao onClick={() => setAberto('versoes')}>
            {foto.approved_version_id ? 'Versão aprovada' : 'Versões'}
          </Botao>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line-soft pt-3.5">
          <button
            type="button"
            onClick={() => void verOriginal()}
            disabled={ocupado === 'original'}
            className="text-xs text-ink-soft underline-offset-2 transition hover:text-ink hover:underline disabled:opacity-50"
          >
            {ocupado === 'original' ? 'Abrindo…' : 'Ver original'}
          </button>
          <button
            type="button"
            onClick={() => void remover()}
            disabled={ocupado === 'remover'}
            className="text-xs text-ink-dim transition hover:text-bad disabled:opacity-50"
          >
            {ocupado === 'remover' ? 'Removendo…' : 'Remover foto'}
          </button>
        </div>

        {erro && <p className="mt-3 text-xs text-bad">{erro}</p>}
      </Cartao>

      {aberto === 'escala' && (
        <CalibrationDialog
          photo={foto}
          onClose={() => setAberto(null)}
          onSaved={() => {
            setAberto(null)
            onMudou()
          }}
        />
      )}
      {aberto === 'elementos' && (
        <ElementsDialog
          photo={foto}
          onClose={() => {
            setAberto(null)
            onMudou()
          }}
        />
      )}
      {aberto === 'mascaras' && (
        <MasksDialog
          photo={foto}
          onSaved={onMudou}
          onClose={() => {
            setAberto(null)
            onMudou()
          }}
        />
      )}
      {aberto === 'proposta' && (
        <ProposalDialog
          photo={foto}
          onGenerated={onMudou}
          onClose={() => {
            setAberto(null)
            onMudou()
          }}
        />
      )}
      {aberto === 'versoes' && (
        <VersionsDialog
          photo={foto}
          onChanged={onMudou}
          onClose={() => {
            setAberto(null)
            onMudou()
          }}
        />
      )}
    </>
  )
}
