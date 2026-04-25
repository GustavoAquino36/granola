import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, type LucideIcon } from "lucide-react"
import { fetchStats, queryKeys } from "@/api/granola"
import { formatBRLCompact } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

interface KpiSpec {
  label: string
  value: string | number
  /** Texto secundario (ex: "3 vencidos", "sem variacao"). */
  hint?: string
  /** Primeiro card tem accent dourado no topo (filete 2px). */
  accent?: boolean
  /** Destaca o hint em vermelho (ex: prazos vencidos). */
  hintTone?: "default" | "danger" | "success"
  Icon?: LucideIcon
}

export function KpiGrid() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.stats,
    queryFn: fetchStats,
  })

  if (isLoading) {
    return (
      <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface p-[16px_18px]">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-16" />
            <Skeleton className="mt-3 h-3 w-20" />
          </div>
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mb-6 rounded-card border border-erro/20 bg-erro/5 px-4 py-3 text-sm text-erro">
        Não foi possível carregar os indicadores. Verifique se o backend esta ativo em <code className="font-mono">:3458</code>.
      </div>
    )
  }

  const kpis: KpiSpec[] = [
    {
      label: "Prazos esta semana",
      value: data.prazos_urgentes,
      hint:
        data.prazos_vencidos > 0
          ? `${data.prazos_vencidos} vencido${data.prazos_vencidos > 1 ? "s" : ""}`
          : "nenhum vencido",
      hintTone: data.prazos_vencidos > 0 ? "danger" : "default",
      accent: true,
    },
    {
      label: "Processos ativos",
      value: data.total_processos,
      hint: formatPorAreaHint(data.por_area),
    },
    {
      label: "Clientes",
      value: data.total_clientes,
      hint: `${countPorTipo(data.por_status)} processos totais`,
    },
    {
      label: "A receber · pendente",
      value: formatBRLCompact(data.financeiro.rec_pendentes),
      hint:
        data.financeiro.cust_pendentes > 0
          ? `${formatBRLCompact(data.financeiro.cust_pendentes)} em custas`
          : "sem custas pendentes",
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} {...kpi} />
      ))}
    </div>
  )
}

// --------------------------------------------------------------------------

function KpiCard({ label, value, hint, accent, hintTone = "default" }: KpiSpec) {
  return (
    <div
      className={cn(
        "relative bg-surface px-[18px] py-4",
        accent && "before:absolute before:left-0 before:right-0 before:top-0 before:h-[2px] before:bg-dourado"
      )}
    >
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted">
        {label}
      </div>
      <div className="tabular-nums mt-1.5 font-mono text-[1.75rem] font-medium leading-none text-foreground">
        {value}
      </div>
      {hint && (
        <div
          className={cn(
            "mt-2 flex items-center gap-1 text-xs",
            hintTone === "danger" && "text-erro",
            hintTone === "success" && "text-sucesso",
            hintTone === "default" && "text-muted"
          )}
        >
          {hintTone === "success" && <ArrowUpRight className="h-3 w-3" />}
          {hint}
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// helpers de hint — transformam os breakdowns em strings curtas
// --------------------------------------------------------------------------

function formatPorAreaHint(porArea: Record<string, number>): string {
  const entries = Object.entries(porArea).sort(([, a], [, b]) => b - a)
  if (entries.length === 0) return "sem processos ativos"
  const [top] = entries
  return `${top[1]} em ${top[0]}`
}

function countPorTipo(porStatus: Record<string, number>): number {
  return Object.values(porStatus).reduce((sum, n) => sum + n, 0)
}
