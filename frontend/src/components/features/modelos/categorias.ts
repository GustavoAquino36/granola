import type { CategoriaModelo } from "@/types/domain"

/**
 * Categorias padrao oferecidas no select + filtros.
 * Backend aceita qualquer string (campo TEXT), mas pra consistencia visual
 * trabalhamos com essa lista. Editar aqui propaga pra ModelosPage e ModeloEditorPage.
 */
export interface CategoriaItem {
  value: CategoriaModelo
  label: string
}

export const CATEGORIAS_MODELO: CategoriaItem[] = [
  { value: "trabalhista", label: "Trabalhista" },
  { value: "civel", label: "Cível" },
  { value: "contratos", label: "Contratos" },
  { value: "tributario", label: "Tributário" },
  { value: "penal", label: "Penal" },
  { value: "familia", label: "Família" },
  { value: "empresarial", label: "Empresarial" },
  { value: "previdenciario", label: "Previdenciário" },
  { value: "consumidor", label: "Consumidor" },
  { value: "outros", label: "Outros" },
]

export function labelDeCategoria(value: string | null | undefined): string {
  if (!value) return "outros"
  const found = CATEGORIAS_MODELO.find((c) => c.value === value.toLowerCase())
  return found?.label ?? value
}
