import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Project } from '../api/client'

/**
 * Qual projeto está aberto, para o cabeçalho saber o que mostrar.
 *
 * No protótipo o nome do projeto mora no topo, ao lado da marca, e é editável
 * ali mesmo. Mas quem conhece o projeto é a tela de dentro, não a moldura —
 * então a tela de dentro publica aqui, e o cabeçalho lê.
 *
 * Sem projeto aberto (lista de projetos, catálogo) o valor é `null` e o
 * cabeçalho some com o bloco do nome, em vez de mostrar um campo vazio.
 */

type Valor = {
  projeto: Project | null
  definir: (projeto: Project | null) => void
}

const Contexto = createContext<Valor>({ projeto: null, definir: () => {} })

export function ProjetoAtualProvider({ children }: { children: ReactNode }) {
  const [projeto, definir] = useState<Project | null>(null)
  const valor = useMemo(() => ({ projeto, definir }), [projeto])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjetoAtual() {
  return useContext(Contexto)
}
