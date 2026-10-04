/**
 * O último projeto aberto neste navegador, para a entrada levar direto a ele.
 *
 * É só uma conveniência: se o armazenamento estiver bloqueado ou o projeto não
 * existir mais, a entrada abre o projeto mais recente.
 */
const CHAVE = 'enby-pro.ultimo-projeto'

export function lembrarProjeto(id: string): void {
  try {
    localStorage.setItem(CHAVE, id)
  } catch {
    // Navegador sem armazenamento: a entrada usa o mais recente.
  }
}

export function ultimoProjeto(): string | null {
  try {
    return localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}
