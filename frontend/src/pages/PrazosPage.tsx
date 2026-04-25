import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  TimerReset,
} from "lucide-react"
import { concluirPrazo, fetchPrazos, queryKeys } from "@/api/granola"
import type { Prazo } from "@/types/domain"
import { formatCNJ, formatDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PrazoFormDialog } from "@/components/features/prazos/PrazoFormDialog"
import { DeadlinePill } from "@/components/shared/DeadlinePill"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
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

type FiltroStatus = "pendente" | "concluido" | "todos"
type PrioridadeKey = "urgente" | "alta" | "media" | "normal" | "baixa"
type FiltroPrioridade = "todas" | PrioridadeKey

const PRIORIDADES: { key: FiltroPrioridade; label: string }[] = [
  { key: "todas", label: "Todas prioridades" },
  { key: "urgente", label: "Urgente" },
  { key: "alta", label: "Alta" },
  { key: "media", label: "Média" },
  { key: "normal", label: "Normal" },
  { key: "baixa", label: "Baixa" },
]

export function PrazosPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [busca, setBusca] = useState("")
  const [statusFilter, setStatusFilter] = useState<FiltroStatus>("pendente")
  const [prioridadeFilter, setPrioridadeFilter] =
    useState<FiltroPrioridade>("todas")
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [editingPrazo, setEditingPrazo] = useState<Prazo | null>(null)
  const [concluirTarget, setConcluirTarget] = useState<Prazo | null>(null)

  const params = useMemo(
    () => ({
      status: statusFilter === "todos" ? ("all" as const) : statusFilter,
      prioridade:
        prioridadeFilter === "todas"
          ? undefined
          : (prioridadeFilter as PrioridadeKey),
    }),
    [statusFilter, prioridadeFilter]
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.prazos(params),
    queryFn: () => fetchPrazos(params),
  })

  const todos = useMemo(() => data?.prazos ?? [], [data])
  const filtrados = useMemo(() => {
    const buscaTrim = busca.trim().toLowerCase()
    if (!buscaTrim) return todos
    return todos.filter((p) => {
      return (
        p.titulo.toLowerCase().includes(buscaTrim) ||
        (p.cliente_nome ?? "").toLowerCase().includes(buscaTrim) ||
        (p.numero_cnj ?? "").includes(buscaTrim) ||
        (p.processo_titulo ?? "").toLowerCase().includes(buscaTrim) ||
        (p.tipo ?? "").toLowerCase().includes(buscaTrim)
      )
    })
  }, [todos, busca])

  const concluirMutation = useMutation({
    mutationFn: async (prazo: Prazo) => concluirPrazo(prazo.id),
    onSuccess: (_data, prazo) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "prazos"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      if (prazo.processo_id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.processo(prazo.processo_id),
        })
      }
      setConcluirTarget(null)
    },
  })

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      {/* HEADER */}
      <header className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Prazos
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading ? "carregando…" : summaryLabel(filtrados.length, statusFilter)}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            size="default"
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
            onClick={() => setShowNewDialog(true)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Novo prazo
          </Button>
        </div>
      </header>

      {/* LISTA */}
      <Card className="gap-0 overflow-hidden rounded-card py-0">
        <CardHeader className="flex items-center gap-3 border-b border-border px-5 py-3">
          <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
            Todos os prazos
          </CardTitle>
          <CardAction className="min-w-0 w-full max-w-[320px] md:w-[280px]">
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
                placeholder="Buscar por titulo, processo, cliente…"
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
          <FilterChip
            active={statusFilter === "pendente"}
            onClick={() => setStatusFilter("pendente")}
          >
            Pendentes
          </FilterChip>
          <FilterChip
            active={statusFilter === "concluido"}
            onClick={() => setStatusFilter("concluido")}
          >
            Concluídos
          </FilterChip>
          <FilterChip
            active={statusFilter === "todos"}
            onClick={() => setStatusFilter("todos")}
          >
            Todos
          </FilterChip>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Prioridade
          </span>
          {PRIORIDADES.map((p) => (
            <FilterChip
              key={p.key}
              active={prioridadeFilter === p.key}
              onClick={() => setPrioridadeFilter(p.key)}
            >
              {p.label}
            </FilterChip>
          ))}
        </div>

        {/* Body */}
        {isLoading ? (
          <PrazosLoading />
        ) : isError ? (
          <div className="px-5 py-6 text-sm text-erro">
            Não foi possível carregar os prazos.
          </div>
        ) : filtrados.length === 0 ? (
          <EmptyState busca={busca} status={statusFilter} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <Th>Prazo</Th>
                <Th>Processo / Cliente</Th>
                <Th>Tipo · Prioridade</Th>
                <Th>Vencimento</Th>
                <Th>Estado</Th>
                <TableHead className="py-2.5 pl-3 pr-5 w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((p) => (
                <PrazoRow
                  key={p.id}
                  prazo={p}
                  onOpenProcesso={() => {
                    if (p.processo_id) navigate(`/processos/${p.processo_id}`)
                  }}
                  onEdit={() => setEditingPrazo(p)}
                  onConcluir={() => setConcluirTarget(p)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Dialogs */}
      <PrazoFormDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
      />
      <PrazoFormDialog
        open={editingPrazo !== null}
        onOpenChange={(o) => !o && setEditingPrazo(null)}
        prazo={editingPrazo}
      />

      {/* AlertDialog concluir */}
      <AlertDialog
        open={concluirTarget !== null}
        onOpenChange={(o) => !o && setConcluirTarget(null)}
      >
        <AlertDialogContent>
          {concluirTarget && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  Concluir este prazo?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <strong>{concluirTarget.titulo}</strong> sai da lista de
                  pendentes e a data de conclusão é registrada agora. O registro
                  permanece pra histórico — pode ser reaberto depois editando.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {concluirMutation.isError && (
                <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                  {concluirMutation.error instanceof Error
                    ? concluirMutation.error.message
                    : "Não foi possível concluir."}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={concluirMutation.isPending}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    concluirMutation.mutate(concluirTarget)
                  }}
                  disabled={concluirMutation.isPending}
                  className="bg-dourado text-tinta hover:bg-dourado-claro"
                >
                  {concluirMutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Concluir prazo
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// --------------------------------------------------------------------------

function PrazoRow({
  prazo,
  onOpenProcesso,
  onEdit,
  onConcluir,
}: {
  prazo: Prazo
  onOpenProcesso: () => void
  onEdit: () => void
  onConcluir: () => void
}) {
  const concluido = prazo.status === "concluido"
  const linkable = Boolean(prazo.processo_id)
  return (
    <TableRow
      onClick={linkable ? onOpenProcesso : undefined}
      className={cn(
        "border-border",
        linkable && "cursor-pointer hover:bg-dourado/5",
        concluido && "opacity-60"
      )}
    >
      <TableCell className="py-3 pl-5 pr-3">
        <div className="font-medium text-foreground">
          {truncate(prazo.titulo, 50)}
        </div>
        {prazo.descricao && (
          <div className="mt-0.5 text-[0.72rem] text-muted">
            {truncate(prazo.descricao, 80)}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 px-3">
        {prazo.numero_cnj ? (
          <div className="tabular-nums font-mono text-[0.78rem] text-foreground">
            {formatCNJ(prazo.numero_cnj)}
          </div>
        ) : (
          <span className="text-[0.78rem] text-muted">sem processo</span>
        )}
        {prazo.cliente_nome && (
          <div className="mt-0.5 text-[0.72rem] text-muted">
            {truncate(prazo.cliente_nome, 32)}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 px-3">
        <div className="capitalize text-[0.8125rem] text-foreground">
          {prazo.tipo ?? "—"}
        </div>
        <div className="mt-0.5">
          <PrioridadeChip prioridade={prazo.prioridade} />
        </div>
      </TableCell>
      <TableCell className="tabular-nums py-3 px-3 font-mono text-[0.8125rem] text-foreground">
        {formatDate(prazo.data_vencimento)}
      </TableCell>
      <TableCell className="py-3 px-3">
        {concluido ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill bg-fumaca/12 px-2.5 py-1 text-[0.7rem] font-semibold text-fumaca">
            <span className="h-1.5 w-1.5 rounded-full bg-fumaca" aria-hidden />
            concluído
          </span>
        ) : (
          <DeadlinePill data={prazo.data_vencimento} />
        )}
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
            className="min-w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            {linkable && (
              <DropdownMenuItem onClick={onOpenProcesso}>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                Abrir processo
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              Editar
            </DropdownMenuItem>
            {!concluido && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onConcluir}>
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Concluir
                </DropdownMenuItem>
              </>
            )}
            {concluido && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onEdit}>
                  <TimerReset className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Reabrir (editar)
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

const PRIORIDADE_STYLE: Record<
  string,
  { bg: string; fg: string; dot: string; label: string }
> = {
  urgente: { bg: "bg-erro/12", fg: "text-erro", dot: "bg-erro", label: "Urgente" },
  alta: { bg: "bg-erro/8", fg: "text-erro", dot: "bg-erro", label: "Alta" },
  media: { bg: "bg-alerta/12", fg: "text-alerta", dot: "bg-alerta", label: "Média" },
  normal: { bg: "bg-sucesso/12", fg: "text-sucesso", dot: "bg-sucesso", label: "Normal" },
  baixa: { bg: "bg-fumaca/12", fg: "text-fumaca", dot: "bg-fumaca", label: "Baixa" },
}

function PrioridadeChip({ prioridade }: { prioridade: string }) {
  const style = PRIORIDADE_STYLE[prioridade] ?? PRIORIDADE_STYLE.normal
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2 py-0.5 text-[0.65rem] font-semibold",
        style.bg,
        style.fg
      )}
    >
      <span className={cn("h-1 w-1 rounded-full", style.dot)} aria-hidden />
      {style.label}
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
      {children}
    </TableHead>
  )
}

function PrazosLoading() {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2fr_1.5fr_1.2fr_0.8fr_1fr_0.2fr] gap-3"
        >
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-6 w-20 rounded-pill" />
          <Skeleton className="h-7 w-7 rounded-pill justify-self-end" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  busca,
  status,
}: {
  busca: string
  status: FiltroStatus
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-display italic text-lg text-muted">
        {busca
          ? "Nenhum prazo encontrado para essa busca."
          : status === "concluido"
            ? "Nenhum prazo concluído ainda."
            : status === "pendente"
              ? "Nenhum prazo pendente. Respire fundo."
              : "Nenhum prazo cadastrado."}
      </p>
      {!busca && status !== "concluido" && (
        <p className="mt-2 text-sm text-muted">
          Clique em <strong className="text-foreground">Novo prazo</strong> no topo pra começar.
        </p>
      )}
    </div>
  )
}

function summaryLabel(total: number, status: FiltroStatus): string {
  if (total === 0) return "nenhum registro aqui"
  const noun = status === "concluido" ? "concluído" : "prazo"
  return `${total} ${total === 1 ? noun : noun + "s"}`
}
