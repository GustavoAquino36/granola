import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { createUser, queryKeys, updateUser } from "@/api/granola"
import type { AdminUser, UserRole } from "@/types/domain"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Tudo, inclusive gestão de usuários" },
  { value: "advogado", label: "Advogado", hint: "Acesso completo ao trabalho jurídico" },
  { value: "operador_granola", label: "Operador", hint: "CRUD comum, sem admin" },
  { value: "estagiario", label: "Estagiário", hint: "Pode editar dados, registra auditoria" },
  { value: "leitor", label: "Leitor", hint: "Somente leitura" },
]

const createSchema = z.object({
  username: z.string().trim().min(2, "Mínimo 2 caracteres.").max(40),
  display_name: z.string().trim().optional(),
  role: z.string().min(1),
  ambiente: z.string().min(1),
  password: z.string().min(6, "Senha precisa de no mínimo 6 caracteres."),
})

const updateSchema = z.object({
  username: z.string().trim().min(2).max(40),
  display_name: z.string().trim().optional(),
  role: z.string().min(1),
  ambiente: z.string().min(1),
  ativo: z.boolean(),
  /** Opcional: reset de senha pelo admin. Vazio = não muda. */
  new_password: z
    .string()
    .optional()
    .refine((v) => !v || v.length >= 6, {
      message: "Nova senha precisa de no mínimo 6 caracteres.",
    }),
})

interface UserFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Em modo edit. */
  user?: AdminUser | null
  onSaved?: () => void
}

export function UserFormDialog(props: UserFormDialogProps) {
  const { open, onOpenChange, user } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        {open && <UserFormInner key={user?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function UserFormInner({ onOpenChange, user, onSaved }: UserFormDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(user)
  const isAdminUsername = user?.username === "admin"

  if (isEdit && user) {
    return (
      <UpdateForm
        user={user}
        isAdminUsername={isAdminUsername}
        onClose={() => onOpenChange(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.users })
          onSaved?.()
          onOpenChange(false)
        }}
      />
    )
  }

  return (
    <CreateForm
      onClose={() => onOpenChange(false)}
      onSaved={() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.users })
        onSaved?.()
        onOpenChange(false)
      }}
    />
  )
}

// --------------------------------------------------------------------------

function CreateForm({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  type Values = z.infer<typeof createSchema>
  const form = useForm<Values>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      username: "",
      display_name: "",
      role: "operador_granola",
      ambiente: "granola",
      password: "",
    },
  })

  const mutation = useMutation({
    mutationFn: (values: Values) =>
      createUser({
        username: values.username,
        password: values.password,
        display_name: values.display_name || undefined,
        role: values.role,
        ambiente: values.ambiente,
      }),
    onSuccess: () => onSaved(),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">
          Novo usuário
        </DialogTitle>
        <DialogDescription>
          Senha inicial será comunicada manualmente. O usuário pode trocá-la em
          Configurações &gt; Conta depois do primeiro login.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="space-y-3"
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <FormControl>
                  <Input
                    placeholder="ex.: lucas, ana.estag"
                    autoFocus
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="display_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome de exibição</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Ex.: Lucas Munhoz, Ana Silva"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Papel</FormLabel>
                <RoleSelect value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Senha inicial</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Mínimo 6 caracteres"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {mutation.isError && (
            <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Não foi possível criar o usuário."}
            </p>
          )}

          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
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
              Criar usuário
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}

// --------------------------------------------------------------------------

function UpdateForm({
  user,
  isAdminUsername,
  onClose,
  onSaved,
}: {
  user: AdminUser
  isAdminUsername: boolean
  onClose: () => void
  onSaved: () => void
}) {
  type Values = z.infer<typeof updateSchema>
  const form = useForm<Values>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      username: user.username,
      display_name: user.display_name ?? "",
      role: user.role,
      ambiente: user.ambiente,
      ativo: user.ativo === 1,
      new_password: "",
    },
  })

  const mutation = useMutation({
    mutationFn: (values: Values) =>
      updateUser({
        id: user.id,
        display_name: values.display_name,
        role: values.role,
        ambiente: values.ambiente,
        ativo: values.ativo,
        new_password: values.new_password || undefined,
      }),
    onSuccess: () => onSaved(),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">
          Editar usuário · {user.username}
        </DialogTitle>
        <DialogDescription>
          {isAdminUsername ? (
            <>
              Conta <strong>admin</strong> tem proteções: não pode ser desativada,
              o papel é fixo, e só o próprio admin principal pode editá-la.
            </>
          ) : (
            <>
              Reset de senha aqui marca <code className="font-mono text-[0.72rem]">must_change_password=0</code> —
              o usuário pode trocar depois.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="space-y-3"
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username (não pode ser alterado)</FormLabel>
                <FormControl>
                  <Input disabled {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="display_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome de exibição</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Papel</FormLabel>
                <RoleSelect
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isAdminUsername}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ativo"
            render={({ field }) => (
              <FormItem
                className={cn(
                  "flex items-center gap-2.5 rounded-card border border-border bg-surface-alt px-4 py-3",
                  isAdminUsername && "opacity-60"
                )}
              >
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    disabled={isAdminUsername}
                    className="h-4 w-4 cursor-pointer accent-dourado"
                  />
                </FormControl>
                <div className="flex-1">
                  <Label className="cursor-pointer">Ativo</Label>
                  <p className="text-[0.72rem] text-muted">
                    {isAdminUsername
                      ? "A conta admin não pode ser desativada."
                      : "Desmarque pra revogar acesso sem apagar o histórico de auditoria."}
                  </p>
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="new_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reset de senha (opcional)</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Deixe vazio pra manter a atual"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {mutation.isError && (
            <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Não foi possível atualizar."}
            </p>
          )}

          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
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
              Salvar alterações
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}

// --------------------------------------------------------------------------

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const opt = ROLES.find((r) => r.value === value)
  return (
    <>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {opt && (
        <p className="mt-1 text-[0.72rem] text-muted">{opt.hint}</p>
      )}
    </>
  )
}
