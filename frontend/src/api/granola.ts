import { apiGet, apiPost } from "./client"
import type {
  AgendaEvent,
  ClienteDetail,
  ClienteInput,
  ClientesResponse,
  PrazosResponse,
  ProcessosResponse,
  Stats,
} from "@/types/domain"

export interface AgendaResponse {
  eventos: AgendaEvent[]
  total: number
}

/**
 * Fetchers do namespace /api/granola/*.
 *
 * Convencao: funcoes puras retornando o shape ja tipado.
 * Composicao com TanStack Query fica por conta dos componentes
 * (useQuery({ queryKey, queryFn: fetchXxx })). Abstrai em hooks dedicados
 * so quando o mesmo query aparecer em 3+ lugares.
 */

// --------------------------------------------------------------------------
// Stats (dashboard everything) — /api/granola/stats
// Inclui: totais + prazos urgentes/vencidos + resumo financeiro +
// distribuicoes (por_status, por_area) + movs recentes + prazos proximos.
// --------------------------------------------------------------------------
export async function fetchStats() {
  return apiGet<Stats>("/api/granola/stats")
}

// --------------------------------------------------------------------------
// Prazos — /api/granola/prazos?dias=&status=&prioridade=&processo_id=
// --------------------------------------------------------------------------
export interface ListarPrazosParams {
  /** Ate quantos dias a partir de hoje. Default do backend: todos. */
  dias?: number
  /** Default: 'pendente'. Passar 'all' desativa o filtro. */
  status?: "pendente" | "concluido" | "cancelado" | "all"
  prioridade?: "alta" | "media" | "normal" | "baixa"
  processoId?: number
}

export async function fetchPrazos(params: ListarPrazosParams = {}) {
  const qs = new URLSearchParams()
  if (params.dias !== undefined) qs.set("dias", String(params.dias))
  if (params.status && params.status !== "all") qs.set("status", params.status)
  if (params.prioridade) qs.set("prioridade", params.prioridade)
  if (params.processoId !== undefined) qs.set("processo_id", String(params.processoId))
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return apiGet<PrazosResponse>(`/api/granola/prazos${suffix}`)
}

// --------------------------------------------------------------------------
// Clientes — /api/granola/clientes?busca=&tipo=&ativo=&limite=
// --------------------------------------------------------------------------
export interface ListarClientesParams {
  busca?: string
  tipo?: "PF" | "PJ"
  ativo?: 0 | 1
  limite?: number
}

export async function fetchClientes(params: ListarClientesParams = {}) {
  const qs = new URLSearchParams()
  if (params.busca) qs.set("busca", params.busca)
  if (params.tipo) qs.set("tipo", params.tipo)
  if (params.ativo !== undefined) qs.set("ativo", String(params.ativo))
  if (params.limite) qs.set("limite", String(params.limite))
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return apiGet<ClientesResponse>(`/api/granola/clientes${suffix}`)
}

/** GET /api/granola/cliente?id=X retorna { cliente: ClienteDetail } com
 *  campos extras do detalhe (processos, financeiro_resumo, total_processos). */
export async function fetchClienteById(id: number): Promise<ClienteDetail> {
  const response = await apiGet<{ cliente: ClienteDetail }>(
    `/api/granola/cliente?id=${id}`
  )
  return response.cliente
}

/** POST /api/granola/cliente/upsert — cria se `id` ausente, atualiza se presente.
 *  Retorna `{ id }` do cliente persistido. */
export async function upsertCliente(
  input: ClienteInput & { id?: number }
): Promise<{ id: number }> {
  return apiPost<{ id: number }>("/api/granola/cliente/upsert", input)
}

/** Atalho pra arquivar (soft-delete) — mantem o registro mas marca ativo=0.
 *  Preferivel a cliente/delete por questao de sigilo OAB. */
export async function archiveCliente(id: number): Promise<{ id: number }> {
  return upsertCliente({ id, ativo: 0 } as ClienteInput & { id: number })
}

export async function unarchiveCliente(id: number): Promise<{ id: number }> {
  return upsertCliente({ id, ativo: 1 } as ClienteInput & { id: number })
}

// --------------------------------------------------------------------------
// Processos — /api/granola/processos
// --------------------------------------------------------------------------
export async function fetchProcessos() {
  return apiGet<ProcessosResponse>("/api/granola/processos")
}

// --------------------------------------------------------------------------
// Agenda — /api/granola/agenda?mes=YYYY-MM&tipo=
// --------------------------------------------------------------------------
export interface ListarAgendaParams {
  /** Mes no formato YYYY-MM. Default: mes corrente no backend. */
  mes?: string
  tipo?: string
}

export async function fetchAgenda(params: ListarAgendaParams = {}) {
  const qs = new URLSearchParams()
  if (params.mes) qs.set("mes", params.mes)
  if (params.tipo) qs.set("tipo", params.tipo)
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return apiGet<AgendaResponse>(`/api/granola/agenda${suffix}`)
}

// --------------------------------------------------------------------------
// Query keys padronizadas pra TanStack Query — compartilhadas pra que
// invalidate/refetch entre componentes hit o mesmo cache.
// --------------------------------------------------------------------------
export const queryKeys = {
  stats: ["granola", "stats"] as const,
  prazos: (params: ListarPrazosParams = {}) =>
    ["granola", "prazos", params] as const,
  clientes: (params: ListarClientesParams = {}) =>
    ["granola", "clientes", params] as const,
  cliente: (id: number) => ["granola", "cliente", id] as const,
  processos: () => ["granola", "processos"] as const,
  agenda: (params: ListarAgendaParams = {}) =>
    ["granola", "agenda", params] as const,
}
