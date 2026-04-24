import type { Financeiro } from "@/types/domain"

/**
 * Quanto tempo resta de contrato. null = permanente; 0 = encerrado.
 * Calcula a partir de data_inicio_contrato (formato YYYY-MM) e meses_contrato.
 */
export function mesesRestantes(f: Financeiro): number | null {
  if (!f.fixo || !f.meses_contrato || f.meses_contrato <= 0) return null
  if (!f.data_inicio_contrato) return null
  const [anoStr, mesStr] = f.data_inicio_contrato.split("-")
  const anoI = parseInt(anoStr, 10)
  const mesI = parseInt(mesStr, 10)
  if (!anoI || !mesI) return null
  const now = new Date()
  const elapsed = (now.getFullYear() - anoI) * 12 + (now.getMonth() + 1 - mesI)
  const rest = f.meses_contrato - elapsed
  return rest > 0 ? rest : 0
}

export type SortCol = "descricao" | "dia" | "valor" | "data_vencimento"
export type SortDir = "asc" | "desc"
export interface SortState {
  col: SortCol | null
  dir: SortDir
}

/** Aplica ordenacao a uma lista de Financeiro segundo o SortState. */
export function applySort(itens: Financeiro[], sort: SortState): Financeiro[] {
  if (!sort.col) return itens
  const dir = sort.dir === "asc" ? 1 : -1
  return itens.slice().sort((a, b) => {
    if (sort.col === "valor") return ((a.valor || 0) - (b.valor || 0)) * dir
    if (sort.col === "dia") {
      const da = a.data_vencimento
        ? new Date(`${a.data_vencimento}T12:00:00`).getDate()
        : 0
      const db = b.data_vencimento
        ? new Date(`${b.data_vencimento}T12:00:00`).getDate()
        : 0
      return (da - db) * dir
    }
    if (sort.col === "data_vencimento") {
      return ((a.data_vencimento || "").localeCompare(b.data_vencimento || "")) * dir
    }
    if (sort.col === "descricao") {
      return a.descricao.localeCompare(b.descricao, "pt-BR") * dir
    }
    return 0
  })
}
