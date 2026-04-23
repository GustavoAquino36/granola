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

export type PrioridadePrazo = "alta" | "media" | "normal" | "baixa" | string
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
