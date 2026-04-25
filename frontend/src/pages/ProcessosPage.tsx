import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  Download,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react"
import { fetchProcessos, queryKeys } from "@/api/granola"
import type { Processo } from "@/types/domain"
import { formatBRL, formatCNJ, formatDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ProcessoFormDialog } from "@/components/features/processos/ProcessoFormDialog"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type FiltroStatus = "todos" | "ativo" | "suspenso" | "encerrado" | "arquivado"

const STATUS_FILTROS: { key: FiltroStatus; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "ativo", label: "Em andamento" },
  { key: "suspenso", label: "Suspenso" },
  { key: "encerrado", label: "Encerrado" },
  { key: "arquivado", label: "Arquivado" },
]

export function ProcessosPage() {
  const navigate = useNavigate()
  const [busca, setBusca] = useState("")
  const [status, setStatus] = useState<FiltroStatus>("todos")
  const [area, setArea] = useState<string | undefined>(undefined)
  const [showNewDialog, setShowNewDialog] = useState(false)

  const params = useMemo(
    () => ({
      busca: busca.trim() || undefined,
      status: status === "todos" ? undefined : status,
      area,
      limite: 500,
    }),
    [busca, status, area]
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.processos(params),
    queryFn: () => fetchProcessos(params),
  })

  // Lista de areas: query separada SEM filtros, pra que os chips fiquem
  // estaveis quando o usuario aplica status/area (bug 2026-04-25 — antes,
  // areasDisponiveis vinha do `data` filtrado e colapsava ao aplicar qualquer filtro).
  const optionsParams = useMemo(() => ({ limite: 500 }), [])
  const { data: optionsData } = useQuery({
    queryKey: queryKeys.processos(optionsParams),
    queryFn: () => fetchProcessos(optionsParams),
    staleTime: 5 * 60 * 1000, // 5 min — areas mudam raramente
  })

  const areasDisponiveis = useMemo(() => {
    const set = new Set<string>()
    for (const p of optionsData?.processos ?? []) {
      if (p.area) set.add(p.area)
    }
    return Array.from(set).sort()
  }, [optionsData?.processos])

  const processos = data?.processos ?? []

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      {/* ================= HEADER ================= */}
      <header className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Processos
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading
              ? "carregando…"
              : `${processos.length} ${processos.length === 1 ? "processo" : "processos"} na visao atual`}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="default"
            className="gap-1.5 rounded-card"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            Exportar CSV
          </Button>
          <Button
            size="default"
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
            onClick={() => setShowNewDialog(true)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Adicionar processo
          </Button>
        </div>
      </header>

      {/* ================= LISTA ================= */}
      <Card className="gap-0 overflow-hidden rounded-card py-0">
        <CardHeader className="flex items-center gap-3 border-b border-border px-5 py-3">
          <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
            Lista geral
          </CardTitle>
          <CardAction className="min-w-0 w-full max-w-[320px] md:w-[300px]">
            <div
              className={cn(
                "flex items-center gap-2 rounded-pill border border-border bg-surface-alt px-3 py-1.5 text-muted transition-all",
                "focus-within:border-dourado focus-within:bg-surface"
              )}
            >
              <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="CNJ, título, cliente…"
                className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
          </CardAction>
        </CardHeader>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-alt px-5 py-2.5">
          <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Status
          </span>
          {STATUS_FILTROS.map((f) => (
            <FilterChip
              key={f.key}
              active={status === f.key}
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </FilterChip>
          ))}
          {areasDisponiveis.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
                Area
              </span>
              <FilterChip
                active={area === undefined}
                onClick={() => setArea(undefined)}
              >
                Todas
              </FilterChip>
              {areasDisponiveis.map((a) => (
                <FilterChip
                  key={a}
                  active={area === a}
                  onClick={() => setArea(area === a ? undefined : a)}
                >
                  <span className="capitalize">{a}</span>
                </FilterChip>
              ))}
            </>
          )}
        </div>

        {/* Body */}
        {isLoading ? (
          <ProcessosLoading />
        ) : isError ? (
          <div className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 mx-5 my-4 text-sm text-erro">
            Não foi possível carregar processos.
          </div>
        ) : processos.length === 0 ? (
          <EmptyState busca={busca} status={status} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <Th className="pl-5">Processo</Th>
                <Th>Cliente</Th>
                <Th>Vara · Tribunal</Th>
                <Th className="text-right">Valor da causa</Th>
                <Th>Última atualização</Th>
                <Th className="pl-3 pr-5 w-10"></Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processos.map((p) => (
                <ProcessoRow
                  key={p.id}
                  processo={p}
                  onOpen={() => navigate(`/processos/${p.id}`)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ProcessoFormDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSaved={(id) => navigate(`/processos/${id}`)}
      />
    </div>
  )
}

// --------------------------------------------------------------------------

function ProcessoRow({
  processo,
  onOpen,
}: {
  processo: Processo
  onOpen: () => void
}) {
  return (
    <TableRow
      onClick={onOpen}
      className="cursor-pointer border-border hover:bg-dourado/5"
    >
      <TableCell className="py-3 pl-5 pr-3">
        <div className="font-medium text-foreground">
          {truncate(processo.titulo || "Sem título", 42)}
        </div>
        {processo.numero_cnj && (
          <div className="tabular-nums mt-0.5 font-mono text-[0.72rem] text-muted">
            {formatCNJ(processo.numero_cnj)}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 px-3 text-[0.8125rem] text-foreground">
        {processo.cliente_nome ?? "—"}
        {processo.area && (
          <div className="mt-0.5 text-[0.7rem] uppercase tracking-wider text-muted">
            {processo.area}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 px-3 text-[0.8125rem] text-foreground">
        {processo.vara || "—"}
        {processo.tribunal && (
          <div className="mt-0.5 text-[0.7rem] uppercase tracking-wider text-muted">
            {processo.tribunal}
          </div>
        )}
      </TableCell>
      <TableCell className="tabular-nums py-3 px-3 text-right font-mono text-[0.8125rem] text-foreground">
        {processo.valor_causa > 0 ? formatBRL(processo.valor_causa) : "—"}
      </TableCell>
      <TableCell className="py-3 px-3">
        <span className="tabular-nums font-mono text-[0.75rem] text-muted">
          {formatDate(processo.atualizado_em ?? processo.criado_em)}
        </span>
        <div className="mt-0.5">
          <StatusTag status={processo.status} />
        </div>
      </TableCell>
      <TableCell className="py-3 pl-3 pr-5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Mais acoes"
              onClick={(e) => e.stopPropagation()}
              className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[180px]"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={onOpen}>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              Abrir detalhes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function Th({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <TableHead
      className={cn(
        "py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted",
        className
      )}
    >
      {children}
    </TableHead>
  )
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
    ativo: {
      bg: "bg-sucesso/12",
      fg: "text-sucesso",
      dot: "bg-sucesso",
      label: "Em andamento",
    },
    em_andamento: {
      bg: "bg-sucesso/12",
      fg: "text-sucesso",
      dot: "bg-sucesso",
      label: "Em andamento",
    },
    suspenso: {
      bg: "bg-alerta/12",
      fg: "text-alerta",
      dot: "bg-alerta",
      label: "Suspenso",
    },
    encerrado: {
      bg: "bg-dourado/16",
      fg: "text-[#9a7a40]",
      dot: "bg-dourado",
      label: "Encerrado",
    },
    arquivado: {
      bg: "bg-fumaca/12",
      fg: "text-fumaca",
      dot: "bg-fumaca",
      label: "Arquivado",
    },
  }
  const s = map[status] ?? {
    bg: "bg-fumaca/10",
    fg: "text-muted",
    dot: "bg-fumaca",
    label: status,
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2 py-[3px] text-[0.65rem] font-semibold",
        s.bg,
        s.fg
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-pill border px-3 py-1 text-[0.78rem] font-medium transition-colors duration-[180ms]",
        active
          ? "border-tinta bg-tinta text-marfim"
          : "border-border-strong bg-surface text-foreground hover:border-dourado"
      )}
    >
      {children}
    </button>
  )
}

function ProcessosLoading() {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_0.8fr_0.2fr] gap-3"
        >
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-20 justify-self-end" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-7 w-7 rounded-pill justify-self-end" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ busca, status }: { busca: string; status: FiltroStatus }) {
  return (
    <div className="px-5 py-12 text-center">
      <FolderOpen
        className="mx-auto mb-4 h-8 w-8 text-muted/60"
        strokeWidth={1.5}
      />
      <p className="font-display italic text-lg text-muted">
        {busca
          ? "Nenhum processo encontrado pra essa busca."
          : status !== "todos"
            ? `Nenhum processo no status "${status}".`
            : "Nenhum processo cadastrado ainda."}
      </p>
      {!busca && status === "todos" && (
        <p className="mt-2 text-sm text-muted">
          Clique em <strong className="text-foreground">Adicionar processo</strong> pra comecar.
        </p>
      )}
    </div>
  )
}
