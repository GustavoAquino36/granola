/**
 * Types de dominio do Granola CRM — contratos alinhados com o backend Python.
 * Fonte da verdade: granola/database.py (colunas das tabelas) + granola/server.py
 * (shape de cada endpoint).
 *
 * Nomes e opcionalidades seguem o que o backend realmente devolve — nao o que
 * a gente gostaria. Se aparecer divergencia, o codigo Python vence.
 */

// --------------------------------------------------------------------------
// CLIENTES
// --------------------------------------------------------------------------

export type TipoPessoa = "PF" | "PJ"

export interface Cliente {
  id: number
  tipo: TipoPessoa | string
  nome: string
  cpf_cnpj: string | null
  rg: string | null
  email: string | null
  telefone: string | null
  telefone2: string | null
  endereco_cep: string | null
  endereco_logradouro: string | null
  endereco_numero: string | null
  endereco_complemento: string | null
  endereco_bairro: string | null
  endereco_cidade: string | null
  endereco_uf: string | null
  data_nascimento: string | null
  profissao: string | null
  estado_civil: string | null
  nacionalidade: string | null
  observacao: string | null
  ativo: 0 | 1
  criado_em: string
  atualizado_em: string | null
  /** Preenchido por listar_clientes via JOIN. */
  total_processos?: number
}

export interface ClientesResponse {
  clientes: Cliente[]
  total: number
}

/** Resposta de /api/granola/cliente?id=X — Cliente + fields computados do detalhe. */
export interface ClienteDetail extends Cliente {
  processos: ClienteProcessoSummary[]
  total_processos: number
  financeiro_resumo: {
    receitas: number
    despesas: number
    pendentes: number
  }
}

export interface ClienteProcessoSummary {
  id: number
  numero_cnj: string | null
  titulo: string | null
  area: string
  status: string
  fase: string
  valor_causa: number
}

/** Shape do body pro upsert. Todos os fields opcionais pro backend
 *  (menos `nome` e `tipo`). `id` ausente => cria novo; presente => atualiza. */
export type ClienteInput = Partial<
  Omit<Cliente, "id" | "criado_em" | "atualizado_em" | "total_processos">
> & {
  nome: string
  tipo: TipoPessoa
}

// --------------------------------------------------------------------------
// PROCESSOS
// --------------------------------------------------------------------------

export type PoloProcesso = "ativo" | "passivo" | string

export interface Processo {
  id: number
  cliente_id: number | null
  numero_cnj: string | null
  numero_interno: string | null
  titulo: string | null
  tipo: string
  area: string
  rito: string | null
  classe: string | null
  comarca: string | null
  vara: string | null
  tribunal: string | null
  juiz: string | null
  valor_causa: number
  valor_condenacao: number
  polo: PoloProcesso | null
  parte_contraria: string | null
  cpf_cnpj_contraria: string | null
  advogado_contrario: string | null
  oab_contrario: string | null
  status: string
  fase: string
  kanban_coluna: string
  data_distribuicao: string | null
  data_encerramento: string | null
  observacao: string | null
  dados_extra: string | null
  link_autos: string | null
  criado_em: string
  atualizado_em: string | null
  /** Join em listar_processos. */
  cliente_nome?: string | null
}

export interface ProcessosResponse {
  processos: Processo[]
  total: number
}

/** Resposta de /api/granola/processo?id=X — Processo + joins do detalhe. */
export interface ProcessoDetail extends Processo {
  /** Preenchido pelo backend: dados basicos do cliente (id/nome/cpf_cnpj). */
  cliente: { id: number; nome: string; cpf_cnpj: string | null } | null
  partes: Parte[]
  movimentacoes: Movimentacao[]
  prazos: Prazo[]
  /** Backend ja retorna; o frontend ainda nao exibia ate a Fase 4. */
  documentos?: Documento[]
}

/** Shape do body pro upsert de processo. */
export type ProcessoInput = Partial<
  Omit<Processo, "id" | "criado_em" | "atualizado_em" | "cliente_nome">
> & {
  /** Em criacao eh obrigatorio; em update nao precisa se nao for mudar. */
  cliente_id?: number | null
}

/** Shape do body pro upsert de parte. */
export type ParteInput = Partial<Omit<Parte, "id">> & {
  processo_id: number
  nome: string
}

