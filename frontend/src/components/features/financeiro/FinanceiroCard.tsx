import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
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
import type { Financeiro } from "@/types/domain"
import { formatBRL, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { FinanceiroFormDialog } from "./FinanceiroFormDialog"
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const TIPOS_RECEITA = new Set([
  "honorario",
  "receita",
  "reembolso",
  "receita_fixa",
  "receita_variavel",
])

interface FinanceiroCardProps {
  lancamentos: Financeiro[]
  processoId: number
  clienteId?: number | null
}

/**
 * Card de financeiro vinculado — usado no ProcessoDetailPage.
 * Compartilha o FinanceiroFormDialog com a pagina standalone.
 */
export function FinanceiroCard({
  lancamentos,
  processoId,
  clienteId,
}: FinanceiroCardProps) {
  const queryClient = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<Financeiro | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Financeiro | null>(null)

  const receitas = lancamentos
    .filter((f) => TIPOS_RECEITA.has(f.tipo))
    .reduce((acc, f) => acc + (f.valor || 0), 0)
  const despesas = lancamentos
    .filter((f) => !TIPOS_RECEITA.has(f.tipo))
    .reduce((acc, f) => acc + (f.valor || 0), 0)
  const saldo = receitas - despesas

  const togglePagoMutation = useMutation({
    mutationFn: ({ fin, marcar }: { fin: Financeiro; marcar: boolean }) =>
      marcar ? pagarFinanceiro(fin.id) : despagarFinanceiro(fin.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) })
      queryClient.invalidateQueries({ queryKey: ["granola", "financeiro"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (fin: Financeiro) => deleteFinanceiro(fin.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) })
      queryClient.invalidateQueries({ queryKey: ["granola", "financeiro"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      setDeleteTarget(null)
    },
  })

  return (
    <Card className="gap-0 rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold">
          Financeiro
        </CardTitle>
        <div className="ml-auto flex items-center gap-3">
          <span className="tabular-nums text-[0.78rem] text-muted">
            <span className="text-sucesso">{formatBRL(receitas)}</span>
            {" · "}
            <span className="text-erro">{formatBRL(despesas)}</span>
            {" · "}
            <span className={cn("font-semibold", saldo >= 0 ? "text-sucesso" : "text-erro")}>
              {formatBRL(saldo)}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-[0.78rem] hover:bg-dourado/10"
            onClick={() => setShowNew(true)}
          >
            <Plus className="h-3 w-3" strokeWidth={2} /> Novo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 py-0">
        {lancamentos.length === 0 ? (
          <p className="font-display italic text-muted text-base px-5 py-6">
            Nenhum lançamento neste processo ainda.
          </p>
        ) : (
          <ul>
            {lancamentos.map((f) => (
              <FinanceiroLi
                key={f.id}
                fin={f}
                onEdit={() => setEditing(f)}
                onTogglePago={(marcar) =>
                  togglePagoMutation.mutate({ fin: f, marcar })
                }
                onDelete={() => setDeleteTarget(f)}
                pendingPay={togglePagoMutation.isPending}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <FinanceiroFormDialog
        open={showNew}
        onOpenChange={setShowNew}
        fixedProcessoId={processoId}
        fixedClienteId={clienteId ?? null}
      />
      <FinanceiroFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        financeiro={editing}
        fixedProcessoId={processoId}
        fixedClienteId={clienteId ?? null}
      />

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
                  será apagado permanentemente. Lançamentos financeiros são removidos
                  por completo (sem soft-delete).
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
    </Card>
  )
}

function FinanceiroLi({
  fin,
  onEdit,
  onTogglePago,
  onDelete,
  pendingPay,
}: {
  fin: Financeiro
  onEdit: () => void
  onTogglePago: (marcar: boolean) => void
  onDelete: () => void
  pendingPay: boolean
}) {
  const isReceita = TIPOS_RECEITA.has(fin.tipo)
  const tomValor = isReceita ? "text-sucesso" : "text-erro"
  const pago = fin.status === "pago"
  return (
    <li
      className={cn(
        "flex items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0",
        pago && "opacity-60"
      )}
    >
      <input
        type="checkbox"
        checked={pago}
        onChange={(e) => onTogglePago(e.target.checked)}
        disabled={pendingPay}
        className="h-3.5 w-3.5 cursor-pointer accent-dourado"
        title={pago ? "Desmarcar pagamento" : "Marcar como pago"}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "font-sans text-[0.85rem] font-medium text-foreground",
            pago && "line-through"
          )}
        >
          {fin.descricao}
        </div>
        <div className="mt-0.5 text-[0.7rem] text-muted">
          <span className="capitalize">{fin.tipo.replace(/_/g, " ")}</span>
          {fin.data_vencimento && (
            <>
              {" · "}
              <span className="tabular-nums font-mono">
                {formatDate(fin.data_vencimento)}
              </span>
            </>
          )}
        </div>
      </div>
      <span
        className={cn(
          "tabular-nums shrink-0 font-mono text-[0.85rem] font-semibold",
          tomValor,
          pago && "line-through"
        )}
      >
        {formatBRL(fin.valor)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Mais ações"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
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
    </li>
  )
}
