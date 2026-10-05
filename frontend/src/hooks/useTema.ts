import { useCallback, useEffect, useState } from 'react'

export type Tema = 'claro' | 'escuro'

const CHAVE = 'enby-pro.tema'

/** Lê a escolha guardada. Navegador com armazenamento bloqueado (janela
 *  anônima, cookies negados) não pode derrubar a aplicação: cai no claro. */
function temaGuardado(): Tema {
  try {
    return localStorage.getItem(CHAVE) === 'escuro' ? 'escuro' : 'claro'
  } catch {
    return 'claro'
  }
}

/** Aplica no `<html>`. Fora do React de propósito: o `index.html` chama isto
 *  antes da primeira pintura, senão a tela pisca clara antes de ficar escura. */
export function aplicarTema(tema: Tema) {
  document.documentElement.dataset.theme = tema === 'escuro' ? 'dark' : 'light'
}

/**
 * O modo claro/escuro da interface.
 *
 * Claro é o padrão do produto e a preferência do sistema operacional não é
 * consultada — ver o comentário em `index.css`. A escolha é por navegador, não
 * por conta: é preferência de quem está olhando a tela, não dado do projeto,
 * e por isso não vai para o servidor.
 */
export function useTema() {
  const [tema, setTema] = useState<Tema>(temaGuardado)

  useEffect(() => {
    aplicarTema(tema)
    try {
      localStorage.setItem(CHAVE, tema)
    } catch {
      // Sem armazenamento a escolha só vale nesta aba. Melhor do que quebrar.
    }
  }, [tema])

  const alternar = useCallback(() => {
    setTema((atual) => (atual === 'claro' ? 'escuro' : 'claro'))
  }, [])

  return { tema, alternar }
}
