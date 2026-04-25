import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  XCircle,
} from "lucide-react"
import {
  aprovarPendingEdit,
  fetchAuditLog,
  fetchConfig,
  fetchPendingEdits,
  fetchUsers,
  queryKeys,
  rejeitarPendingEdit,
  setConfig,
  updateUser,
} from "@/api/granola"
import type { AdminUser, AuditLogEntry, PendingEdit } from "@/types/domain"
import { useAuth } from "@/lib/auth-context"
import { useTheme } from "@/lib/theme"
import { formatDateTime, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ChangePasswordDialog } from "@/components/features/admin/ChangePasswordDialog"
import { OabsConfigEditor } from "@/components/features/admin/OabsConfigEditor"
import { UserFormDialog } from "@/components/features/admin/UserFormDialog"
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
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function ConfigPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const isMainAdmin = user?.username === "admin"
  const [searchParams, setSearchParams] = useSearchParams()
  const forceChange = searchParams.get("force-change") === "1"
  const [forcedDialogOpen, setForcedDialogOpen] = useState(forceChange)

  // Quando o usuario completa o force-change, limpamos o param da URL
  function handleForcedSuccess() {
    const params = new URLSearchParams(searchParams)
    params.delete("force-change")
    setSearchParams(params, { replace: true })
    setForcedDialogOpen(false)
  }

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
          Configurações
        </h1>
        <p className="font-display mt-1.5 text-base italic text-muted">
          conta, usuários e integrações
        </p>
      </header>

      {/* Banner de force-change: aparece se URL tem ?force-change=1 e o
          dialog foi dispensado. Cumpre WCAG 2.1.2 (Esc fecha o modal) sem
          perder o senso de obrigatoriedade — usuário fica preso em /config
          ate trocar a senha. */}
      {forceChange && !forcedDialogOpen && (
        <div className="mb-6 flex flex-col items-start gap-3 rounded-card border-l-4 border-erro bg-erro/8 px-5 py-4 sm:flex-row sm:items-center">
          <ShieldAlert className="h-5 w-5 shrink-0 text-erro" strokeWidth={1.75} />
          <div className="flex-1">
            <p className="font-sans text-[0.95rem] font-semibold text-foreground">
              Você precisa definir uma nova senha para continuar.
            </p>
            <p className="mt-0.5 text-[0.84rem] text-muted">
              O administrador resetou sua senha. Outras telas ficam bloqueadas
              até a troca ser feita.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setForcedDialogOpen(true)}
            className={cn(
              "bg-erro text-marfim hover:bg-erro/90 shrink-0",
            )}
          >
            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
            Definir agora
          </Button>
        </div>
      )}

      <Tabs defaultValue="conta">
        <TabsList>
          <TabsTrigger value="conta">Conta</TabsTrigger>
          {isAdmin && <TabsTrigger value="usuarios">Usuários</TabsTrigger>}
          {isAdmin && <TabsTrigger value="integracoes">Integrações</TabsTrigger>}
          {isAdmin && <TabsTrigger value="aprovacoes">Aprovações</TabsTrigger>}
          {isMainAdmin && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
        </TabsList>

        <TabsContent value="conta">
          <ContaTab />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="usuarios">
            <UsuariosTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="integracoes">
            <IntegracoesTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="aprovacoes">
            <AprovacoesTab />
          </TabsContent>
        )}
        {isMainAdmin && (
          <TabsContent value="audit">
            <AuditTab />
          </TabsContent>
        )}
      </Tabs>

      <ChangePasswordDialog
        open={forcedDialogOpen}
        onOpenChange={setForcedDialogOpen}
        forced
        onSuccess={handleForcedSuccess}
      />
    </div>
  )
}

// --------------------------------------------------------------------------
// TAB CONTA
// --------------------------------------------------------------------------

