import { apiGet, apiPost } from "./client"
import type {
  AgendaEvent,
  ClienteDetail,
  ClienteInput,
  ClientesResponse,
  ColetaDatajudStatus,
  ColetaLogResponse,
  MovimentacaoInput,
  ParteInput,
  PrazosResponse,
  ProcessoDetail,
  ProcessoInput,
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
// Processos — /api/granola/processos?cliente_id=&status=&area=&busca=&limite=
// --------------------------------------------------------------------------
export interface ListarProcessosParams {
  clienteId?: number
  status?: string
  area?: string
  busca?: string
  limite?: number
}

export async function fetchProcessos(params: ListarProcessosParams = {}) {
  const qs = new URLSearchParams()
  if (params.clienteId !== undefined) qs.set("cliente_id", String(params.clienteId))
  if (params.status) qs.set("status", params.status)
  if (params.area) qs.set("area", params.area)
  if (params.busca) qs.set("busca", params.busca)
  if (params.limite) qs.set("limite", String(params.limite))
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return apiGet<ProcessosResponse>(`/api/granola/processos${suffix}`)
}

/** GET /api/granola/processo?id=X — detalhe com cliente + partes + movs + prazos. */
export async function fetchProcessoById(id: number): Promise<ProcessoDetail> {
  const res = await apiGet<{ processo: ProcessoDetail }>(
    `/api/granola/processo?id=${id}`
  )
  return res.processo
}

/** POST /api/granola/processo/upsert — cria (sem id) ou atualiza (com id). */
export async function upsertProcesso(
  input: ProcessoInput & { id?: number }
): Promise<{ id: number }> {
  return apiPost<{ id: number }>("/api/granola/processo/upsert", input)
}

/** POST /api/granola/processo/status — muda status do processo (ativo/suspenso/encerrado). */
export async function updateProcessoStatus(id: number, status: string) {
  return apiPost<{ status: "ok" }>("/api/granola/processo/status", {
    id,
    status,
  })
}

/** Arquiva via upsert mudando status. Convencao: 'arquivado' eh soft, mantem historico. */
export async function archiveProcesso(id: number) {
  return updateProcessoStatus(id, "arquivado")
}

export async function unarchiveProcesso(id: number) {
  return updateProcessoStatus(id, "ativo")
}

// --------------------------------------------------------------------------
// Partes do processo — /api/granola/parte/(upsert|delete)
// --------------------------------------------------------------------------
export async function upsertParte(
  input: ParteInput & { id?: number }
): Promise<{ id: number }> {
  return apiPost<{ id: number }>("/api/granola/parte/upsert", input)
}

export async function deleteParte(id: number) {
  return apiPost<{ status: "ok" }>("/api/granola/parte/delete", { id })
}

// --------------------------------------------------------------------------
// Movimentacoes — /api/granola/movimentacao/criar (manual)
// --------------------------------------------------------------------------
export async function criarMovimentacao(input: MovimentacaoInput) {
  return apiPost<{ id: number }>("/api/granola/movimentacao/criar", input)
}

// --------------------------------------------------------------------------
// Coleta DataJud (real-time via polling de log + status)
// --------------------------------------------------------------------------

/** Dispara a coleta DataJud em thread do backend. Retorna imediato. */
export async function startColetaDatajud() {
  return apiPost<{ status: "iniciada"; msg: string }>(
    "/api/granola/publicacoes/coletar-datajud"
  )
}

/** Status consolidado da ultima coleta DataJud (fim=null enquanto rodando). */
export async function fetchColetaDatajudStatus() {
  return apiGet<ColetaDatajudStatus>("/api/granola/publicacoes-datajud/status")
}

/** Busca log incremental desde o cursor `since`. Retorna {entries, latest}. */
export async function fetchColetaLog(since: number) {
  return apiGet<ColetaLogResponse>(
    `/api/granola/publicacoes/log?since=${since}`
  )
}

// --------------------------------------------------------------------------
// Coleta DJEN (por OAB) — mesmo padrao de polling/log do DataJud
// --------------------------------------------------------------------------

export async function startColetaDjen() {
  return apiPost<{ status: "iniciada"; msg: string }>(
    "/api/granola/publicacoes/coletar-djen"
  )
}

export async function fetchColetaDjenStatus() {
  return apiGet<{
    ultima_coleta: string | null
    resumo: {
      total: number
      elegiveis: number
      oabs_consultadas: number
      consultados: number
      com_novidade: number
      novas_movimentacoes: Array<{
        processo_id: number
        numero_cnj: string
        titulo: string
        data: string
        descricao: string
        hash_djen: string | null
        link: string | null
      }>
      nao_encontrados: Array<{
        processo_id: number
        numero_cnj: string
        titulo: string
      }>
      erros: string[]
      inicio: string
      fim: string | null
      modo: string | null
    } | null
  }>("/api/granola/publicacoes-djen/status")
}

// --------------------------------------------------------------------------
// Verificacao manual (Selenium e-SAJ + PJe pros faltantes da ultima DataJud)
// --------------------------------------------------------------------------

export interface VerificacaoManualResponse {
  status: "iniciada" | "vazio" | "sem_cobertura"
  msg: string
  ignorados?: Array<{ processo_id: number; numero_cnj: string }>
}

/** Dispara Selenium e-SAJ+PJe em sequencia pros processos que a ultima
 *  coleta DataJud nao conseguiu resolver. Requer Chromium aberto no CDP 9222
 *  com sessao logada nos tribunais + certificado digital. So funciona na
 *  maquina do advogado em producao. */
export async function startVerificacaoManual() {
  return apiPost<VerificacaoManualResponse>(
    "/api/granola/publicacoes/verificacao-manual"
  )
}

// --------------------------------------------------------------------------
// Tratamento de publicacoes (marcar visto / pendente / criar prazo)
// --------------------------------------------------------------------------

export async function marcarMovVista(movId: number) {
  return apiPost<{ status: "ok" }>(
    "/api/granola/publicacao/marcar-vista",
    { mov_id: movId }
  )
}

export async function marcarMovPendente(movId: number) {
  return apiPost<{ status: "ok" }>(
    "/api/granola/publicacao/marcar-pendente",
    { mov_id: movId }
  )
}

export interface CriarPrazoDaMovInput {
  mov_id: number
  titulo: string
  data_vencimento: string
  prioridade?: "alta" | "media" | "normal" | "baixa"
  tipo?: string
  descricao?: string
}

/** Cria um prazo a partir de uma movimentacao + marca a mov como tratamento='prazo'. */
export async function criarPrazoDaMov(input: CriarPrazoDaMovInput) {
  return apiPost<{ status: "ok"; prazo_id: number }>(
    "/api/granola/publicacao/criar-prazo",
    input
  )
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
  processos: (params: ListarProcessosParams = {}) =>
    ["granola", "processos", params] as const,
  processo: (id: number) => ["granola", "processo", id] as const,
  agenda: (params: ListarAgendaParams = {}) =>
    ["granola", "agenda", params] as const,
  coletaDatajudStatus: ["granola", "coleta", "datajud", "status"] as const,
  coletaDjenStatus: ["granola", "coleta", "djen", "status"] as const,
  coletaLog: (since: number) =>
    ["granola", "coleta", "log", since] as const,
}