/** Shape do body pro criar de movimentacao manual. */
export type MovimentacaoInput = {
  processo_id: number
  tipo?: string
  descricao: string
  data_movimento: string
  fonte?: "manual"
  gera_prazo?: 0 | 1
}

// --------------------------------------------------------------------------
// PARTES (do processo)
// --------------------------------------------------------------------------

export interface Parte {
  id: number
  processo_id: number
  nome: string
  cpf_cnpj: string | null
  tipo: string
  polo: string | null
  advogado: string | null
  oab: string | null
  observacao: string | null
}

// --------------------------------------------------------------------------
// MOVIMENTAÇÕES
// --------------------------------------------------------------------------

export type FonteMovimentacao =
  | "datajud_auto"
  | "djen_auto"
  | "esaj_auto"
  | "pje_auto"
  | "manual"
  | string

export type TratamentoMov =
  | "pendente"
  | "visto"
  | "prazo"
  | "ignorado"
  | null
  | string

export interface Movimentacao {
  id: number
  processo_id: number
  tipo: string | null
  descricao: string
  /** Pode vir em DD/MM/YYYY ou YYYY-MM-DD conforme a fonte. */
  data_movimento: string
  fonte: FonteMovimentacao
  hash_dedup: string | null
  gera_prazo: 0 | 1
  criado_em: string
  /** Status de tratamento pelo usuario: pendente/visto/prazo/ignorado. */
  tratamento?: TratamentoMov
  /** Se tratamento='prazo', aponta pro prazo criado. */
  prazo_id?: number | null
  /** Joins em /api/granola/stats.movimentacoes_recentes. */
  numero_cnj?: string | null
  processo_titulo?: string | null
  cliente_nome?: string | null
  /** Campo computado sort-friendly, vem de stats. */
  data_sort?: string | null
}

// --------------------------------------------------------------------------
// PRAZOS
// --------------------------------------------------------------------------

/** Backend aceita qualquer string; o monolito legado usa "urgente" tambem.
 *  Mantemos as quatro padroes + abertura pra string pra nao quebrar dados antigos. */
export type PrioridadePrazo =
  | "urgente"
  | "alta"
  | "media"
  | "normal"
  | "baixa"
  | string
export type StatusPrazo = "pendente" | "concluido" | "cancelado" | string

export interface Prazo {
  id: number
  processo_id: number | null
  cliente_id: number | null
  movimentacao_id: number | null
  titulo: string
  descricao: string | null
  data_inicio: string | null
  data_vencimento: string
  data_conclusao: string | null
  tipo: string
  status: StatusPrazo
  prioridade: PrioridadePrazo
  alerta_dias: number
  responsavel: string | null
  criado_em: string
  atualizado_em: string | null
  /** Joins em listar_prazos. */
  numero_cnj?: string | null
  processo_titulo?: string | null
  cliente_nome?: string | null
}

export interface PrazosResponse {
  prazos: Prazo[]
  total: number
}

/** Shape do body pro upsert de prazo. `id` ausente = cria, presente = atualiza. */
export type PrazoInput = Partial<
  Omit<
    Prazo,
    "id" | "criado_em" | "atualizado_em" |
    "numero_cnj" | "processo_titulo" | "cliente_nome"
  >
> & {
  titulo: string
  data_vencimento: string
}

// --------------------------------------------------------------------------
// DOCUMENTOS
// --------------------------------------------------------------------------

export type TipoDocumento =
  | "peticao"
  | "contrato"
  | "procuracao"
  | "decisao"
  | "sentenca"
  | "comprovante"
  | "outro"
  | string

export interface Documento {
  id: number
  processo_id: number | null
  cliente_id: number | null
  nome: string
  tipo: TipoDocumento
  /** Nome do arquivo no disco — relativo a UPLOAD_DIR (granola/data/uploads/). */
  caminho: string
  tamanho_bytes: number | null
  hash_sha256: string | null
  observacao: string | null
  criado_em: string
}

export interface DocumentosResponse {
  documentos: Documento[]
  total: number
}

/** Body pro upload — `file` em base64 (data URL stripped). */
export interface DocumentoUploadInput {
  file: string
  nome: string
  tipo?: TipoDocumento
  processo_id?: number | null
  cliente_id?: number | null
  observacao?: string | null
}

// --------------------------------------------------------------------------
// KANBAN
// --------------------------------------------------------------------------

