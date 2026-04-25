import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Filter, MoreHorizontal } from "lucide-react"
import { fetchPrazos, queryKeys } from "@/api/granola"
import type { Prazo } from "@/types/domain"
import { formatCNJ, formatShortDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DeadlinePill } from "@/components/shared/DeadlinePill"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Filtro = "todos" | "urgente" | "semana" | "vencidos"

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "urgente", label: "Urgente (≤ 3d)" },
  { key: "semana", label: "Esta semana" },
  { key: "vencidos", label: "Vencidos" },
]

export function ProximosPrazosCard() {
  const [filtro, setFiltro] = useState<Filtro>("todos")

  // Busca prazos dos proximos ~30 dias + vencidos (dias=30 cobre futuros;
  // o backend nao retorna vencidos por default, entao buscamos tudo que
  // vence <= 30d e filtramos vencidos em memoria via data_vencimento < hoje).
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.prazos({ dias: 30, status: "pendente" }),
    queryFn: () => fetchPrazos({ dias: 30, status: "pendente" }),
  })

  // Busca vencidos separadamente (sem dias, so status=pendente — pega tudo pendente,
  // inclui vencidos; filtramos pelos que estao antes de hoje).
  const { data: todosPendentes } = useQuery({
    queryKey: queryKeys.prazos({ status: "pendente" }),
    queryFn: () => fetchPrazos({ status: "pendente" }),
  })

  const today = useMemo(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }, [])

  const prazos = useMemo(() => {
    const base = (todosPendentes?.prazos ?? data?.prazos ?? []).slice()
    // Unifica: se ambas fontes retornaram, priorizamos a completa (todosPendentes).
    // Ordenamos por data_vencimento asc (vencidos primeiro, em ordem).
    base.sort((a, b) =>
      (a.data_vencimento || "").localeCompare(b.data_vencimento || "")
    )
    return aplicarFiltro(base, filtro, today)
  }, [todosPendentes, data, filtro, today])

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
          Próximos prazos
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <IconButton label="Filtrar">
            <Filter className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Mais acoes">
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        </CardAction>
      </CardHeader>

      {/* Filter bar (chips) */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-alt px-5 py-2.5">
        <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
          Filtros
        </span>
        {FILTROS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFiltro(f.key)}
            className={cn(
              "rounded-pill border px-3 py-1 text-[0.78rem] font-medium transition-colors duration-[180ms]",
              filtro === f.key
                ? "border-tinta bg-tinta text-marfim"
                : "border-border-strong bg-surface text-foreground hover:border-dourado"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {isLoading ? (
        <PrazosLoading />
      ) : isError ? (
        <div className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 mx-5 my-3 text-sm text-erro">
          Não foi possível carregar os prazos.
        </div>
      ) : prazos.length === 0 ? (
        <EmptyState filtro={filtro} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="py-2.5 pl-5 pr-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                Processo
              </TableHead>
              <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                Cliente
              </TableHead>
              <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                Tipo
              </TableHead>
              <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                Vencimento
              </TableHead>
              <TableHead className="py-2.5 pl-3 pr-5 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prazos.slice(0, 8).map((p) => (
              <PrazoRow key={p.id} prazo={p} />
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

// --------------------------------------------------------------------------

function PrazoRow({ prazo }: { prazo: Prazo }) {
  return (
    <TableRow
      className="cursor-pointer border-border hover:bg-dourado/5"
      onClick={() => {
        /* TODO: navegar pra /processos/:id quando a pagina existir */
      }}
    >
      <TableCell className="py-3 pl-5 pr-3">
        <div className="font-medium text-foreground">
          {truncate(prazo.titulo, 38)}
        </div>
        {prazo.numero_cnj && (
          <div className="tabular-nums mt-0.5 font-mono text-[0.72rem] text-muted">
            {formatCNJ(prazo.numero_cnj)}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 px-3 text-foreground">
        {prazo.cliente_nome ?? "—"}
      </TableCell>
      <TableCell className="py-3 px-3 capitalize text-foreground">
        {prazo.tipo ?? "—"}
      </TableCell>
      <TableCell className="tabular-nums py-3 px-3 font-mono text-[0.8125rem] text-foreground">
        {formatShortDate(prazo.data_vencimento)}
      </TableCell>
      <TableCell className="py-3 pl-3 pr-5">
        <DeadlinePill data={prazo.data_vencimento} />
      </TableCell>
    </TableRow>
  )
}

function IconButton({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
    >
      {children}
    </button>
  )
}

function PrazosLoading() {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[2fr_1fr_1fr_0.8fr_1fr] gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-6 w-24 rounded-pill" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ filtro }: { filtro: Filtro }) {
  const mensagens: Record<Filtro, string> = {
    todos: "Nenhum prazo pendente. Respire fundo.",
    urgente: "Nenhum prazo urgente nos próximos 3 dias.",
    semana: "Semana limpa — nada vencendo ate domingo.",
    vencidos: "Nenhum prazo vencido. Mantenha o ritmo.",
  }
  return (
    <div className="px-5 py-8 text-center">
      <p className="font-display text-lg italic text-muted">
        {mensagens[filtro]}
      </p>
    </div>
  )
}

// --------------------------------------------------------------------------
// Logica de filtro em memoria (backend ja traz proximos 30d pendentes)
// --------------------------------------------------------------------------

function aplicarFiltro(prazos: Prazo[], filtro: Filtro, today: Date): Prazo[] {
  if (filtro === "todos") return prazos

  return prazos.filter((p) => {
    const target = new Date(p.data_vencimento)
    if (isNaN(target.getTime())) return false
    const delta = Math.round(
      (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    )

    switch (filtro) {
      case "urgente":
        return delta >= 0 && delta <= 3
      case "semana":
        return delta >= 0 && delta <= 7
      case "vencidos":
        return delta < 0
      default:
        return true
    }
  })
}
