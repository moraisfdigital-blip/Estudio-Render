import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Traduz o clique do usuário em pixel da foto original.
 *
 * ## Por que isto não é uma regra de três
 *
 * A foto é desenhada com `object-contain`: ela cabe inteira dentro da caixa da
 * `<img>` e, quando as proporções não batem, sobram tarjas nas laterais ou em
 * cima e embaixo. O SVG de marcação usa `preserveAspectRatio="xMidYMid meet"`,
 * que faz exatamente o mesmo encaixe. Então o pixel só sai certo se a conta
 * descontar essas tarjas.
 *
 * Mapear linearmente sobre a caixa da `<img>` dá o mesmo resultado **enquanto**
 * a caixa tiver a proporção da foto. Quando um `max-height` corta a altura
 * — janela baixa, notebook de tela curta, foto em pé — a proporção muda e as
 * contas divergem. Medido com foto 1600×1200 numa caixa de 700 px:
 *
 * | caixa da `<img>` | linear lê | o SVG desenha em | divergência |
 * |------------------|-----------|------------------|-------------|
 * | 700 × 525        | 1200      | 1200             | 0 px        |
 * | 700 × 372        | 1200      | 1365             | −165 px     |
 * | 700 × 279        | 1200      | 1553             | −353 px     |
 *
 * 353 px de 1600 são ~22% de erro numa medida que vira metro quadrado e vira
 * preço. O mesmo defeito, com o mesmo número, apareceu no protótipo antigo e
 * está registrado em `docs/ACHADO-calibracao-escala.md`.
 *
 * A falha é silenciosa: nenhum erro, só um número errado. Por isso a conta
 * mora aqui, num lugar só, em vez de repetida em cada diálogo.
 */
export function useFotoGeometria(imageRef: RefObject<HTMLImageElement | null>) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  /** Tela → original: quanto vale 1 px de tela em px da foto. Escala traços e
   *  marcadores para eles terem o mesmo tamanho aparente em qualquer janela. */
  const [scale, setScale] = useState(1)
  // O mapeamento não pode esperar o React re-renderizar: um `pointermove`
  // durante o arraste precisa do encaixe deste instante, não do anterior.
  const encaixe = useRef<{ escala: number; margemX: number; margemY: number } | null>(null)

  const medir = useCallback(() => {
    const image = imageRef.current
    if (!image || !image.naturalWidth) return
    const rect = image.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const nat = { width: image.naturalWidth, height: image.naturalHeight }
    const escala = Math.min(rect.width / nat.width, rect.height / nat.height)
    encaixe.current = {
      escala,
      margemX: (rect.width - nat.width * escala) / 2,
      margemY: (rect.height - nat.height * escala) / 2,
    }

    setNatural((atual) =>
      atual && atual.width === nat.width && atual.height === nat.height ? atual : nat,
    )
    setScale(1 / escala)
  }, [imageRef])

  useEffect(() => {
    const image = imageRef.current
    if (!image) return
    if (image.complete) medir()
    const observador = new ResizeObserver(medir)
    observador.observe(image)
    // Um resize da janela pode mudar o encaixe sem mudar a caixa da `<img>`
    // (é o caso de `max-h-[62vh]`, que depende da altura da janela).
    window.addEventListener('resize', medir)
    return () => {
      observador.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [medir, imageRef])

  /**
   * Pixel da foto original sob o ponteiro, ou `null` se o clique caiu na tarja
   * (fora da foto) ou se ainda não houve o que medir.
   */
  const paraOriginal = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const image = imageRef.current
      const enc = encaixe.current
      if (!image || !enc || !natural || enc.escala <= 0) return null
      const rect = image.getBoundingClientRect()
      const x = (clientX - rect.left - enc.margemX) / enc.escala
      const y = (clientY - rect.top - enc.margemY) / enc.escala
      if (x < 0 || y < 0 || x > natural.width || y > natural.height) return null
      return { x, y }
    },
    [imageRef, natural],
  )

  /** Igual a `paraOriginal`, mas prende o ponto na borda em vez de descartar.
   *  Serve para arrastar um marcador: sair da foto não pode soltá-lo. */
  const paraOriginalPreso = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const image = imageRef.current
      const enc = encaixe.current
      if (!image || !enc || !natural || enc.escala <= 0) return null
      const rect = image.getBoundingClientRect()
      const x = (clientX - rect.left - enc.margemX) / enc.escala
      const y = (clientY - rect.top - enc.margemY) / enc.escala
      return {
        x: Math.min(Math.max(x, 0), natural.width),
        y: Math.min(Math.max(y, 0), natural.height),
      }
    },
    [imageRef, natural],
  )

  return { natural, scale, medir, paraOriginal, paraOriginalPreso }
}
