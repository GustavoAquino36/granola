import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  UserPlus,
} from "lucide-react"
import {
  archiveCliente,
  fetchClientes,
  queryKeys,
  unarchiveCliente,
} from "@/api/granola"
import type { Cliente } from "@/types/domain"
import { formatCpfCnpj, formatDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ClienteFormDialog } from "@/components/features/clientes/ClienteFormDialog"
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

type FiltroTipo = "todos" | "PF" | "PJ"
type FiltroAtivo = "ativos" | "inativos"

export function ClientesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [busca, setBusca] = useState("")
  const [tipo, setTipo] = useState<FiltroTipo>("todos")
  const [ativo, setAtivo] = useState<FiltroAtivo>("ativos")
  const [showNewDialog, setShowNewDialog] = useState(false)
  /** Quando set, abre ClienteFormDialog em modo edit com esse cliente. */
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  /** Quando set, abre AlertDialog pra arquivar/reativar esse cliente. */
  const [archiveTarget, setArchiveTarget] = useState<Cliente | null>(null)

  const params = useMemo(
    () => ({
      busca: busca.trim() || undefined,
      tipo: tipo === "todos" ? undefined : tipo,
      ativo: ativo === "ativos" ? (1 as const) : (0 as const),
      limite: 200,
    }),
    [busca, tipo, ativo]
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.clientes(params),
    queryFn: () => fetchClientes(params),
  })

  const clientes = data?.clientes ?? []

  const archiveMutation = useMutation({
    mutationFn: async (target: Cliente) => {
      return target.ativo === 1
        ? archiveCliente(target.id)
        : unarchiveCliente(target.id)
    },
    onSuccess: (_data, target) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "clientes"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.cliente(target.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      setArchiveTarget(null)
    },
  })

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      {/* ================= HEADER ================= */}
      <header className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Clientes
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading
              ? "carregando…"
              : summaryLabel(clientes.length, ativo)}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="default"
            className="gap-1.5 rounded-card text-muted hover:text-foreground"
            title="Exportar CSV"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">Exportar</span>
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
            <span className="hidden sm:inline">Adicionar cliente</span>
            <span className="sm:hidden">Novo</span>
          </Button>
        </div>
      </header>

      {/* ================= LISTA ================= */}
      <Card className="gap-0 overflow-hidden rounded-card py-0">
        <CardHeader className="flex items-center gap-3 border-b border-border px-5 py-3">
          <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
            Todos os clientes
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
                placeholder="Buscar cliente…"
                className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
          </CardAction>
        </CardHeader>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-alt px-5 py-2.5">
          <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Filtros
          </span>
          <FilterChip
            active={ativo === "ativos"}
            onClick={() => setAtivo("ativos")}
          >
            Ativos
          </FilterChip>
          <FilterChip
            active={ativo === "inativos"}
            onClick={() => setAtivo("inativos")}
          >
            Arquivados
          </FilterChip>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <FilterChip active={tipo === "todos"} onClick={() => setTipo("todos")}>
            Todos
          </FilterChip>
          <FilterChip active={tipo === "PF"} onClick={() => setTipo("PF")}>
            PF
          </FilterChip>
          <FilterChip active={tipo === "PJ"} onClick={() => setTipo("PJ")}>
            PJ
          </FilterChip>
        </div>

        {/* Body */}
        {isLoading ? (
          <ClientesLoading />
        ) : isError ? (
          <div className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 mx-5 my-4 text-sm text-erro">
            Não foi possível carregar clientes.
          </div>
        ) : clientes.length === 0 ? (
          <EmptyState busca={busca} ativo={ativo} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="py-2.5 pl-5 pr-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                  Cliente
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                  Documento
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                  Contato
                </TableHead>
                <TableHead className="py-2.5 px-3 text-right text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                  Processos
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
                  Atualizado
                </TableHead>
                <TableHead className="py-2.5 pl-3 pr-5 w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((c) => (
                <ClienteRow
                  key={c.id}
                  cliente={c}
                  onOpen={() => navigate(`/clientes/${c.id}`)}
                  onEdit={() => setEditingCliente(c)}
                  onToggleArchive={() => setArchiveTarget(c)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Dialog de criar cliente (novo) */}
      <ClienteFormDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSaved={(id) => navigate(`/clientes/${id}`)}
      />

      {/* Dialog de editar cliente (via acao da lista) */}
      <ClienteFormDialog
        open={editingCliente !== null}
        onOpenChange={(open) => !open && setEditingCliente(null)}
        cliente={editingCliente}
      />

      {/* AlertDialog de arquivar/reativar (via acao da lista) */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          {archiveTarget && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  {archiveTarget.ativo === 1
                    ? "Arquivar este cliente?"
                    : "Reativar este cliente?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {archiveTarget.ativo === 1 ? (
                    <>
                      <strong>{archiveTarget.nome}</strong> sai da lista de
                      ativos, mas <strong>não é apagado</strong>. Processos e
                      historico permanecem intactos.
                    </>
                  ) : (
                    <>
                      <strong>{archiveTarget.nome}</strong> volta pra lista de
                      ativos e pode receber novos lancamentos.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {archiveMutation.isError && (
                <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                  {archiveMutation.error instanceof Error
                    ? archiveMutation.error.message
                    : "Não foi possível concluir."}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={archiveMutation.isPending}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    archiveMutation.mutate(archiveTarget)
                  }}
                  disabled={archiveMutation.isPending}
                  className={cn(
                    archiveTarget.ativo === 1
                      ? "bg-erro text-marfim hover:bg-erro/90"
                      : "bg-dourado text-tinta hover:bg-dourado-claro"
                  )}
                >
                  {archiveMutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {archiveTarget.ativo === 1 ? "Arquivar" : "Reativar"}
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

function ClienteRow({
  cliente,
  onOpen,
  onEdit,
  onToggleArchive,
}: {
  cliente: Cliente
  onOpen: () => void
  onEdit: () => void
  onToggleArchive: () => void
}) {
  return (
    <TableRow
      onClick={onOpen}
      className="cursor-pointer border-border hover:bg-dourado/5"
    >
      <TableCell className="py-3 pl-5 pr-3">
        <div className="font-medium text-foreground">
          {truncate(cliente.nome, 40)}
        </div>
        {cliente.email && (
          <div className="mt-0.5 text-[0.72rem] text-muted">
            {cliente.email}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 px-3">
        <div className="tabular-nums font-mono text-[0.8125rem] text-foreground">
          {formatCpfCnpj(cliente.cpf_cnpj) || "—"}
        </div>
        <div className="mt-0.5 text-[0.7rem] uppercase tracking-wider text-muted">
          {cliente.tipo}
        </div>
      </TableCell>
      <TableCell className="py-3 px-3 text-[0.8125rem] text-foreground">
        {cliente.telefone ? (
          <span className="tabular-nums font-mono text-[0.8125rem]">
            {cliente.telefone}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
        {cliente.endereco_cidade && (
          <div className="mt-0.5 text-[0.72rem] text-muted">
            {cliente.endereco_cidade}
            {cliente.endereco_uf ? ` · ${cliente.endereco_uf}` : ""}
          </div>
        )}
      </TableCell>
      <TableCell className="tabular-nums py-3 px-3 text-right font-mono text-[0.875rem] text-foreground">
        {cliente.total_processos ?? 0}
      </TableCell>
      <TableCell className="py-3 px-3">
        <span className="tabular-nums font-mono text-[0.75rem] text-muted">
          {formatDate(cliente.atualizado_em ?? cliente.criado_em)}
        </span>
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
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant={cliente.ativo === 1 ? "destructive" : "default"}
              onClick={onToggleArchive}
            >
              {cliente.ativo === 1 ? (
                <>
                  <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Arquivar
                </>
              ) : (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Reativar
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
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

function ClientesLoading() {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2fr_1.2fr_1.2fr_0.5fr_0.8fr_0.2fr] gap-3"
        >
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-8 justify-self-end" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-7 w-7 rounded-pill justify-self-end" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ busca, ativo }: { busca: string; ativo: FiltroAtivo }) {
  return (
    <div className="px-5 py-12 text-center">
      <UserPlus
        className="mx-auto mb-4 h-8 w-8 text-muted/60"
        strokeWidth={1.5}
      />
      <p className="font-display italic text-lg text-muted">
        {busca
          ? "Nenhum cliente encontrado para essa busca."
          : ativo === "inativos"
            ? "Nenhum cliente arquivado."
            : "Nenhum cliente cadastrado ainda."}
      </p>
      {!busca && ativo === "ativos" && (
        <p className="mt-2 text-sm text-muted">
          Clique em <strong className="text-foreground">Adicionar cliente</strong> no topo pra começar.
        </p>
      )}
    </div>
  )
}

function summaryLabel(total: number, ativo: FiltroAtivo): string {
  if (total === 0) return "nenhum registro aqui"
  const base = ativo === "ativos" ? "ativo" : "arquivado"
  return `${total} ${total === 1 ? base : base + "s"}`
}
