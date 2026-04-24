import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { upsertFinanceiro, queryKeys } from "@/api/granola"
import type {
  CategoriaFinanceiro,
  Financeiro,
  FinanceiroInput,
  TipoFinanceiro,
} from "@/types/domain"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ClienteSearchSelect } from "@/components/features/processos/ClienteSearchSelect"
import { ProcessoSearchSelect } from "@/components/shared/ProcessoSearchSelect"
import { cn } from "@/lib/utils"

// --------------------------------------------------------------------------
// Schema Zod — sem transforms que mudem input/output (regra §6.4)
// --------------------------------------------------------------------------

const TIPOS_FINANCEIRO: { value: TipoFinanceiro; label: string; tom: "rec" | "cust" }[] =
  [
    { value: "receita_fixa", label: "Receita fixa", tom: "rec" },
    { value: "receita_variavel", label: "Receita variável", tom: "rec" },
    { value: "honorario", label: "Honorário", tom: "rec" },
    { value: "reembolso", label: "Reembolso", tom: "rec" },
    { value: "custo_operacional", label: "Custo operacional", tom: "cust" },
    { value: "custo_variavel", label: "Custo variável", tom: "cust" },
    { value: "custa_judicial", label: "Custa judicial", tom: "cust" },
    { value: "custa_extrajudicial", label: "Custa extrajudicial", tom: "cust" },
    { value: "despesa", label: "Despesa avulsa", tom: "cust" },
  ]

const TIPOS_RECEITA: TipoFinanceiro[] = [
  "receita_fixa",
  "receita_variavel",
  "honorario",
  "reembolso",
  "receita",
]

/** Tipos que pertencem a custos. */
function isCusto(tipo: TipoFinanceiro): boolean {
  return !TIPOS_RECEITA.includes(tipo)
}

const financeiroSchema = z.object({
  tipo: z.string().min(1, "Tipo é obrigatorio."),
  categoria: z.string().optional(),
  descricao: z
    .string()
    .trim()
    .min(2, "Informe a descrição (≥ 2 caracteres).")
    .max(200, "Limite de 200 caracteres."),
  valor: z.number().min(0, "Valor não pode ser negativo."),
  data_vencimento: z.string().optional(),
  cliente_id: z.number().int().nullable().optional(),
  processo_id: z.number().int().nullable().optional(),
  fixo: z.boolean(),
  parcelas: z.number().int().min(0).optional(),
  parcela_atual: z.number().int().min(1).optional(),
  pago_por_cartao: z.string().optional(),
  meses_contrato: z.number().int().min(0).optional(),
  data_inicio_contrato: z.string().optional(),
  observacao: z.string().optional(),
})

type FormValues = z.infer<typeof financeiroSchema>

interface FinanceiroFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Em modo edit. */
  financeiro?: Financeiro | null
  /** Trava cliente/processo (uso a partir do detalhe). */
  fixedClienteId?: number | null
  fixedProcessoId?: number | null
  /** Pre-seleciona categoria + tipo (chamado pelo botao "+" de cada quadrante). */
  defaultCategoria?: CategoriaFinanceiro | null
  defaultTipo?: TipoFinanceiro | null
  onSaved?: (id: number) => void
}

function defaultsFor(
  fin: Financeiro | null | undefined,
  fixedClienteId: number | null | undefined,
  fixedProcessoId: number | null | undefined,
  defaultCategoria: CategoriaFinanceiro | null | undefined,
  defaultTipo: TipoFinanceiro | null | undefined
): FormValues {
  return {
    tipo: fin?.tipo ?? defaultTipo ?? "custo_operacional",
    categoria: fin?.categoria ?? defaultCategoria ?? "",
    descricao: fin?.descricao ?? "",
    valor: fin?.valor ?? 0,
    data_vencimento: fin?.data_vencimento ?? "",
    cliente_id: fin?.cliente_id ?? fixedClienteId ?? null,
    processo_id: fin?.processo_id ?? fixedProcessoId ?? null,
    fixo: fin ? fin.fixo === 1 : true,
    parcelas: fin?.parcelas ?? 1,
    parcela_atual: fin?.parcela_atual ?? 1,
    pago_por_cartao: fin?.pago_por_cartao ?? "",
    meses_contrato: fin?.meses_contrato ?? 0,
    data_inicio_contrato: fin?.data_inicio_contrato ?? "",
    observacao: fin?.observacao ?? "",
  }
}

