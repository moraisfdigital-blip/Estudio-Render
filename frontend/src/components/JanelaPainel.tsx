import { useEffect, type ReactNode } from 'react'
import { Rotulo } from './prototipo/pecas'
import { Button } from './ui'

/**
 * Janela que abre por cima do painel oficial, no mesmo formato das janelas de
 * máscaras, proposta e versões: fundo escurecido, cartão com título e
 * "Fechar". Fecha no Esc e no clique fora do cartão.
 */
export default function JanelaPainel({
  rotulo,
  titulo,
  onClose,
  children,
}: {
  rotulo: string
  titulo: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 sm:p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-5xl rounded-xl border border-line bg-app p-5 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Rotulo cor="destaque">{rotulo}</Rotulo>
            <h2 className="mt-2 text-lg font-semibold text-ink">{titulo}</h2>
          </div>
          <Button variant="ghost" type="button" onClick={onClose}>
            Fechar
          </Button>
        </header>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
