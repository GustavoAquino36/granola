import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Plus, Search } from "lucide-react"
import { fetchFinanceiro, queryKeys } from "@/api/granola"
import type {
  CategoriaFinanceiro,
  Financeiro,
  TipoFinanceiro,
} from "@/types/domain"
import { formatBRL, formatDate, formatBRLCompact } from "@/lib/format"
import { cn } from "@/lib/utils"
import { FinanceiroFormDialog } from "@/components/features/financeiro/FinanceiroFormDialog"
import { QuadranteCard } from "@/components/features/financeiro/QuadranteCard"
import {
  mesesRestantes,
  type SortState,
} from "@/components/features/financeiro/financeiro-utils"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const TIPOS_RECEITA = new Set([
  "honorario",
  "receita",
  "reembolso",
  "receita_fixa",
  "receita_variavel",
])

const TIPOS_CUSTO = new Set([
  "custa_judicial",
  "custa_extrajudicial",
  "despesa",
  "custo_operacional",
  "custo_variavel",
])

export function FinanceiroPage() {
  // Carrega TODOS os lancamentos (limite alto). O backend ja ordena por
  // data_vencimento DESC. Filtramos client-side pra os 4 quadrantes + tabela geral.
  const params = useMemo(() => ({ limite: 9999 }), [])
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.financeiro(params),
    queryFn: () => fetchFinanceiro(params),
  })
  const lancamentos = useMemo(() => data?.lancamentos ?? [], [data])

  // Sort independente por quadrante
  const [sortRecFixa, setSortRecFixa] = useState<SortState>({ col: null, dir: "asc" })
  const [sortCustOp, setSortCustOp] = useState<SortState>({ col: null, dir: "asc" })
  const [sortRecVar, setSortRecVar] = useState<SortState>({ col: null, dir: "asc" })
  const [sortCustVar, setSortCustVar] = useState<SortState>({ col: null, dir: "asc" })

  // Selecao 12m (so receitas fixas) — modelagem por exclusao em vez de inclusao,
  // assim o default sao "todas marcadas" e o usuario apenas desmarca o que nao quer.
  // Evita useEffect+setState pra auto-selecao (que quebra o React Compiler).
  const [excluded12m, setExcluded12m] = useState<Set<number>>(new Set())

  // Form dialog state
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newDefaults, setNewDefaults] = useState<{
    tipo: TipoFinanceiro
    categoria: CategoriaFinanceiro
  } | null>(null)
  const [editingFin, setEditingFin] = useState<Financeiro | null>(null)

  // Tabela geral filtros
  const [busca, setBusca] = useState("")
  const [tipoFiltro, setTipoFiltro] = useState<string>("")
  const [statusFiltro, setStatusFiltro] = useState<string>("")
  const [periodoIni, setPeriodoIni] = useState<string>("")
  const [periodoFim, setPeriodoFim] = useState<string>("")

  // Quadrantes derivados
  const recebiveis = useMemo(
    () => lancamentos.filter((f) => f.categoria === "fixo"),
    [lancamentos]
  )
  const gastosOp = useMemo(
    () => lancamentos.filter((f) => f.categoria === "custo_escritorio"),
    [lancamentos]
  )
  const comissoes = useMemo(
    () => lancamentos.filter((f) => f.categoria === "futuro"),
    [lancamentos]
  )
  const custVar = useMemo(
    () => lancamentos.filter((f) => f.categoria === "custo_var"),
    [lancamentos]
  )

  // KPIs
  const totalRec = sumValor(recebiveis) + sumValor(comissoes)
  const totalCust = sumValor(gastosOp) + sumValor(custVar)
  const saldo = totalRec - totalCust
  const recPendentes = sumValorPendente(recebiveis)
  const custPendentes = sumValorPendente([...gastosOp, ...custVar])

  // Selecionados = todas as receitas fixas, exceto as excluidas pelo usuario.
  // Stale auto-limpa (excluded ainda contem ids que nao existem mais — basta
  // ignorar os que nao casarem com recebiveis atuais).
  const selected12m = useMemo(() => {
    const set = new Set<number>()
    for (const f of recebiveis) {
      if (f.fixo === 1 && !excluded12m.has(f.id)) set.add(f.id)
    }
    return set
  }, [recebiveis, excluded12m])

  function toggle12m(id: number) {
    setExcluded12m((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Calculo: contratos 12m
  const contratos12m = useMemo(() => {
    let total = 0
    for (const f of recebiveis) {
      if (f.fixo !== 1 || !selected12m.has(f.id)) continue
      const rest = mesesRestantes(f)
      // permanente => 12, senao min(rest, 12)
      const meses = rest !== null ? Math.min(rest, 12) : 12
      total += (f.valor || 0) * meses
    }
    return total
  }, [recebiveis, selected12m])

  // Tabela geral filtrada
  const tabelaGeral = useMemo(() => {
    const buscaTrim = busca.trim().toLowerCase()
    return lancamentos.filter((f) => {
      if (tipoFiltro && f.tipo !== tipoFiltro) return false
      if (statusFiltro && f.status !== statusFiltro) return false
      if (periodoIni && (f.data_vencimento ?? "") < periodoIni) return false
      if (periodoFim && (f.data_vencimento ?? "") > periodoFim) return false
      if (
        buscaTrim &&
        !(f.descricao || "").toLowerCase().includes(buscaTrim) &&
        !(f.cliente_nome || "").toLowerCase().includes(buscaTrim)
      )
        return false
      return true
    })
  }, [lancamentos, busca, tipoFiltro, statusFiltro, periodoIni, periodoFim])

  function openNew(defaults: {
    tipo: TipoFinanceiro
    categoria: CategoriaFinanceiro
  } | null) {
    setNewDefaults(defaults)
    setShowNewDialog(true)
  }

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      {/* HEADER */}
      <header className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Financeiro
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading
              ? "carregando…"
              : `${lancamentos.length} lançamento${lancamentos.length === 1 ? "" : "s"} no acervo`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="default"
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
            onClick={() => openNew(null)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Novo lançamento
          </Button>
        </div>
      </header>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Saldo" value={formatBRL(saldo)} tone={saldo >= 0 ? "rec" : "cust"} />
        <Kpi
          label="A receber"
          value={formatBRLCompact(recPendentes)}
          tone="rec"
          hint="Receitas com status pendente"
        />
        <Kpi
          label="A pagar"
          value={formatBRLCompact(custPendentes)}
          tone="cust"
          hint="Custos com status pendente"
        />
        <Kpi
          label="Contratos 12m"
          value={formatBRLCompact(contratos12m)}
          tone="info"
          hint="Soma das receitas fixas marcadas, considerando meses restantes (max 12)"
        />
      </div>

      {/* Pendencias do mes */}
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <PendenciasChip
          tone="rec"
          label="Rec. fixas pend."
          value={sumValorPendente(recebiveis)}
        />
        <PendenciasChip
          tone="cust"
          label="Custos fixos pend."
          value={sumValorPendente(gastosOp)}
        />
      </div>

      {/* 4 QUADRANTES */}
      {isLoading ? (
        <QuadrantesLoading />
      ) : isError ? (
        <div className="rounded-card border border-erro/30 bg-erro/5 px-4 py-3 text-sm text-erro">
          Não foi possível carregar o financeiro.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <QuadranteCard
            tom="rec-fixa"
            titulo="Receitas Fixas"
            itens={recebiveis}
            modoData="dia"
            mostrar12m
            selected12m={selected12m}
            onToggle12m={toggle12m}
            sort={sortRecFixa}
            onSortChange={setSortRecFixa}
            defaultTipo="receita_fixa"
            defaultCategoria="fixo"
            onAdd={openNew}
            onEdit={setEditingFin}
          />
          <QuadranteCard
            tom="cust-op"
            titulo="Custos Operacionais"
            itens={gastosOp}
            modoData="dia"
            sort={sortCustOp}
            onSortChange={setSortCustOp}
            defaultTipo="custo_operacional"
            defaultCategoria="custo_escritorio"
            onAdd={openNew}
            onEdit={setEditingFin}
          />
          <QuadranteCard
            tom="rec-var"
            titulo="Receitas Variáveis"
            itens={comissoes}
            modoData="data"
            sort={sortRecVar}
            onSortChange={setSortRecVar}
            defaultTipo="receita_variavel"
            defaultCategoria="futuro"
            onAdd={openNew}
            onEdit={setEditingFin}
          />
          <QuadranteCard
            tom="cust-var"
            titulo="Custos Variáveis"
            itens={custVar}
            modoData="dia"
            sort={sortCustVar}
            onSortChange={setSortCustVar}
            defaultTipo="custo_variavel"
            defaultCategoria="custo_var"
            onAdd={openNew}
            onEdit={setEditingFin}
          />
        </div>
      )}

      {/* TABELA GERAL */}
      <Card className="mt-6 gap-0 overflow-hidden rounded-card py-0">
        <CardHeader className="flex items-center gap-3 border-b border-border px-5 py-3">
          <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
            Todos os lançamentos
          </CardTitle>
          <CardAction className="min-w-0 w-full max-w-[300px] md:w-[260px]">
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
                placeholder="Buscar descrição, cliente…"
                className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
          </CardAction>
        </CardHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-alt px-5 py-2.5">
          <Select
            value={tipoFiltro || "__all__"}
            onValueChange={(v) => setTipoFiltro(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os tipos</SelectItem>
              <SelectItem value="receita_fixa">Receita fixa</SelectItem>
              <SelectItem value="receita_variavel">Receita variável</SelectItem>
              <SelectItem value="honorario">Honorário</SelectItem>
              <SelectItem value="reembolso">Reembolso</SelectItem>
              <SelectItem value="custo_operacional">Custo operacional</SelectItem>
              <SelectItem value="custo_variavel">Custo variável</SelectItem>
              <SelectItem value="custa_judicial">Custa judicial</SelectItem>
              <SelectItem value="custa_extrajudicial">Custa extrajudicial</SelectItem>
              <SelectItem value="despesa">Despesa</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFiltro || "__all__"}
            onValueChange={(v) => setStatusFiltro(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-1 text-[0.68rem] text-muted">Período:</span>
          <Input
            type="date"
            value={periodoIni}
            onChange={(e) => setPeriodoIni(e.target.value)}
            className="h-8 w-[140px] font-mono text-xs"
            placeholder="Início"
          />
          <Input
            type="date"
            value={periodoFim}
            onChange={(e) => setPeriodoFim(e.target.value)}
            className="h-8 w-[140px] font-mono text-xs"
            placeholder="Fim"
          />
        </div>

        {tabelaGeral.length === 0 ? (
          <div className="px-5 py-12 text-center font-display italic text-lg text-muted">
            Nenhum lançamento neste filtro.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <Th>Descrição</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Valor</Th>
                <Th>Vencimento</Th>
                <Th>Status</Th>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabelaGeral.map((f) => (
                <LinhaTabela
                  key={f.id}
                  fin={f}
                  onEdit={() => setEditingFin(f)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <FinanceiroFormDialog
        open={showNewDialog}
        onOpenChange={(o) => {
          setShowNewDialog(o)
          if (!o) setNewDefaults(null)
        }}
        defaultTipo={newDefaults?.tipo ?? null}
        defaultCategoria={newDefaults?.categoria ?? null}
      />
      <FinanceiroFormDialog
        open={editingFin !== null}
        onOpenChange={(o) => !o && setEditingFin(null)}
        financeiro={editingFin}
      />
    </div>
  )
}

// --------------------------------------------------------------------------

function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone: "rec" | "cust" | "info"
  hint?: string
}) {
  const tonesText: Record<typeof tone, string> = {
    rec: "text-sucesso",
    cust: "text-erro",
    info: "text-foreground",
  }
  return (
    <Card className="gap-0 rounded-card py-0">
      <div className="px-4 py-3" title={hint}>
        <div className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-muted">
          {label}
        </div>
        <div
          className={cn(
            "tabular-nums mt-1 font-mono text-[1.45rem] font-semibold leading-none",
            tonesText[tone]
          )}
        >
          {value}
        </div>
      </div>
    </Card>
  )
}

function PendenciasChip({
  tone,
  label,
  value,
}: {
  tone: "rec" | "cust"
  label: string
  value: number
}) {
  const dot = tone === "rec" ? "bg-sucesso" : "bg-erro"
  const text = tone === "rec" ? "text-sucesso" : "text-erro"
  return (
    <div className="rounded-card border border-border bg-surface-alt px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
        <span
          className={cn(
            "tabular-nums ml-auto font-mono text-[0.95rem] font-bold",
            text
          )}
        >
          {formatBRL(value)}
        </span>
      </div>
    </div>
  )
}

function LinhaTabela({
  fin,
  onEdit,
}: {
  fin: Financeiro
  onEdit: () => void
}) {
  const isReceita = TIPOS_RECEITA.has(fin.tipo)
  const isCusto = TIPOS_CUSTO.has(fin.tipo)
  const tomValor = isReceita
    ? "text-sucesso"
    : isCusto
      ? "text-erro"
      : "text-foreground"
  return (
    <TableRow
      onClick={onEdit}
      className={cn(
        "cursor-pointer border-border hover:bg-dourado/5",
        fin.status === "pago" && "opacity-60"
      )}
    >
      <TableCell className="py-2.5 pl-5 pr-3">
        <div className="font-medium text-foreground">{fin.descricao}</div>
        {fin.cliente_nome && (
          <div className="mt-0.5 text-[0.7rem] text-muted">{fin.cliente_nome}</div>
        )}
      </TableCell>
      <TableCell className="py-2.5 px-3 text-[0.78rem] capitalize text-foreground">
        {fin.tipo.replace(/_/g, " ")}
      </TableCell>
      <TableCell
        className={cn(
          "tabular-nums py-2.5 px-3 text-right font-mono text-[0.84rem] font-semibold",
          tomValor
        )}
      >
        {formatBRL(fin.valor)}
      </TableCell>
      <TableCell className="tabular-nums py-2.5 px-3 font-mono text-[0.78rem] text-muted">
        {formatDate(fin.data_vencimento)}
      </TableCell>
      <TableCell className="py-2.5 px-3">
        <StatusBadge status={fin.status} />
      </TableCell>
      <TableCell className="py-2.5 pl-3 pr-5"></TableCell>
    </TableRow>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
    pago: { bg: "bg-sucesso/12", fg: "text-sucesso", dot: "bg-sucesso", label: "Pago" },
    pendente: {
      bg: "bg-alerta/12",
      fg: "text-alerta",
      dot: "bg-alerta",
      label: "Pendente",
    },
    cancelado: {
      bg: "bg-fumaca/12",
      fg: "text-fumaca",
      dot: "bg-fumaca",
      label: "Cancelado",
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2 py-0.5 text-[0.7rem] font-semibold",
        s.bg,
        s.fg
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  )
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
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

function QuadrantesLoading() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-48 rounded-card" />
      ))}
    </div>
  )
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function sumValor(itens: Financeiro[]): number {
  return itens.reduce((acc, f) => acc + (f.valor || 0), 0)
}

function sumValorPendente(itens: Financeiro[]): number {
  return itens
    .filter((f) => f.status === "pendente")
    .reduce((acc, f) => acc + (f.valor || 0), 0)
}