/**
 * Dialog wrapper — content vive em FinanceiroFormInner com `key` pra
 * forcar remount em cada abertura (padrao §6.4 evitando setState em useEffect).
 */
export function FinanceiroFormDialog(props: FinanceiroFormDialogProps) {
  const { open, onOpenChange, financeiro } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        {open && <FinanceiroFormInner key={financeiro?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function FinanceiroFormInner({
  onOpenChange,
  financeiro,
  fixedClienteId,
  fixedProcessoId,
  defaultCategoria,
  defaultTipo,
  onSaved,
}: FinanceiroFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(financeiro?.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(financeiroSchema),
    defaultValues: defaultsFor(
      financeiro,
      fixedClienteId,
      fixedProcessoId,
      defaultCategoria,
      defaultTipo
    ),
  })

  // useWatch é memoizavel (form.watch nao é — quebra React Compiler)
  const tipoAtual = useWatch({ control: form.control, name: "tipo" }) as TipoFinanceiro
  const fixoAtual = useWatch({ control: form.control, name: "fixo" })
  const categoriaAtual = useWatch({ control: form.control, name: "categoria" })

  const ehCusto = isCusto(tipoAtual)
  const ehReceitaFixa = tipoAtual === "receita_fixa"
  const mostrarCartao = ehCusto
  const mostrarParcelas = !fixoAtual
  const mostrarContrato = fixoAtual && (ehReceitaFixa || categoriaAtual === "fixo")

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const input: FinanceiroInput & { id?: number } = {
        tipo: values.tipo as TipoFinanceiro,
        descricao: values.descricao,
        valor: values.valor,
        categoria: values.categoria || null,
        data_vencimento: values.data_vencimento || null,
        cliente_id: values.cliente_id ?? null,
        processo_id: values.processo_id ?? null,
        fixo: values.fixo ? 1 : 0,
        parcelas: values.fixo ? 0 : values.parcelas ?? 1,
        parcela_atual: values.fixo ? 1 : values.parcela_atual ?? 1,
        pago_por_cartao: values.pago_por_cartao || null,
        meses_contrato: values.meses_contrato ?? 0,
        data_inicio_contrato: values.data_inicio_contrato || null,
        observacao: values.observacao || null,
      }
      if (isEdit && financeiro) input.id = financeiro.id
      return upsertFinanceiro(input)
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "financeiro"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      const procId = form.getValues("processo_id")
      if (procId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.processo(procId) })
      }
      const clId = form.getValues("cliente_id")
      if (clId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.cliente(clId) })
      }
      onSaved?.(id)
      onOpenChange(false)
    },
  })

  function onSubmit(values: FormValues) {
    mutation.mutate(values)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">
          {isEdit ? "Editar lançamento" : "Novo lançamento"}
        </DialogTitle>
        <DialogDescription>
          Receita ou custo, fixo ou avulso. Categoria define em qual quadrante
          aparece no dashboard financeiro — pode deixar em branco se não for um dos quatro.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* ===== Tipo + Valor ===== */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <div className="px-2 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sucesso">
                        Receitas
                      </div>
                      {TIPOS_FINANCEIRO.filter((t) => t.tom === "rec").map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                      <div className="mt-1 px-2 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-erro">
                        Custos
                      </div>
                      {TIPOS_FINANCEIRO.filter((t) => t.tom === "cust").map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="valor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor (R$)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      className="font-mono"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === ""
                            ? 0
                            : parseFloat(e.target.value)
                        )
                      }
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* ===== Descricao ===== */}
          <FormField
            control={form.control}
            name="descricao"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Descrição</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ex.: Aluguel sala, Honorário processo X, Custas iniciais…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* ===== Vencimento + Cartao (so custos) ===== */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField
              control={form.control}
              name="data_vencimento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vencimento</FormLabel>
                  <FormControl>
                    <Input type="date" className="font-mono" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            {mostrarCartao && (
              <FormField
                control={form.control}
                name="pago_por_cartao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pago no cartão</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(v) =>
                        field.onChange(v === "__none__" ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Nenhum (PJ)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Nenhum (PJ)</SelectItem>
                        <SelectItem value="lucas">Cartão Lucas</SelectItem>
                        <SelectItem value="enzo">Cartão Enzo</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            )}
          </div>

          {/* ===== Cliente + Processo ===== */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {!fixedClienteId && (
              <FormField
                control={form.control}
                name="cliente_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente (opcional)</FormLabel>
                    <ClienteSearchSelect
                      value={field.value ?? null}
                      onChange={(id) => field.onChange(id)}
                    />
                  </FormItem>
                )}
              />
            )}
            {!fixedProcessoId && (
              <FormField
                control={form.control}
                name="processo_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Processo (opcional)</FormLabel>
                    <ProcessoSearchSelect
                      value={field.value ?? null}
                      onChange={(id) => field.onChange(id)}
                    />
                  </FormItem>
                )}
              />
            )}
          </div>

          {/* ===== Fixo / Avulso ===== */}
          <FormField
            control={form.control}
            name="fixo"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2.5 rounded-card border border-border bg-surface-alt px-4 py-3">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-dourado"
                  />
                </FormControl>
                <div className="flex-1">
                  <FormLabel className="cursor-pointer">
                    Lançamento fixo (recorrente)
                  </FormLabel>
                  <p className="text-[0.72rem] text-muted">
                    Marque pra entradas que se repetem todo mês (aluguel, salário, contratos).
                    Desmarque pra avulsos com vencimento único ou parcelado.
                  </p>
                </div>
              </FormItem>
            )}
          />

          {/* ===== Parcelas (só avulsos) ===== */}
          {mostrarParcelas && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
              <FormField
                control={form.control}
                name="parcela_atual"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parcela atual</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        className="font-mono"
                        value={field.value ?? 1}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value, 10) || 1)
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parcelas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total de parcelas</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        className="font-mono"
                        value={field.value ?? 1}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value, 10) || 0)
                        }
                      />
                    </FormControl>
                    <p className="text-[0.65rem] text-muted">0 = recorrente sem fim</p>
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* ===== Contrato (só receita_fixa fixa) ===== */}
          {mostrarContrato && (
            <div className="grid grid-cols-1 gap-3 rounded-card border border-border bg-surface-alt p-3 md:grid-cols-2">
              <FormField
                control={form.control}
                name="meses_contrato"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duração do contrato (meses)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        className="font-mono"
                        value={field.value ?? 0}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value, 10) || 0)
                        }
                      />
                    </FormControl>
                    <p className="text-[0.65rem] text-muted">0 = permanente</p>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="data_inicio_contrato"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Início do contrato</FormLabel>
                    <FormControl>
                      <Input
                        type="month"
                        className="font-mono"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* ===== Observação ===== */}
          <FormField
            control={form.control}
            name="observacao"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Observação</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder="Notas internas, links, contexto…"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {mutation.isError && (
            <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Não foi possível salvar."}
            </p>
          )}

          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending}
              className={cn(
                "bg-dourado text-tinta hover:bg-dourado-claro",
                "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
              )}
            >
              {mutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              {isEdit ? "Salvar alterações" : "Criar lançamento"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
