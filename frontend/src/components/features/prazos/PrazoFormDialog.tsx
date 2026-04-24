import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { upsertPrazo, queryKeys } from "@/api/granola"
import type { Prazo, PrazoInput } from "@/types/domain"
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
import { ProcessoSearchSelect } from "@/components/shared/ProcessoSearchSelect"
import { cn } from "@/lib/utils"

// --------------------------------------------------------------------------
// Schema Zod — sem transforms que mudem input/output type (regra do projeto)
// --------------------------------------------------------------------------

const prazoSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(2, "Informe um titulo curto.")
    .max(200, "Titulo longo demais."),
  data_vencimento: z.string().min(1, "Data de vencimento é obrigatoria."),
  prioridade: z.enum(["urgente", "alta", "media", "normal", "baixa"]),
  tipo: z.string().trim().min(1).optional(),
  processo_id: z.number().int().nullable().optional(),
  cliente_id: z.number().int().nullable().optional(),
  alerta_dias: z.number().int().min(0).max(60).optional(),
  responsavel: z.string().trim().optional(),
  descricao: z.string().trim().optional(),
})

type FormValues = z.infer<typeof prazoSchema>

interface PrazoFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se passado, abre em modo edit. */
  prazo?: Prazo | null
  /** Pre-preenche e trava o processo (uso a partir do detalhe do processo). */
  fixedProcessoId?: number | null
  onSaved?: (id: number) => void
}

function defaultsFor(prazo: Prazo | null | undefined, fixedProcessoId: number | null | undefined): FormValues {
  return {
    titulo: prazo?.titulo ?? "",
    data_vencimento: prazo?.data_vencimento ?? "",
    prioridade: ((prazo?.prioridade as FormValues["prioridade"]) || "normal"),
    tipo: prazo?.tipo ?? "prazo",
    processo_id: prazo?.processo_id ?? fixedProcessoId ?? null,
    cliente_id: prazo?.cliente_id ?? null,
    alerta_dias: prazo?.alerta_dias ?? 3,
    responsavel: prazo?.responsavel ?? "",
    descricao: prazo?.descricao ?? "",
  }
}

export function PrazoFormDialog({
  open,
  onOpenChange,
  prazo,
  fixedProcessoId,
  onSaved,
}: PrazoFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(prazo?.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(prazoSchema),
    defaultValues: defaultsFor(prazo, fixedProcessoId),
  })

  useEffect(() => {
    if (open) {
      form.reset(defaultsFor(prazo, fixedProcessoId))
    }
  }, [open, prazo, fixedProcessoId, form])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const input: PrazoInput & { id?: number } = {
        titulo: values.titulo,
        data_vencimento: values.data_vencimento,
        prioridade: values.prioridade,
        tipo: values.tipo || "prazo",
        processo_id: values.processo_id ?? null,
        cliente_id: values.cliente_id ?? null,
        alerta_dias: values.alerta_dias ?? 3,
        responsavel: values.responsavel || null,
        descricao: values.descricao || null,
      }
      if (isEdit && prazo) input.id = prazo.id
      return upsertPrazo(input)
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "prazos"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      const procId = form.getValues("processo_id")
      if (procId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.processo(procId) })
      }
      onSaved?.(id)
      onOpenChange(false)
    },
  })

  function onSubmit(values: FormValues) {
    mutation.mutate(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            {isEdit ? "Editar prazo" : "Novo prazo"}
          </DialogTitle>
          <DialogDescription>
            Prazos podem ficar soltos ou amarrados a um processo. O alerta dispara
            automaticamente <code className="font-mono text-[0.75rem]">N</code> dias antes do vencimento.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Titulo</FormLabel>
                  <FormControl>
                    <Input
                      autoFocus
                      placeholder="Ex.: Contestacao — prazo de 15 dias"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
              <FormField
                control={form.control}
                name="data_vencimento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vencimento</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
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
                name="prioridade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prioridade</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="urgente">Urgente</SelectItem>
                        <SelectItem value="alta">Alta</SelectItem>
                        <SelectItem value="media">Média</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="baixa">Baixa</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px]">
              <FormField
                control={form.control}
                name="tipo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="prazo, audiência, peticao…"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="alerta_dias"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alerta (dias)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        className="font-mono"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : parseInt(e.target.value, 10)
                          )
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

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

            <FormField
              control={form.control}
              name="responsavel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Responsavel</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Quem cumpre o prazo"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Contexto, peças relacionadas, links, observações…"
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
                {isEdit ? "Salvar alterações" : "Criar prazo"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