function ContaTab() {
  const { user } = useAuth()
  const { theme, toggle } = useTheme()
  const [showChange, setShowChange] = useState(false)

  return (
    <div className="space-y-4">
      <Card className="gap-0 rounded-card py-0">
        <div className="border-b border-border px-5 py-3">
          <div className="font-sans text-[0.95rem] font-semibold text-foreground">
            Sua conta
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
          <KV label="Nome" value={user?.display_name ?? "—"} />
          <KV label="Username" value={user?.username ?? "—"} mono />
          <KV label="Papel" value={user?.role ?? "—"} mono />
          <KV label="Ambiente" value={user?.ambiente ?? "—"} mono />
        </div>
      </Card>

      <Card className="gap-0 rounded-card py-0">
        <div className="flex items-center border-b border-border px-5 py-3">
          <div className="font-sans text-[0.95rem] font-semibold text-foreground">
            Senha
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
            onClick={() => setShowChange(true)}
          >
            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
            Mudar senha
          </Button>
        </div>
        <p className="px-5 py-4 text-[0.84rem] text-muted">
          Mínimo de 6 caracteres. Sem requisitos de complexidade.
        </p>
      </Card>

      <Card className="gap-0 rounded-card py-0">
        <div className="flex items-center border-b border-border px-5 py-3">
          <div className="font-sans text-[0.95rem] font-semibold text-foreground">
            Tema
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={toggle}
          >
            {theme === "dark" ? "Mudar pra claro" : "Mudar pra escuro"}
          </Button>
        </div>
        <p className="px-5 py-4 text-[0.84rem] text-muted">
          Tema atual: <strong className="text-foreground">{theme}</strong>. A
          escolha persiste no navegador.
        </p>
      </Card>

      <ChangePasswordDialog open={showChange} onOpenChange={setShowChange} />
    </div>
  )
}

function KV({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-foreground",
          mono && "tabular-nums font-mono text-[0.86rem]"
        )}
      >
        {value}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// TAB USUÁRIOS
// --------------------------------------------------------------------------

