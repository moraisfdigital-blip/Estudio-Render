import { useEffect, useState } from 'react'
import { fetchBrandLogoBlob } from '../api/client'

/**
 * Logo da marca.
 *
 * A rota do arquivo exige token e `<img src>` não manda header, então os bytes
 * vêm por requisição autenticada e viram object URL — mesmo caminho do
 * original da foto. O object URL é revogado ao desmontar para o navegador não
 * segurar o blob.
 *
 * Marca sem logo não renderiza nada: logo é opcional no cadastro.
 */
export default function BrandLogo({
  brandId,
  name,
  className = 'h-5 w-auto max-w-20 object-contain',
}: {
  brandId: string
  name: string
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null

    void (async () => {
      try {
        const blob = await fetchBrandLogoBlob(brandId)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        // Logo é enfeite: se não carregar, o nome da marca já identifica.
        if (alive) setUrl(null)
      }
    })()

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [brandId])

  if (!url) return null
  return <img src={url} alt={`Logo ${name}`} className={className} />
}
