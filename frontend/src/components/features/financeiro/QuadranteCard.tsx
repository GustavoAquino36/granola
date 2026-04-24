import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import {
  deleteFinanceiro,
  despagarFinanceiro,
  pagarFinanceiro,
  queryKeys,
} from "@/api/granola"
import type { CategoriaFinanceiro, Financeiro, TipoFinanceiro } from "@/types/domain"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"
import { applySort, mesesRestantes, type SortState, type SortCol } from "./financeiro-utils"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface QuadranteCardProps {
  /** Cor de marca: usado no titulo + total + valor das linhas. */
  tom: "rec-fixa" | "cust-op" | "rec-var" | "cust-var"
  titulo: string
  itens: Financeiro[]
  /** "dia" = mostra so o dia do mes (fixos). "data" = mostra DD/MM/AAAA (variaveis). */
  modoData: "dia" | "data"
  /** Mostra checkbox 12m por linha (so receitas fixas). */
  mostrar12m?: boolean
  selected12m?: Set<number>
  onToggle12m?: (id: number) => void
  /** Sort state controlado pelo pai pra cada quadrante (4 estados independentes). */
  sort: SortState
  onSortChange: (next: SortState) => void
  /** Callback de + Novo: pre-preenche tipo + categoria. */
  defaultTipo: TipoFinanceiro
  defaultCategoria: CategoriaFinanceiro
  onAdd: (defaults: { tipo: TipoFinanceiro; categoria: CategoriaFinanceiro }) => void
  onEdit: (fin: Financeiro) => void
}

const TOM_STYLE = {
  "rec-fixa": {
    titulo: "text-sucesso",
    valor: "text-sucesso",
    border: "border-sucesso/25",
    bgCard: "bg-sucesso/[0.04]",
  },
  "cust-op": {
    titulo: "text-erro",
    valor: "text-erro",
    border: "border-erro/25",
    bgCard: "bg-erro/[0.04]",
  },
  "rec-var": {
    titulo: "text-[#3a6e9e]", // azul dessaturado
    valor: "text-[#3a6e9e]",
    border: "border-[#3a6e9e]/25",
    bgCard: "bg-[#3a6e9e]/[0.04]",
  },
  "cust-var": {
    titulo: "text-alerta",
    valor: "text-alerta",
    border: "border-alerta/25",
    bgCard: "bg-alerta/[0.04]",
  },
} as const

