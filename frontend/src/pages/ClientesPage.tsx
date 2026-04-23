import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Download, MoreHorizontal, Plus, Search, UserPlus } from "lucide-react"
import { fetchClientes, queryKeys } from "@/api/granola"
import type { Cliente } from "@/types/domain"
import { formatCpfCnpj, formatDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
  const [busca, setBusca] = useState("")
  const [tipo, setTipo] = useState<FiltroTipo>("todos")
  const [ativo, setAtivo] = useState<FiltroAtivo>("ativos")

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

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
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
          <Button variant="outline" size="default" className="gap-1.5 rounded-card">
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            Exportar CSV
          </Button>
          <Button
            size="default"
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
            onClick={() => {
              // TODO: abrir Dialog de criar cliente (entra no commit 2B.4)
              window.alert("Form de criar cliente chega na proxima etapa (2B.4).")
            }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Adicionar cliente
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
          <div className="px-5 py-6 text-sm text-erro">
            Nao foi possivel carregar clientes.
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
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

// --------------------------------------------------------------------------

function ClienteRow({
  cliente,
  onOpen,
}: {
  cliente: Cliente
  onOpen: () => void
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
        <button
          type="button"
          aria-label="Mais acoes"
          onClick={(e) => {
            e.stopPropagation()
            // TODO: dropdown com "Ver detalhes" / "Editar" / "Arquivar" (2B.5)
          }}
          className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
        </button>
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
