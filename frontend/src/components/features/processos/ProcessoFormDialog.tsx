import { useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { upsertProcesso, queryKeys } from "@/api/granola"
import type { Processo, ProcessoDetail, ProcessoInput } from "@/types/domain"
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
import { cn } from "@/lib/utils"
import { ClienteSearchSelect } from "./ClienteSearchSelect"

// --------------------------------------------------------------------------
// Zod schema
// --------------------------------------------------------------------------

const optionalString = z
  .string()
  .transform((v) => v.trim())
  .optional()

const processoSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(2, "Informe ao menos 2 caracteres.")
    .max(200, "Limite de 200 caracteres."),
  cliente_id: z
    .number({ error: "Selecione um cliente." })
    .int()
    .positive("Selecione um cliente."),
  tipo: z.string().min(1),
  area: z.string().trim().min(1, "Informe a area."),
  numero_cnj: optionalString.refine(
    (v) => !v || /^[\d.\-/\s]+$/.test(v),
    { message: "Use apenas numeros e pontuacao." }
  ),
  numero_interno: optionalString,
  rito: optionalString,
  classe: optionalString,
  comarca: optionalString,
  vara: optionalString,
  tribunal: optionalString,
  juiz: optionalString,
  polo: z.enum(["ativo", "passivo"]).optional(),
  parte_contraria: optionalString,
  cpf_cnpj_contraria: optionalString,
  advogado_contrario: optionalString,
  oab_contrario: optionalString,
  valor_causa: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? 0 : Number(v)),
      z.number().min(0, "Valor nao pode ser negativo.")
    )
    .optional(),
  link_autos: optionalString,
  observacao: optionalString,
})

type FormValues = z.infer<typeof processoSchema>

// --------------------------------------------------------------------------
// Defaults
// --------------------------------------------------------------------------

const AREAS_SUGERIDAS = [
  "trabalhista",
  "civel",
  "consumidor",
  "empresarial",
  "tributario",
  "penal",
  "familia",
  "previdenciario",
  "administrativo",
]

function fromProcesso(p: Processo | ProcessoDetail | null | undefined): FormValues {
  return {
    titulo: p?.titulo ?? "",
    cliente_id: p?.cliente_id ?? (0 as unknown as number), // placeholder; valida no zod
    tipo: p?.tipo ?? "judicial",
    area: p?.area ?? "trabalhista",
    numero_cnj: p?.numero_cnj ?? "",
    numero_interno: p?.numero_interno ?? "",
    rito: p?.rito ?? "",
    classe: p?.classe ?? "",
    comarca: p?.comarca ?? "",
    vara: p?.vara ?? "",
    tribunal: p?.tribunal ?? "",
    juiz: p?.juiz ?? "",
    polo: (p?.polo as "ativo" | "passivo" | undefined) ?? "ativo",
    parte_contraria: p?.parte_contraria ?? "",
    cpf_cnpj_contraria: p?.cpf_cnpj_contraria ?? "",
    advogado_contrario: p?.advogado_contrario ?? "",
    oab_contrario: p?.oab_contrario ?? "",
    valor_causa: p?.valor_causa ?? 0,
    link_autos: p?.link_autos ?? "",
    observacao: p?.observacao ?? "",
  }
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

interface ProcessoFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se presente, modo edit com os dados pre-populados. Se o ProcessoDetail
   *  vier com `cliente`, usamos pra o preview do select (evita flash de "#id"). */
  processo?: Processo | ProcessoDetail | null
  onSaved?: (id: number) => void
}