export function QuadranteCard({
  tom,
  titulo,
  itens,
  modoData,
  mostrar12m,
  selected12m,
  onToggle12m,
  sort,
  onSortChange,
  defaultTipo,
  defaultCategoria,
  onAdd,
  onEdit,
}: QuadranteCardProps) {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<Financeiro | null>(null)
  const style = TOM_STYLE[tom]

  const sorted = applySort(itens, sort)
  const total = itens.reduce((acc, f) => acc + (f.valor || 0), 0)

  const togglePagoMutation = useMutation({
    mutationFn: ({ fin, marcar }: { fin: Financeiro; marcar: boolean }) =>
      marcar ? pagarFinanceiro(fin.id) : despagarFinanceiro(fin.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "financeiro"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (fin: Financeiro) => deleteFinanceiro(fin.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "financeiro"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      setDeleteTarget(null)
    },
  })

  return (
    <div
      className={cn(
        "rounded-card border bg-surface",
        style.border,
        style.bgCard
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className={cn("font-sans text-[0.84rem] font-semibold", style.titulo)}>
          {titulo}
        </div>
        <button
          type="button"
          onClick={() => onAdd({ tipo: defaultTipo, categoria: defaultCategoria })}
          className="grid h-6 w-6 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
          aria-label="Novo lançamento"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-border/50">
            {mostrar12m && (
              <Th
                className="w-6 text-center"
                title="Selecionar para cálculo 12m"
              >
                12m
              </Th>
            )}
            <Th className="w-7 text-center" title="Pago / pendente">
              ✓
            </Th>
            <Th sortable col="descricao" sort={sort} onSortChange={onSortChange}>
              Origem
            </Th>
            <Th
              className="w-[80px] text-center"
              sortable
              col={modoData === "dia" ? "dia" : "data_vencimento"}
              sort={sort}
              onSortChange={onSortChange}
            >
              {modoData === "dia" ? "Dia" : "Venc."}
            </Th>
            <Th
              className="w-[110px] text-right"
              sortable
              col="valor"
              sort={sort}
              onSortChange={onSortChange}
            >
              Valor
            </Th>
            <Th className="w-9"> </Th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={mostrar12m ? 6 : 5}
                className="px-3 py-3 text-center font-display italic text-[0.78rem] text-muted"
              >
                vazio
              </td>
            </tr>
          ) : (
            sorted.map((f) => (
              <Linha
                key={f.id}
                fin={f}
                modoData={modoData}
                tom={tom}
                mostrar12m={mostrar12m}
                checked12m={selected12m?.has(f.id) ?? false}
                onToggle12m={() => onToggle12m?.(f.id)}
                onTogglePago={(marcar) =>
                  togglePagoMutation.mutate({ fin: f, marcar })
                }
                onEdit={() => onEdit(f)}
                onDelete={() => setDeleteTarget(f)}
                pendingPay={togglePagoMutation.isPending}
              />
            ))
          )}
        </tbody>
        <tfoot>
          <tr className={cn("border-t", style.border)}>
            <td colSpan={mostrar12m ? 3 : 2} className="px-3 py-1.5">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-muted">
                Total
              </span>
            </td>
            <td className="px-3 py-1.5"></td>
            <td
              className={cn(
                "tabular-nums px-3 py-1.5 text-right font-mono text-[0.84rem] font-bold",
                style.valor
              )}
            >
              {formatBRL(total)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          {deleteTarget && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  Excluir este lançamento?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <strong>{deleteTarget.descricao}</strong> ({formatBRL(deleteTarget.valor)})
                  será apagado permanentemente. Diferente de outros registros, lançamentos
                  financeiros são removidos por completo (sem soft-delete).
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteMutation.isError && (
                <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                  {deleteMutation.error instanceof Error
                    ? deleteMutation.error.message
                    : "Não foi possível excluir."}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    deleteMutation.mutate(deleteTarget)
                  }}
                  disabled={deleteMutation.isPending}
                  className="bg-erro text-marfim hover:bg-erro/90"
                >
                  {deleteMutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Excluir
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

function Linha({
  fin,
  modoData,
  tom,
  mostrar12m,
  checked12m,
  onToggle12m,
  onTogglePago,
  onEdit,
  onDelete,
  pendingPay,
}: {
  fin: Financeiro
  modoData: "dia" | "data"
  tom: keyof typeof TOM_STYLE
  mostrar12m?: boolean
  checked12m: boolean
  onToggle12m: () => void
  onTogglePago: (marcar: boolean) => void
  onEdit: () => void
  onDelete: () => void
  pendingPay: boolean
}) {
  const pago = fin.status === "pago"
  const style = TOM_STYLE[tom]
  const dataMostrar =
    modoData === "dia"
      ? fin.data_vencimento
        ? new Date(`${fin.data_vencimento}T12:00:00`).getDate()
        : "—"
      : fin.data_vencimento
        ? new Date(`${fin.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
          })
        : "—"

  const restantes = mesesRestantes(fin)
  const showRestBadge = fin.fixo === 1 && fin.meses_contrato > 0

  return (
    <tr className={cn("border-b border-border/40 last:border-b-0", pago && "opacity-50")}>
      {mostrar12m && (
        <td className="px-1 py-1.5 text-center">
          {fin.fixo === 1 && (
            <input
              type="checkbox"
              checked={checked12m}
              onChange={onToggle12m}
              className="h-3 w-3 cursor-pointer accent-[#3a6e9e]"
              title="Incluir no calculo 12m"
            />
          )}
        </td>
      )}
      <td className="px-1 py-1.5 text-center">
        <input
          type="checkbox"
          checked={pago}
          onChange={(e) => onTogglePago(e.target.checked)}
          disabled={pendingPay}
          className="h-3.5 w-3.5 cursor-pointer accent-dourado"
          title={pago ? "Desmarcar pagamento" : "Marcar como pago"}
        />
      </td>
      <td className={cn("px-2 py-1.5 text-[0.78rem]", pago && "line-through")}>
        <span className="text-foreground">{fin.descricao}</span>
        {fin.fixo === 0 && fin.parcelas > 1 && (
          <span className="ml-1 text-[0.65rem] text-muted">
            {fin.parcela_atual ?? 1}/{fin.parcelas}x
          </span>
        )}
        {fin.pago_por_cartao && (
          <span className="ml-1.5 text-[0.65rem] text-alerta" title="Pago no cartão">
            • {fin.pago_por_cartao}
          </span>
        )}
        {showRestBadge && restantes !== null && (
          <span
            className={cn(
              "ml-1.5 rounded-pill px-1 py-0 text-[0.6rem] font-medium",
              restantes <= 2
                ? "bg-erro/12 text-erro"
                : restantes <= 6
                  ? "bg-alerta/12 text-alerta"
                  : "bg-sucesso/12 text-sucesso"
            )}
            title={`${restantes} de ${fin.meses_contrato} meses restantes`}
          >
            {restantes}/{fin.meses_contrato}m
          </span>
        )}
      </td>
      <td
        className={cn(
          "tabular-nums px-2 py-1.5 text-center font-mono text-[0.72rem] text-muted",
          pago && "line-through"
        )}
      >
        {dataMostrar}
      </td>
      <td
        className={cn(
          "tabular-nums px-2 py-1.5 text-right font-mono text-[0.78rem] font-semibold",
          style.valor,
          pago && "line-through"
        )}
      >
        {formatBRL(fin.valor)}
      </td>
      <td className="px-1 py-1.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Mais ações"
              className="grid h-6 w-6 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /> Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}

function Th({
  children,
  className,
  sortable,
  col,
  sort,
  onSortChange,
  title,
}: {
  children: React.ReactNode
  className?: string
  sortable?: boolean
  col?: SortCol
  sort?: SortState
  onSortChange?: (next: SortState) => void
  title?: string
}) {
  const active = sort && col && sort.col === col
  return (
    <th
      onClick={
        sortable && col && sort && onSortChange
          ? () =>
              onSortChange({
                col,
                dir: active && sort.dir === "asc" ? "desc" : "asc",
              })
          : undefined
      }
      title={title}
      className={cn(
        "px-2 py-1.5 text-left text-[0.6rem] font-bold uppercase tracking-[0.14em] text-muted",
        sortable && "cursor-pointer select-none hover:text-foreground",
        className
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && sort && (
          sort.dir === "asc" ? (
            <ArrowUp className="h-2.5 w-2.5" strokeWidth={2} />
          ) : (
            <ArrowDown className="h-2.5 w-2.5" strokeWidth={2} />
          )
        )}
      </span>
    </th>
  )
}

