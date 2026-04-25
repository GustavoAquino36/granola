import { useQuery } from "@tanstack/react-query"
import { MoreHorizontal } from "lucide-react"
import { fetchStats, queryKeys } from "@/api/granola"
import type { FonteMovimentacao, Movimentacao } from "@/types/domain"
import { formatCNJ, formatShortDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function AtividadeRecenteCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.stats,
    queryFn: fetchStats,
    // Mesmo queryKey do KpiGrid/AlertasCard => cache compartilhado.
  })

  const movs = data?.movimentacoes_recentes ?? []

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
          Atividade recente
        </CardTitle>
        <CardAction>
          <button
            type="button"
            aria-label="Mais acoes"
            className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </CardAction>
      </CardHeader>

      {isLoading ? (
        <LoadingTimeline />
      ) : isError ? (
        <div className="px-5 py-4 text-sm text-erro">
          Não foi possível carregar a atividade.
        </div>
      ) : movs.length === 0 ? (
        <p className="font-display italic text-muted text-base px-5 py-6 text-center">
          Sem movimentacoes recentes. Quando chegar a primeira publicacao,
          ela aparece aqui.
        </p>
      ) : (
        <ol className="flex flex-col">
          {movs.slice(0, 6).map((m) => (
            <TimelineItem key={m.id} mov={m} />
          ))}
        </ol>
      )}
    </Card>
  )
}

// --------------------------------------------------------------------------

function TimelineItem({ mov }: { mov: Movimentacao }) {
  const when = formatWhen(mov.data_sort ?? mov.data_movimento ?? mov.criado_em)
  const source = sourceLabel(mov.fonte)
  return (
    <li
      className={cn(
        "grid grid-cols-[96px_1fr] items-start gap-3 px-5 py-3",
        "border-b border-border last:border-b-0"
      )}
    >
      <div className="tabular-nums pt-0.5 font-mono text-[0.72rem] text-muted">
        {when}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 text-[0.875rem]">
          <span className="font-semibold text-foreground">{source}</span>
          <span className="text-muted">·</span>
          <span className="text-foreground">
            {mov.tipo ? truncate(mov.tipo, 32) : "movimentacao"}
          </span>
          {mov.numero_cnj && (
            <>
              <span className="text-muted">em</span>
              <span className="tabular-nums font-mono text-[0.78rem] text-muted">
                {formatCNJ(mov.numero_cnj)}
              </span>
            </>
          )}
        </div>
        {mov.descricao && (
          <div className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">
            {truncate(mov.descricao, 130)}
          </div>
        )}
      </div>
    </li>
  )
}

function LoadingTimeline() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[96px_1fr] gap-3">
          <Skeleton className="h-4 w-20" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  )
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Label humana pra a fonte da movimentacao. */
function sourceLabel(fonte: FonteMovimentacao): string {
  switch (fonte) {
    case "datajud_auto":
      return "DataJud"
    case "djen_auto":
      return "DJEN"
    case "esaj_auto":
      return "e-SAJ"
    case "pje_auto":
      return "PJe"
    case "manual":
      return "Você"
    default:
      return fonte
  }
}

/** "HH:mm" se foi hoje, "Ontem" se foi ontem, "dd/MM" se foi mais antigo. */
function formatWhen(raw: string | null | undefined): string {
  if (!raw) return ""
  // Aceita YYYY-MM-DD, DD/MM/YYYY, ou ISO completo (com hora).
  const parsed = parseAnyDate(raw)
  if (!parsed) return ""

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const thatDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  const deltaDays = Math.round(
    (today.getTime() - thatDay.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (deltaDays === 0) {
    // Se temos hora no original, mostra HH:mm; senao mostra "Hoje"
    return hasHour(raw)
      ? parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : "Hoje"
  }
  if (deltaDays === 1) return "Ontem"
  if (deltaDays < 7) return `${deltaDays}d atras`
  return formatShortDate(parsed)
}

function parseAnyDate(raw: string): Date | null {
  // DD/MM/YYYY
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/)
  if (br) {
    const [, d, m, y, hh, mm] = br
    return new Date(+y, +m - 1, +d, hh ? +hh : 0, mm ? +mm : 0)
  }
  // ISO / YYYY-MM-DD
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

function hasHour(raw: string): boolean {
  return /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(raw)
}