export interface KanbanCard {
  id: number
  numero_cnj: string | null
  titulo: string | null
  area: string
  fase: string
  kanban_coluna: string
  criado_em: string
  cliente_nome: string | null
}

export interface KanbanColuna {
  key: string
  label: string
  ordem: number
  cor: string
  cards: KanbanCard[]
}

export interface KanbanResponse {
  colunas: KanbanColuna[]
}

// --------------------------------------------------------------------------
// FINANCEIRO
// --------------------------------------------------------------------------

export type TipoFinanceiro =
  | "honorario"
  | "receita"
  | "reembolso"
  | "receita_fixa"
  | "receita_variavel"
  | "custa_judicial"
  | "custa_extrajudicial"
  | "despesa"
  | "custo_operacional"
  | "custo_variavel"
  | string

export type StatusFinanceiro = "pendente" | "pago" | "cancelado" | string

export interface Financeiro {
  id: number
  processo_id: number | null
  cliente_id: number | null
  tipo: TipoFinanceiro
  categoria: string | null
  descricao: string
  valor: number
  data_vencimento: string | null
  data_pagamento: string | null
  status: StatusFinanceiro
  forma_pagamento: string | null
  comprovante: string | null
  observacao: string | null
  socio: string | null
  cartao_corporativo: 0 | 1
  comprovante_img: string | null
  fixo: 0 | 1
  parcelas: number
  parcela_atual: number
  pago_por_cartao: string | null
  meses_contrato: number
  data_inicio_contrato: string | null
  criado_em: string
  atualizado_em: string | null
}

export interface ResumoFinanceiro {
  receitas: number
  despesas: number
  saldo: number
  pendentes: number
  rec_pendentes: number
  cust_pendentes: number
}

// --------------------------------------------------------------------------
// AGENDA (eventos)
// --------------------------------------------------------------------------

export interface AgendaEvent {
  id: number
  processo_id: number | null
  cliente_id: number | null
  prazo_id: number | null
  titulo: string
  descricao: string | null
  data_inicio: string
  data_fim: string | null
  tipo: string
  local: string | null
  status: string
  google_event_id: string | null
  criado_em: string
  atualizado_em: string | null
}

// --------------------------------------------------------------------------
// COLETA DE PUBLICAÇÕES (DataJud / DJEN / e-SAJ / PJe)
// --------------------------------------------------------------------------

export type ColetaSource = "datajud" | "djen" | "esaj" | "pje" | string
export type ColetaLogLevel = "info" | "warn" | "error" | "success" | string

/** Entry do buffer de log vindo de /api/granola/publicacoes/log?since=N. */
export interface ColetaLogEntry {
  seq: number
  ts: string
  source: ColetaSource
  level: ColetaLogLevel
  msg: string
  processo: string | null
}

export interface ColetaLogResponse {
  entries: ColetaLogEntry[]
  latest: number
}

/** Resumo consolidado do resultado da coleta DataJud (fim preenchido = terminou). */
export interface ColetaDatajudResumo {
  total: number
  elegiveis: number
  tribunais: number
  consultados: number
  com_novidade: number
  novas_movimentacoes: Array<{
    processo_id: number
    numero_cnj: string
    titulo: string
    data: string
    descricao: string
    codigo: string | null
  }>
  nao_encontrados: Array<{
    processo_id: number
    numero_cnj: string
    titulo: string
    tribunal_alias: string
  }>
  erros: string[]
  inicio: string
  fim: string | null
}

export interface ColetaDatajudStatus {
  ultima_coleta: string | null
  resumo: ColetaDatajudResumo | null
}

// --------------------------------------------------------------------------
// STATS — resposta completa de /api/granola/stats
// --------------------------------------------------------------------------

export interface Stats {
  total_clientes: number
  total_processos: number
  prazos_urgentes: number
  prazos_vencidos: number
  financeiro: ResumoFinanceiro
  /** Ex.: { ativo: 147, encerrado: 23 } */
  por_status: Record<string, number>
  /** Ex.: { trabalhista: 42, civel: 18 } */
  por_area: Record<string, number>
  /** Ultimos 10 movimentos com joins de processo + cliente. */
  movimentacoes_recentes: Movimentacao[]
  /** Prazos pendentes nos proximos 7 dias (ordenado por vencimento). */
  prazos_proximos: Prazo[]
}
