import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Trash2 } from "lucide-react"
import { deleteAgenda, queryKeys, upsertAgenda } from "@/api/granola"
import type { AgendaEvent, AgendaInput, TipoAgenda } from "@/types/domain"
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

const TIPOS: { value: TipoAgenda; label: string }[] = [
  { value: "audiencia", label: "Audiência" },
  { value: "reuniao", label: "Reunião" },
  { value: "prazo", label: "Prazo" },
  { value: "compromisso", label: "Compromisso" },
  { value: "outro", label: "Outro" },
]

const agendaSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(2, "Informe um título curto.")
    .max(200, "Limite de 200 caracteres."),
  tipo: z.string().min(1, "Tipo é obrigatorio."),
  data_inicio: z.string().min(1, "Data de início é obrigatoria."),
  data_fim: z.string().optional(),
  local: z.string().optional(),
  descricao: z.string().optional(),
  cliente_id: z.number().int().nullable().optional(),
  processo_id: z.number().int().nullable().optional(),
})

type FormValues = z.infer<typeof agendaSchema>

interface AgendaFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Em modo edit. */
  evento?: AgendaEvent | null
  /** Pre-preenche data quando vem de click numa celula vazia do calendario. */
  defaultDate?: string | null
  /** Trava cliente/processo quando vem de detalhe. */
  fixedClienteId?: number | null
  fixedProcessoId?: number | null
  onSaved?: (id: number) => void
}

export function AgendaFormDialog(props: AgendaFormDialogProps) {
  const { open, onOpenChange, evento } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        {open && <AgendaFormInner key={evento?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function defaultsFor(
  evento: AgendaEvent | null | undefined,
  defaultDate: string | null | undefined,
  fixedClienteId: number | null | undefined,
  fixedProcessoId: number | null | undefined
): FormValues {
  // Backend retorna data_inicio como ISO completo (ex: "2026-04-26T14:30:00").
  // Pra inputs HTML datetime-local precisamos de "2026-04-26T14:30".
  const data_inicio = evento?.data_inicio
    ? toLocalDateTime(evento.data_inicio)
    : defaultDate
      ? `${defaultDate}T09:00`
      : ""
  return {
    titulo: evento?.titulo ?? "",
    tipo: evento?.tipo ?? "compromisso",
    data_inicio,
    data_fim: evento?.data_fim ? toLocalDateTime(evento.data_fim) : "",
    local: evento?.local ?? "",
    descricao: evento?.descricao ?? "",
    cliente_id: evento?.cliente_id ?? fixedClienteId ?? null,
    processo_id: evento?.processo_id ?? fixedProcessoId ?? null,
  }
}

function AgendaFormInner({
  onOpenChange,
  evento,
  defaultDate,
  fixedClienteId,
  fixedProcessoId,
  onSaved,
}: AgendaFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(evento?.id)
  const [showDelete, setShowDelete] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(agendaSchema),
    defaultValues: defaultsFor(evento, defaultDate, fixedClienteId, fixedProcessoId),
  })

  const upsertMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const input: AgendaInput & { id?: number } = {
        titulo: values.titulo,
        tipo: values.tipo,
        data_inicio: values.data_inicio,
        data_fim: values.data_fim || null,
        local: values.local || null,
        descricao: values.descricao || null,
        cliente_id: values.cliente_id ?? null,
        processo_id: values.processo_id ?? null,
      }
      if (isEdit && evento) input.id = evento.id
      return upsertAgenda(input)
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "agenda"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      onSaved?.(id)
      onOpenChange(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteAgenda(evento!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "agenda"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      setShowDelete(false)
      onOpenChange(false)
    },
  })

  function onSubmit(values: FormValues) {
    upsertMutation.mutate(values)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">
          {isEdit ? "Editar evento" : "Novo evento"}
        </DialogTitle>
        <DialogDescription>
          Audiência, reunião ou compromisso. Se o Google Calendar estiver
          conectado, o evento sincroniza automaticamente.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="titulo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Título</FormLabel>
                <FormControl>
                  <Input
                    autoFocus
                    placeholder="Ex.: Audiência preliminar — Caso X"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
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
                      {TIPOS.map((t) => (
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
              name="local"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Local</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Tribunal, sala, link de videoconferência…"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField
              control={form.control}
              name="data_inicio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Início</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
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
              name="data_fim"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fim (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      className="font-mono"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

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

          <FormField
            control={form.control}
            name="descricao"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Descrição</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder="Pauta, anotações prévias, contexto…"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {upsertMutation.isError && (
            <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
              {upsertMutation.error instanceof Error
                ? upsertMutation.error.message
                : "Não foi possível salvar."}
            </p>
          )}

          <DialogFooter className="sm:justify-between">
            {isEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowDelete(true)}
                disabled={upsertMutation.isPending}
                className="gap-1 text-erro hover:bg-erro/10"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Excluir
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={upsertMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={upsertMutation.isPending}
                className={cn(
                  "bg-dourado text-tinta hover:bg-dourado-claro",
                  "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
                )}
              >
                {upsertMutation.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {isEdit ? "Salvar alterações" : "Criar evento"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </Form>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-normal">
              Excluir este evento?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{evento?.titulo}</strong> sera removido permanentemente da
              agenda. {evento?.google_event_id ? (
                <>Como esta sincronizado com o Google Calendar, sera removido de la também.</>
              ) : null}
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
                deleteMutation.mutate()
              }}
              disabled={deleteMutation.isPending}
              className="bg-erro text-marfim hover:bg-erro/90"
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Excluir evento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** "2026-04-26T14:30:00" -> "2026-04-26T14:30" (formato datetime-local). */
function toLocalDateTime(raw: string): string {
  if (!raw) return ""
  // Pega so YYYY-MM-DDTHH:MM
  return raw.slice(0, 16)
}
