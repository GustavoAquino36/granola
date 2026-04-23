import { useEffect } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { upsertCliente, queryKeys } from "@/api/granola"
import type { Cliente, ClienteInput, TipoPessoa } from "@/types/domain"
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

// --------------------------------------------------------------------------
// Schema Zod
// --------------------------------------------------------------------------

/** Aceita string vazia como "nao preenchido" em fields opcionais. */
const optionalString = z
  .string()
  .transform((v) => v.trim())
  .optional()

const clienteSchema = z.object({
  tipo: z.enum(["PF", "PJ"]),
  nome: z
    .string()
    .trim()
    .min(2, "Informe ao menos 2 caracteres.")
    .max(200, "Limite de 200 caracteres."),
  cpf_cnpj: optionalString.refine(
    (v) => !v || /^[\d.\-/\s]+$/.test(v),
    { message: "Use apenas numeros e pontuacao." }
  ),
  rg: optionalString,
  email: z
    .string()
    .trim()
    .email("E-mail invalido.")
    .or(z.literal(""))
    .optional(),
  telefone: optionalString,
  telefone2: optionalString,
  endereco_cep: optionalString,
  endereco_logradouro: optionalString,
  endereco_numero: optionalString,
  endereco_complemento: optionalString,
  endereco_bairro: optionalString,
  endereco_cidade: optionalString,
  endereco_uf: optionalString,
  data_nascimento: optionalString,
  profissao: optionalString,
  estado_civil: optionalString,
  nacionalidade: optionalString,
  observacao: optionalString,
})

type FormValues = z.infer<typeof clienteSchema>

// --------------------------------------------------------------------------
// Props + helpers
// --------------------------------------------------------------------------

interface ClienteFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se presente, abre em modo edit. Senao, abre em modo create. */
  cliente?: Cliente | null
  /** Callback apos salvar com sucesso. Recebe o id do cliente persistido. */
  onSaved?: (id: number) => void
}

function fromCliente(c: Cliente | null | undefined): FormValues {
  return {
    tipo: ((c?.tipo as TipoPessoa) || "PF") as TipoPessoa,
    nome: c?.nome ?? "",
    cpf_cnpj: c?.cpf_cnpj ?? "",
    rg: c?.rg ?? "",
    email: c?.email ?? "",
    telefone: c?.telefone ?? "",
    telefone2: c?.telefone2 ?? "",
    endereco_cep: c?.endereco_cep ?? "",
    endereco_logradouro: c?.endereco_logradouro ?? "",
    endereco_numero: c?.endereco_numero ?? "",
    endereco_complemento: c?.endereco_complemento ?? "",
    endereco_bairro: c?.endereco_bairro ?? "",
    endereco_cidade: c?.endereco_cidade ?? "",
    endereco_uf: c?.endereco_uf ?? "",
    data_nascimento: c?.data_nascimento ?? "",
    profissao: c?.profissao ?? "",
    estado_civil: c?.estado_civil ?? "",
    nacionalidade: c?.nacionalidade ?? "",
    observacao: c?.observacao ?? "",
  }
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export function ClienteFormDialog({
  open,
  onOpenChange,
  cliente,
  onSaved,
}: ClienteFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(cliente?.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(clienteSchema),
    defaultValues: fromCliente(cliente),
  })

  // Reset ao abrir/trocar cliente
  useEffect(() => {
    if (open) {
      form.reset(fromCliente(cliente))
    }
  }, [open, cliente, form])

  // useWatch eh memoizavel (form.watch nao eh — dispara warn no React Compiler)
  const tipo = useWatch({ control: form.control, name: "tipo" })

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const input: ClienteInput & { id?: number } = {
        ...values,
        // Backend espera `nome` e `tipo` nao-opcionais
        nome: values.nome,
        tipo: values.tipo,
      }
      if (isEdit && cliente) input.id = cliente.id
      return upsertCliente(input)
    },
    onSuccess: ({ id }) => {
      // Invalida listas + detalhe especifico
      queryClient.invalidateQueries({ queryKey: ["granola", "clientes"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.cliente(id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      onSaved?.(id)
      onOpenChange(false)
    },
  })

  function onSubmit(values: FormValues) {
    mutation.mutate(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            {isEdit ? "Editar cliente" : "Adicionar cliente"}
          </DialogTitle>
          <DialogDescription>
            Os dados sao armazenados localmente em{" "}
            <code className="font-mono text-[0.75rem]">granola.db</code> — nunca
            vao pra servidor externo sem consentimento explicito.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* ===== Tipo + Nome ===== */}
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <FormField
                control={form.control}
                name="tipo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
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
                        <SelectItem value="PF">Pessoa fisica</SelectItem>
                        <SelectItem value="PJ">Pessoa juridica</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tipo === "PJ" ? "Razao social" : "Nome completo"}
                    </FormLabel>
                    <FormControl>
                      <Input autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ===== Documento + Contato ===== */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField
                control={form.control}
                name="cpf_cnpj"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tipo === "PJ" ? "CNPJ" : "CPF"}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          tipo === "PJ"
                            ? "00.000.000/0000-00"
                            : "000.000.000-00"
                        }
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
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="contato@exemplo.com.br"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField
                control={form.control}
                name="telefone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(11) 98765-4321"
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
                name="telefone2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone secundario</FormLabel>
                    <FormControl>
                      <Input className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ===== Endereco (collapsible) ===== */}
            <CollapsibleSection title="Endereço" defaultOpen={false}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[120px_1fr_90px]">
                <FormField
                  control={form.control}
                  name="endereco_cep"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CEP</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="00000-000"
                          className="font-mono"
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endereco_logradouro"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Logradouro</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endereco_numero"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Numero</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
                <FormField
                  control={form.control}
                  name="endereco_complemento"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Complemento</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endereco_bairro"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bairro</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_90px]">
                <FormField
                  control={form.control}
                  name="endereco_cidade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cidade</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endereco_uf"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>UF</FormLabel>
                      <FormControl>
                        <Input maxLength={2} className="uppercase" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CollapsibleSection>

            {/* ===== Dados pessoais (PF only, collapsible) ===== */}
            {tipo === "PF" && (
              <CollapsibleSection title="Dados pessoais" defaultOpen={false}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="rg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>RG</FormLabel>
                        <FormControl>
                          <Input className="font-mono" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="data_nascimento"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data de nascimento</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            className="font-mono"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="profissao"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Profissao</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="estado_civil"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estado civil</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nacionalidade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nacionalidade</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </CollapsibleSection>
            )}

            {/* ===== Observacao ===== */}
            <FormField
              control={form.control}
              name="observacao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observação</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Contexto relevante, preferencia de contato, notas internas…"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* ===== Erro de mutation ===== */}
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
                {isEdit ? "Salvar alteracoes" : "Criar cliente"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// --------------------------------------------------------------------------
// Colapsador via <details> — nativo, acessivel, zero dep
// --------------------------------------------------------------------------

function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-card border border-border bg-surface-alt"
    >
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
