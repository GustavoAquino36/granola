/**
 * Formatters do dominio juridico brasileiro.
 * Tudo pt-BR. Robusto a entradas sujas (espacos, mascara parcial, null/undefined).
 */

// --------------------------------------------------------------------------
// Documentos
// --------------------------------------------------------------------------

/** So digitos, sem o resto. */
function onlyDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "")
}

/** "00011122233" -> "000.111.222-33". Se veio incompleto, retorna o que der. */
export function formatCPF(cpf: string | null | undefined): string {
  const d = onlyDigits(cpf)
  if (d.length !== 11) return d
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** "11222333000199" -> "11.222.333/0001-99". */
export function formatCNPJ(cnpj: string | null | undefined): string {
  const d = onlyDigits(cnpj)
  if (d.length !== 14) return d
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** Auto-detecta CPF (11 digitos) ou CNPJ (14 digitos). */
export function formatCpfCnpj(doc: string | null | undefined): string {
  const d = onlyDigits(doc)
  if (d.length === 11) return formatCPF(d)
  if (d.length === 14) return formatCNPJ(d)
  return d
}

/** "SP372868" ou "372868" ou "SP/372.868" -> "SP/372.868" */
export function formatOAB(oab: string | null | undefined): string {
  if (!oab) return ""
  const match = oab.match(/([A-Za-z]{2})?\s*\/?\s*([\d.]+)/)
  if (!match) return oab
  const uf = (match[1] ?? "").toUpperCase()
  const num = match[2].replace(/\D/g, "")
  if (!num) return oab
  // Formata com pontinhos a cada 3 digitos de tras pra frente
  const prettified = num.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return uf ? `${uf}/${prettified}` : prettified
}

// --------------------------------------------------------------------------
// Processos (CNJ)
// --------------------------------------------------------------------------

/** CNJ canonico: NNNNNNN-DD.AAAA.J.TR.OOOO (20 digitos). Backend ja normaliza
 *  na maioria dos casos, mas rodamos defensivo. */
export function formatCNJ(cnj: string | null | undefined): string {
  const d = onlyDigits(cnj)
  if (d.length !== 20) return cnj ?? ""
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`
}

// --------------------------------------------------------------------------
// Dinheiro
// --------------------------------------------------------------------------

const BRL_FMT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const BRL_COMPACT_FMT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
})

/** formatBRL(1234.5) -> "R$ 1.234,50". null/undefined -> "—". */
export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return BRL_FMT.format(value)
}

/** formatBRLCompact(48250) -> "R$ 48,3 mil". Para KPIs apertados. */
export function formatBRLCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return BRL_COMPACT_FMT.format(value)
}

// --------------------------------------------------------------------------
// Datas
// --------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

const DATETIME_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const SHORT_DATE_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
})

const WEEKDAY_DATE_FMT = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
})

/** Aceita Date ou ISO string. null/undefined/invalid -> "". */
function parseDate(input: Date | string | null | undefined): Date | null {
  if (!input) return null
  const d = input instanceof Date ? input : new Date(input)
  return isNaN(d.getTime()) ? null : d
}

/** "2026-04-21T10:00:00" -> "21/04/2026". */
export function formatDate(input: Date | string | null | undefined): string {
  const d = parseDate(input)
  return d ? DATE_FMT.format(d) : ""
}

/** "2026-04-21T10:00:00" -> "21/04/2026 14:30". */
export function formatDateTime(input: Date | string | null | undefined): string {
  const d = parseDate(input)
  return d ? DATETIME_FMT.format(d).replace(",", " ·") : ""
}

/** "2026-04-21" -> "21/04". */
export function formatShortDate(input: Date | string | null | undefined): string {
  const d = parseDate(input)
  return d ? SHORT_DATE_FMT.format(d) : ""
}

/** "2026-04-22" -> "qua · 22/04". */
export function formatWeekdayDate(input: Date | string | null | undefined): string {
  const d = parseDate(input)
  if (!d) return ""
  // `qua.` ou `qua` conforme o locale — normalizamos pra tirar o ponto final.
  return WEEKDAY_DATE_FMT.format(d).replace(".", "")
}

// --------------------------------------------------------------------------
// Prazo relativo (vencido / venceu / vence em)
// --------------------------------------------------------------------------

export type DeadlineStatus = "vencido" | "hoje" | "urgente" | "proximo" | "ok"

export interface RelativeDeadline {
  /** Texto curto, pt-BR, pronto pra exibir. Ex: "vencido há 2 dias", "vence hoje", "vence em 5 dias". */
  label: string
  /** Numero absoluto de dias ate o vencimento. Negativo = vencido. */
  daysDelta: number
  /** Classificacao pra decidir cor/severidade no componente. */
  status: DeadlineStatus
}

function diffInDays(target: Date, reference: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000
  const a = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((b.getTime() - a.getTime()) / msPerDay)
}

/** Dada uma data de vencimento, devolve texto e status pra renderizar. */
export function describeDeadline(
  input: Date | string | null | undefined,
  now: Date = new Date()
): RelativeDeadline {
  const target = parseDate(input)
  if (!target) {
    return { label: "", daysDelta: 0, status: "ok" }
  }
  const delta = diffInDays(target, now)

  if (delta < 0) {
    const abs = Math.abs(delta)
    return {
      label: abs === 1 ? "vencido há 1 dia" : `vencido há ${abs} dias`,
      daysDelta: delta,
      status: "vencido",
    }
  }
  if (delta === 0) {
    return { label: "vence hoje", daysDelta: 0, status: "hoje" }
  }
  if (delta === 1) {
    return { label: "vence amanhã", daysDelta: 1, status: "urgente" }
  }
  if (delta <= 3) {
    return { label: `vence em ${delta} dias`, daysDelta: delta, status: "urgente" }
  }
  if (delta <= 7) {
    return { label: `vence em ${delta} dias`, daysDelta: delta, status: "proximo" }
  }
  return { label: `vence em ${delta} dias`, daysDelta: delta, status: "ok" }
}

// --------------------------------------------------------------------------
// Textuais
// --------------------------------------------------------------------------

/** Pega as iniciais de um nome (ate 2 chars). "Maria Silva" -> "MS". */
export function initialsFrom(name: string | null | undefined): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Trunca com elipse suave. "Lorem ipsum..." */
export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return ""
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + "…"
}