export function ProcessoFormDialog({
  open,
  onOpenChange,
  processo,
  onSaved,
}: ProcessoFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(processo?.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(processoSchema),
    defaultValues: fromProcesso(processo),
  })

  useEffect(() => {
    if (open) form.reset(fromProcesso(processo))
  }, [open, processo, form])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const input: ProcessoInput & { id?: number } = { ...values }
      if (isEdit && processo) input.id = processo.id
      return upsertProcesso(input)
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "processos"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      onSaved?.(id)
      onOpenChange(false)
    },
  })

  // Preview do cliente em modo edit — se o ProcessoDetail trouxer `cliente`,
  // repasso pro ClienteSearchSelect pra evitar flash de "cliente #id".
  const clientePreview = useMemo(() => {
    if (!processo || !("cliente" in processo) || !processo.cliente) return null
    return {
      id: processo.cliente.id,
      nome: processo.cliente.nome,
      cpf_cnpj: processo.cliente.cpf_cnpj,
      tipo: "" as const,
    }
  }, [processo])

  function onSubmit(values: FormValues) {
    mutation.mutate(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            {isEdit ? "Editar processo" : "Adicionar processo"}
          </DialogTitle>
          <DialogDescription>
            Preencha os dados essenciais — os demais podem ser completados
            depois ou importados automaticamente do DataJud.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* ===== Essenciais ===== */}
            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título do processo</FormLabel>
                  <FormControl>
                    <Input
                      autoFocus
                      placeholder="Ex: Maria Silva vs. Banco Fictício"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cliente_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <FormControl>
                    <ClienteSearchSelect
                      value={field.value}
                      onChange={(id) => field.onChange(id ?? 0)}
                      selectedPreview={clientePreview}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr_180px]">
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
                        <SelectItem value="judicial">Judicial</SelectItem>
                        <SelectItem value="administrativo">
                          Administrativo
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="area"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Area</FormLabel>
                    <FormControl>
                      <Input list="areas-sugeridas" {...field} />
                    </FormControl>
                    <datalist id="areas-sugeridas">
                      {AREAS_SUGERIDAS.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="polo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Polo (do cliente)</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Polo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="passivo">Passivo</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField
                control={form.control}
                name="numero_cnj"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número CNJ</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="0000000-00.0000.0.00.0000"
                        className="font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="valor_causa"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valor da causa (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        className="font-mono"
                        {...field}
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ===== Jurisdicao (collapsible) ===== */}
            <CollapsibleSection title="Jurisdição">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tribunal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tribunal</FormLabel>
                      <FormControl>
                        <Input placeholder="TJSP, TRT2, TRF3…" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vara"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vara</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr]">
                <FormField
                  control={form.control}
                  name="comarca"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Comarca</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rito"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rito</FormLabel>
                      <FormControl>
                        <Input placeholder="sumario, ordinario…" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="classe"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Classe</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <div className="mt-3">
                <FormField
                  control={form.control}
                  name="juiz"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Juiz(a)</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CollapsibleSection>

            {/* ===== Parte contraria (collapsible) ===== */}
            <CollapsibleSection title="Parte contrária">
              <FormField
                control={form.control}
                name="parte_contraria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da parte contrária</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr]">
                <FormField
                  control={form.control}
                  name="cpf_cnpj_contraria"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CPF/CNPJ</FormLabel>
                      <FormControl>
                        <Input className="font-mono" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="advogado_contrario"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Advogado contrário</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="oab_contrario"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OAB contrário</FormLabel>
                      <FormControl>
                        <Input placeholder="SP/000000" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CollapsibleSection>

            {/* ===== Outros ===== */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField
                control={form.control}
                name="numero_interno"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Numero interno</FormLabel>
                    <FormControl>
                      <Input placeholder="GR-2026-001" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="link_autos"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Link dos autos</FormLabel>
                    <FormControl>
                      <Input placeholder="https://esaj..." {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="observacao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observação</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Notas internas, contexto, estrategia…"
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
                  : "Nao foi possivel salvar."}
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
                {isEdit ? "Salvar alteracoes" : "Criar processo"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function CollapsibleSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <details className="rounded-card border border-border bg-surface-alt">
      <summary
        className={cn(
          "cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-foreground",
          "marker:text-dourado hover:bg-dourado/5"
        )}
      >
        {title}
      </summary>
      <div className="border-t border-border bg-surface px-4 py-4">
        {children}
      </div>
    </details>
  )
}