function UsuariosTab() {
  const { user: meUser } = useAuth()
  const isMainAdmin = meUser?.username === "admin"
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.users,
    queryFn: fetchUsers,
  })

  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [toggleTarget, setToggleTarget] = useState<AdminUser | null>(null)

  const toggleAtivoMutation = useMutation({
    mutationFn: (target: AdminUser) =>
      updateUser({ id: target.id, ativo: !(target.ativo === 1) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      setToggleTarget(null)
    },
  })

  const users = data?.users ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[0.84rem] text-muted">
          {isLoading
            ? "carregando…"
            : `${users.length} usuário${users.length === 1 ? "" : "s"} no sistema`}
        </p>
        <Button
          size="sm"
          onClick={() => setShowNew(true)}
          className={cn(
            "gap-1.5 bg-dourado text-tinta hover:bg-dourado-claro",
            "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Novo usuário
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden rounded-card py-0">
        {isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="px-5 py-4 text-sm text-erro">
            Não foi possível carregar usuários.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <Th>Usuário</Th>
                <Th>Papel</Th>
                <Th>Ambiente</Th>
                <Th>Status</Th>
                <Th>Último login</Th>
                <TableHead className="w-32 pr-5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  canEdit={isMainAdmin || u.username !== "admin"}
                  onEdit={() => setEditing(u)}
                  onToggleAtivo={() => setToggleTarget(u)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <UserFormDialog open={showNew} onOpenChange={setShowNew} />
      <UserFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        user={editing}
      />

      <AlertDialog
        open={toggleTarget !== null}
        onOpenChange={(o) => !o && setToggleTarget(null)}
      >
        <AlertDialogContent>
          {toggleTarget && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  {toggleTarget.ativo === 1 ? "Desativar" : "Reativar"}{" "}
                  {toggleTarget.username}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {toggleTarget.ativo === 1 ? (
                    <>
                      O usuário não conseguirá mais entrar. Histórico de
                      auditoria fica preservado.
                    </>
                  ) : (
                    <>O usuário volta a ter acesso normal ao sistema.</>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {toggleAtivoMutation.isError && (
                <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                  {toggleAtivoMutation.error instanceof Error
                    ? toggleAtivoMutation.error.message
                    : "Não foi possível concluir."}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={toggleAtivoMutation.isPending}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    toggleAtivoMutation.mutate(toggleTarget)
                  }}
                  disabled={toggleAtivoMutation.isPending}
                  className={cn(
                    toggleTarget.ativo === 1
                      ? "bg-erro text-marfim hover:bg-erro/90"
                      : "bg-dourado text-tinta hover:bg-dourado-claro"
                  )}
                >
                  {toggleAtivoMutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {toggleTarget.ativo === 1 ? "Desativar" : "Reativar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function UserRow({
  user,
  canEdit,
  onEdit,
  onToggleAtivo,
}: {
  user: AdminUser
  canEdit: boolean
  onEdit: () => void
  onToggleAtivo: () => void
}) {
  return (
    <TableRow
      className={cn(
        "border-border",
        user.ativo === 1 ? "" : "opacity-60"
      )}
    >
      <TableCell className="py-3 pl-5 pr-3">
        <div className="font-medium text-foreground">
          {user.display_name || user.username}
        </div>
        <div className="tabular-nums mt-0.5 font-mono text-[0.72rem] text-muted">
          {user.username}
          {user.username === "admin" && (
            <span className="ml-1.5 rounded-pill bg-dourado/15 px-1.5 py-0 text-[0.6rem] font-bold uppercase tracking-wider text-dourado">
              principal
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="py-3 px-3">
        <span className="rounded-pill bg-tinta/8 px-2 py-0.5 text-[0.7rem] font-medium text-tinta">
          {user.role}
        </span>
      </TableCell>
      <TableCell className="py-3 px-3 text-[0.84rem] text-foreground">
        {user.ambiente}
      </TableCell>
      <TableCell className="py-3 px-3">
        {user.ativo === 1 ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-sucesso/12 px-2 py-0.5 text-[0.7rem] font-semibold text-sucesso">
            <span className="h-1.5 w-1.5 rounded-full bg-sucesso" aria-hidden />
            ativo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-fumaca/12 px-2 py-0.5 text-[0.7rem] font-semibold text-fumaca">
            <span className="h-1.5 w-1.5 rounded-full bg-fumaca" aria-hidden />
            inativo
          </span>
        )}
      </TableCell>
      <TableCell className="tabular-nums py-3 px-3 font-mono text-[0.78rem] text-muted">
        {user.ultimo_login ? formatDateTime(user.ultimo_login) : "nunca"}
      </TableCell>
      <TableCell className="py-3 px-3 pr-5 text-right">
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canEdit}
            onClick={onEdit}
            className="h-7 px-2 text-[0.78rem]"
          >
            Editar
          </Button>
          {user.username !== "admin" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggleAtivo}
              className={cn(
                "h-7 px-2 text-[0.78rem]",
                user.ativo === 1 && "text-erro hover:bg-erro/10"
              )}
            >
              {user.ativo === 1 ? "Desativar" : "Reativar"}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

// --------------------------------------------------------------------------
// TAB INTEGRAÇÕES
// --------------------------------------------------------------------------

function IntegracoesTab() {
  return (
    <div className="space-y-4">
      <Card className="gap-0 rounded-card py-0">
        <div className="border-b border-border px-5 py-3">
          <div className="font-sans text-[0.95rem] font-semibold text-foreground">
            DataJud (CNJ)
          </div>
          <p className="mt-0.5 text-[0.78rem] text-muted">
            API key oficial da CNJ pra coleta de movimentações via{" "}
            <code className="font-mono text-[0.72rem]">/datajud/coletar</code>.
          </p>
        </div>
        <div className="px-5 py-4">
          <DatajudKeyEditor />
        </div>
      </Card>

      <Card className="gap-0 rounded-card py-0">
        <div className="border-b border-border px-5 py-3">
          <div className="font-sans text-[0.95rem] font-semibold text-foreground">
            DJEN (Diário de Justiça)
          </div>
          <p className="mt-0.5 text-[0.78rem] text-muted">
            OABs cadastradas pra coleta oficial de comunicações via DJEN/PCP. 1
            chamada por OAB traz todas as comunicações daquele advogado.
          </p>
        </div>
        <div className="px-5 py-4">
          <OabsConfigEditor />
        </div>
      </Card>
    </div>
  )
}

const DATAJUD_KEY = "datajud_api_key"

function DatajudKeyEditor() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.config(DATAJUD_KEY),
    queryFn: () => fetchConfig(DATAJUD_KEY),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Chave</Label>
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  return (
    <DatajudKeyInner key={data?.value ?? ""} initialValue={data?.value ?? ""} />
  )
}

function DatajudKeyInner({ initialValue }: { initialValue: string }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(initialValue)
  const [reveal, setReveal] = useState(false)
  const dirty = value !== initialValue

  const mutation = useMutation({
    mutationFn: () => setConfig(DATAJUD_KEY, value.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config(DATAJUD_KEY) })
    },
  })

  const masked = value
    ? reveal
      ? value
      : "•".repeat(Math.max(value.length - 4, 8)) + value.slice(-4)
    : ""

  return (
    <div className="space-y-2">
      <Label htmlFor="datajud-key">Chave</Label>
      <div className="flex items-center gap-2">
        <Input
          id="datajud-key"
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Cole aqui a chave do DataJud"
          className="font-mono"
        />
        {value && !dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Ocultar chave" : "Revelar chave"}
            className="h-9 w-9 p-0"
          >
            {reveal ? (
              <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </Button>
        )}
      </div>
      {value && !dirty && !reveal && (
        <p className="font-mono text-[0.7rem] text-muted">
          configurada · {masked}
        </p>
      )}
      {!value && (
        <p className="text-[0.78rem] text-erro">
          Não configurada. A coleta DataJud não vai funcionar até salvar uma chave.
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!dirty || mutation.isPending}
          className={cn(
            "gap-1.5 bg-dourado text-tinta hover:bg-dourado-claro",
            "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
          )}
        >
          {mutation.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {mutation.isSuccess && !dirty && (
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          Salvar chave
        </Button>
        <a
          href="https://datajud-wiki.cnj.jus.br/api-publica/acesso"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[0.78rem] text-dourado underline-offset-2 hover:underline"
        >
          Documentação CNJ →
        </a>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// TAB APROVAÇÕES
// --------------------------------------------------------------------------

function AprovacoesTab() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.pendingEdits,
    queryFn: fetchPendingEdits,
  })

  const aprovarMutation = useMutation({
    mutationFn: aprovarPendingEdit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingEdits })
    },
  })
  const rejeitarMutation = useMutation({
    mutationFn: rejeitarPendingEdit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingEdits })
    },
  })

  const edits = data?.edits ?? []

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <div className="border-b border-border px-5 py-3">
        <div className="font-sans text-[0.95rem] font-semibold text-foreground">
          Edições aguardando aprovação
        </div>
        <p className="mt-0.5 text-[0.78rem] text-muted">
          Mudanças em campos sensíveis (ex.: valor financeiro) feitas por usuários
          não-admin ficam pendentes até serem revisadas aqui.
        </p>
      </div>
      {isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="px-5 py-4 text-sm text-erro">
          Não foi possível carregar a lista.
        </p>
      ) : edits.length === 0 ? (
        <p className="px-5 py-8 text-center font-display italic text-base text-muted">
          Nenhuma edição pendente. Caixa de entrada limpa.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {edits.map((e) => (
            <PendingEditRow
              key={e.id}
              edit={e}
              onAprovar={() => aprovarMutation.mutate(e.id)}
              onRejeitar={() => rejeitarMutation.mutate(e.id)}
              pending={aprovarMutation.isPending || rejeitarMutation.isPending}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

function PendingEditRow({
  edit,
  onAprovar,
  onRejeitar,
  pending,
}: {
  edit: PendingEdit
  onAprovar: () => void
  onRejeitar: () => void
  pending: boolean
}) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <ShieldAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-alerta"
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <div className="font-sans text-[0.84rem] text-foreground">
          <strong className="text-foreground">{edit.username ?? "—"}</strong>{" "}
          quer alterar <code className="font-mono text-[0.72rem]">{edit.field}</code>{" "}
          em <span className="capitalize">{edit.entity_type}</span> #{edit.entity_id}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[0.78rem]">
          <span className="rounded-[3px] bg-erro/8 px-1.5 py-0 font-mono text-erro">
            {edit.old_value ?? "∅"}
          </span>
          <span className="text-muted">→</span>
          <span className="rounded-[3px] bg-sucesso/8 px-1.5 py-0 font-mono text-sucesso">
            {edit.new_value ?? "∅"}
          </span>
        </div>
        <div className="mt-0.5 tabular-nums font-mono text-[0.7rem] text-muted">
          {formatDateTime(edit.criado_em)}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onRejeitar}
          disabled={pending}
          className="h-7 gap-1 px-2 text-[0.78rem] text-erro hover:bg-erro/10"
        >
          <XCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          Rejeitar
        </Button>
        <Button
          size="sm"
          onClick={onAprovar}
          disabled={pending}
          className="h-7 gap-1 px-2 text-[0.78rem] bg-sucesso text-marfim hover:bg-sucesso/90"
        >
          <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          Aprovar
        </Button>
      </div>
    </li>
  )
}

// --------------------------------------------------------------------------
// TAB AUDIT LOG
// --------------------------------------------------------------------------

function AuditTab() {
  const [limite, setLimite] = useState(200)
  const [busca, setBusca] = useState("")
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.audit(limite),
    queryFn: () => fetchAuditLog(limite),
  })

  const logs = useMemo(() => data?.logs ?? [], [data])
  const filtrados = useMemo(() => {
    const buscaTrim = busca.trim().toLowerCase()
    if (!buscaTrim) return logs
    return logs.filter(
      (l) =>
        (l.action || "").toLowerCase().includes(buscaTrim) ||
        (l.username || "").toLowerCase().includes(buscaTrim) ||
        (l.entity_label || "").toLowerCase().includes(buscaTrim)
    )
  }, [logs, busca])

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div className="font-sans text-[0.95rem] font-semibold text-foreground">
          Log de auditoria
        </div>
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar ação, usuário, entidade…"
          className="h-8 w-[260px] text-xs"
        />
        <select
          value={limite}
          onChange={(e) => setLimite(parseInt(e.target.value, 10))}
          className={cn(
            "h-8 rounded-card border border-border bg-surface px-2 text-xs",
            "focus:outline-none focus:border-dourado"
          )}
        >
          <option value={100}>últimos 100</option>
          <option value={200}>últimos 200</option>
          <option value={500}>últimos 500</option>
          <option value={1000}>últimos 1000</option>
        </select>
        <span className="ml-auto tabular-nums font-mono text-[0.72rem] text-muted">
          {filtrados.length} registros
        </span>
      </div>
      {isLoading ? (
        <div className="space-y-1 p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="px-5 py-4 text-sm text-erro">
          Não foi possível carregar o log.
        </p>
      ) : filtrados.length === 0 ? (
        <p className="px-5 py-8 text-center font-display italic text-base text-muted">
          Nenhum registro nos critérios atuais.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <Th>Quando</Th>
              <Th>Quem</Th>
              <Th>Ação</Th>
              <Th>Entidade</Th>
              <Th>Detalhe</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.map((l) => (
              <AuditRow key={l.id} log={l} />
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

function AuditRow({ log }: { log: AuditLogEntry }) {
  return (
    <TableRow className="border-border">
      <TableCell className="tabular-nums py-2 pl-5 pr-3 font-mono text-[0.74rem] text-muted">
        {formatDateTime(log.criado_em)}
      </TableCell>
      <TableCell className="py-2 px-3 font-mono text-[0.78rem] text-foreground">
        {log.username ?? "—"}
      </TableCell>
      <TableCell className="py-2 px-3 font-mono text-[0.78rem] text-foreground">
        {log.action}
      </TableCell>
      <TableCell className="py-2 px-3 text-[0.78rem] text-muted">
        {log.entity_type ? (
          <>
            <span className="capitalize">{log.entity_type}</span>
            {log.entity_id ? ` #${log.entity_id}` : ""}
          </>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="py-2 px-3 pr-5 text-[0.78rem] text-foreground">
        {truncate(log.entity_label || log.details || "—", 60)}
      </TableCell>
    </TableRow>
  )
}

// --------------------------------------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
      {children}
    </TableHead>
  )
}
