import { useEffect, useState } from 'react'
import { fetchPhotoBlob, type Photo } from '../api/client'

/**
 * Miniatura de uma foto do levantamento.
 *
 * A rota do original exige token, e um `<img src>` não manda header — então os
 * bytes vêm por axios e viram object URL. A URL é revogada no unmount para a
 * aba não segurar foto de levantamento inteira em memória.
 */
export default function PhotoThumb({ photo, alt }: { photo: Photo; alt: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null

    void (async () => {
      try {
        const blob = await fetchPhotoBlob(photo.id)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
        setState('ready')
      } catch {
        if (alive) setState('error')
      }
    })()

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id])

  if (state === 'loading') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface">
        <span className="text-xs text-ink-dim">Carregando…</span>
      </div>
    )
  }

  if (state === 'error' || !url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface px-3 text-center">
        <span className="text-xs text-bad">Não foi possível carregar esta foto.</span>
      </div>
    )
  }

  return <img src={url} alt={alt} className="h-full w-full object-cover" />
}
