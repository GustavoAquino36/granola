import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Shield,
  type LucideIcon,
} from "lucide-react"
import { fetchStats, queryKeys } from "@/api/granola"
import { describeDeadline, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type Variant = "urgent" | "warn" | "ok" | "info"

interface AlertItem {
  variant: Variant
  title: string
  desc?: string
  Icon: LucideIcon
}

export function AlertasCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.stats,
    queryFn: fetchStats,
    // Mesmo queryKey do KpiGrid => reusa cache, zero request extra.
  })

  const alertas = useMemo<AlertItem[]>(() => {
    if (!data) return []
    return deriveAlertas(data)
  }, [data])

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
          Alertas
        </CardTitle>
        <CardAction>
          <span className="font-sans text-[0.72rem] text-muted">
            {isLoading || isError
              ? ""
              : `${alertas.length} ativo${alertas.length === 1 ? "" : "s"}`}
          </span>
        </CardAction>
      </CardHeader>

      <div className="flex flex-col gap-2.5 p-4">
        {isLoading ? (
          <>
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-14 w-full rounded-card" />
          </>
        ) : isError ? (
          <div className="px-1 py-2 text-sm text-erro">
            Nao foi possivel carregar alertas.
          </div>
        ) : alertas.length === 0 ? (
          <p className="font-display italic text-muted text-base py-3 px-1">
            Tudo em dia. Nada exige atencao agora.
          </p>
        ) : (
          alertas.map((a, i) => <AlertRow key={i} item={a} />)
        )}
      </div>
    </Card>
  )
}

// --------------------------------------------------------------------------

function AlertRow({ item }: { item: AlertItem }) {
  const style = VARIANT_STYLES[item.variant]
  const { Icon } = item
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-card border px-3 py-2.5 text-sm",
        style.bg,
        style.border
      )}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", style.icon)}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <div className="font-sans text-[0.875rem] font-semibold text-foreground">
          {item.title}
        </div>
        {item.desc && (
          <div className="mt-0.5 text-[0.8125rem] text-muted">{item.desc}</div>
        )}
      </div>
    </div>
  )
}

const VARIANT_STYLES: Record<
  Variant,
  { bg: string; border: string; icon: string }
> = {
  urgent: {
    bg: "bg-erro/6",
    border: "border-erro/25",
    icon: "text-erro",
  },
  warn: {
    bg: "bg-alerta/6",
    border: "border-alerta/25",
    icon: "text-alerta",
  },
  ok: {
    bg: "bg-sucesso/6",
    border: "border-sucesso/25",
    icon: "text-sucesso",
  },
  info: {
    bg: "bg-surface-alt",
    border: "border-border",
    icon: "text-dourado",
  },
}

// --------------------------------------------------------------------------
// Regras de derivacao — tudo dinamico a partir de /api/granola/stats
// --------------------------------------------------------------------------

function deriveAlertas(stats: {
  prazos_vencidos: number
  prazos_urgentes: number
  prazos_proximos: { data_vencimento: string; titulo?: string }[]
}): AlertItem[] {
  const out: AlertItem[] = []

  // 1. Vencidos
  if (stats.prazos_vencidos > 0) {
    out.push({
      variant: "urgent",
      Icon: AlertTriangle,
      title:
        stats.prazos_vencidos === 1
          ? "1 prazo vencido pendente"
          : `${stats.prazos_vencidos} prazos vencidos pendentes`,
      desc: "Regularize ou marque como concluído.",
    })
  }

  // 2. Prazo fatal em <24h (deriva de prazos_proximos)
  const emUmDia = stats.prazos_proximos
    .map((p) => ({
      titulo: p.titulo ?? "",
      d: describeDeadline(p.data_vencimento),
    }))
    .filter((x) => x.d.status === "hoje" || x.d.daysDelta === 1)

  if (emUmDia.length > 0) {
    out.push({
      variant: "urgent",
      Icon: AlertTriangle,
      title:
        emUmDia.length === 1
          ? "Prazo fatal em menos de 24 horas"
          : `${emUmDia.length} prazos fatais em menos de 24 horas`,
      desc: truncate(emUmDia[0].titulo, 80) || undefined,
    })
  }

  // 3. Semana apertada (>= 5 prazos proximos 7d)
  if (stats.prazos_urgentes >= 5 && emUmDia.length === 0) {
    out.push({
      variant: "warn",
      Icon: AlertTriangle,
      title: `${stats.prazos_urgentes} prazos esta semana`,
      desc: "Revise a priorizacao — volume acima da media.",
    })
  }

  // 4. Info da licenca (fato estatico, reforca o posicionamento do produto)
  out.push({
    variant: "info",
    Icon: Shield,
    title: "Licença vitalícia ativa",
    desc: "Pagamento único · sem renovação · dados 100% locais.",
  })

  // 5. Ok de saude geral quando nada urgente
  if (out.length === 1 && stats.prazos_vencidos === 0) {
    out.unshift({
      variant: "ok",
      Icon: CheckCircle2,
      title: "Tudo em dia",
      desc: "Nenhum prazo fatal nos proximos 7 dias.",
    })
  }

  // Garante ao menos 1 info pra nunca ficar vazio com alertas urgentes apenas
  if (!out.some((a) => a.variant === "info" || a.variant === "ok")) {
    out.push({
      variant: "info",
      Icon: Info,
      title: "Base local sincronizada",
      desc: "Dados salvos em granola.db · WAL ativo.",
    })
  }

  return out
}
