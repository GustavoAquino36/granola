import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
} from "lucide-react"
import {
  archiveCliente,
  fetchClienteById,
  queryKeys,
  unarchiveCliente,
} from "@/api/granola"
import type { ClienteDetail, ClienteProcessoSummary } from "@/types/domain"
import { formatBRL, formatCpfCnpj, initialsFrom, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ClienteFormDialog } from "@/components/features/clientes/ClienteFormDialog"
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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const numId = Number(id)
  const valid = Number.isFinite(numId) && numId > 0
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.cliente(numId),
    queryFn: () => fetchClienteById(numId),
    enabled: valid,
  })

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Cliente não carregado")
      return data.ativo === 1
        ? archiveCliente(data.id)
        : unarchiveCliente(data.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "clientes"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.cliente(numId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      setShowArchiveDialog(false)
    },
  })

  if (!valid) {
    return (
      <div className="px-8 py-12 text-center">
        <p className="font-display text-xl italic text-muted">
          ID de cliente invalido.
        </p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => navigate("/clientes")}
        >
          Voltar pra lista
        </Button>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      {/* Breadcrumb up */}
      <button
        type="button"
        onClick={() => navigate("/clientes")}
        className="mb-5 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Clientes
      </button>

      {isLoading ? (
        <DetailLoading />
      ) : isError || !data ? (
        <div className="rounded-card border border-erro/20 bg-erro/5 px-4 py-6 text-sm text-erro">
          {error instanceof Error
            ? error.message
            : "Não foi possível carregar o cliente."}
        </div>
      ) : (
        <>
          <DetailHead
            cliente={data}
            onEdit={() => setShowEditDialog(true)}
            onToggleArchive={() => setShowArchiveDialog(true)}
          />

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <ResumoFinanceiroCard cliente={data} />
            <ProcessosVinculadosCard cliente={data} />
            <UltimaInteracaoCard cliente={data} />
          </div>

          <ClienteFormDialog
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            cliente={data}
          />

          <AlertDialog
            open={showArchiveDialog}
            onOpenChange={setShowArchiveDialog}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  {data.ativo === 1
                    ? "Arquivar este cliente?"
                    : "Reativar este cliente?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {data.ativo === 1 ? (
                    <>
                      O cliente <strong>{data.nome}</strong> deixa de aparecer
                      na lista de ativos, mas <strong>não é apagado</strong>.
                      Processos e historico permanecem intactos. Voce pode
                      reativar a qualquer momento em <em>Arquivados</em>.
                    </>
                  ) : (
                    <>
                      O cliente <strong>{data.nome}</strong> volta pra lista
                      de ativos e pode receber novos processos e lancamentos
                      normalmente.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {archiveMutation.isError && (
                <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                  {archiveMutation.error instanceof Error
                    ? archiveMutation.error.message
                    : "Não foi possível concluir."}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={archiveMutation.isPending}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    archiveMutation.mutate()
                  }}
                  disabled={archiveMutation.isPending}
                  className={cn(
                    data.ativo === 1
                      ? "bg-erro text-marfim hover:bg-erro/90"
                      : "bg-dourado text-tinta hover:bg-dourado-claro"
                  )}
                >
                  {archiveMutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {data.ativo === 1 ? "Arquivar" : "Reativar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// Detail head — avatar + nome + tags + meta + actions
// --------------------------------------------------------------------------

function DetailHead({
  cliente,
  onEdit,
  onToggleArchive,
}: {
  cliente: ClienteDetail
  onEdit: () => void
  onToggleArchive: () => void
}) {
  const inativo = cliente.ativo === 0
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-5 rounded-card border border-border p-6 shadow-1 md:flex-row",
        "bg-gradient-to-b from-dourado/8 to-transparent"
      )}
    >
      {/* Avatar */}
      <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full border border-dourado/30 bg-roxo text-marfim">
        <span className="font-display text-2xl font-medium">
          {initialsFrom(cliente.nome)}
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-3xl font-normal leading-[1.1] text-foreground">
          {cliente.nome}
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge ativo={!inativo} tipo={cliente.tipo} />
          {inativo && (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-fumaca/12 px-2.5 py-1 text-[0.7rem] font-semibold text-fumaca">
              <span className="h-1.5 w-1.5 rounded-full bg-fumaca" aria-hidden />
              Arquivado
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem] text-muted">
          {cliente.email && (
            <MetaItem Icon={Mail}>{cliente.email}</MetaItem>
          )}
          {cliente.telefone && (
            <MetaItem Icon={Phone} mono>
              {cliente.telefone}
            </MetaItem>
          )}
          {cliente.cpf_cnpj && (
            <MetaItem>
              <span className="font-semibold text-foreground">
                {cliente.tipo === "PJ" ? "CNPJ" : "CPF"}
              </span>{" "}
              <span className="tabular-nums font-mono">
                {formatCpfCnpj(cliente.cpf_cnpj)}
              </span>
            </MetaItem>
          )}
          {cliente.endereco_cidade && (
            <MetaItem Icon={MapPin}>
              {cliente.endereco_cidade}
              {cliente.endereco_uf ? ` · ${cliente.endereco_uf}` : ""}
            </MetaItem>
          )}
          <MetaItem>
            <span className="font-semibold text-foreground">ID</span>{" "}
            <span className="tabular-nums font-mono">
              GNL-{String(cliente.id).padStart(6, "0")}
            </span>
          </MetaItem>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 gap-2 self-start">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-card"
          onClick={onEdit}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Editar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "gap-1.5 rounded-card",
            inativo
              ? "text-sucesso hover:bg-sucesso/10 hover:text-sucesso"
              : "text-muted hover:bg-erro/10 hover:text-erro"
          )}
          onClick={onToggleArchive}
        >
          {inativo ? (
            <ArchiveRestore className="h-3 w-3" strokeWidth={1.75} />
          ) : (
            <Archive className="h-3 w-3" strokeWidth={1.75} />
          )}
          {inativo ? "Reativar" : "Arquivar"}
        </Button>
      </div>
    </div>
  )
}

function StatusBadge({ ativo, tipo }: { ativo: boolean; tipo: string }) {
  return (
    <>
      {ativo && (
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-sucesso/12 px-2.5 py-1 text-[0.7rem] font-semibold text-sucesso">
          <span className="h-1.5 w-1.5 rounded-full bg-sucesso" aria-hidden />
          Ativo
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-dourado/16 px-2.5 py-1 text-[0.7rem] font-semibold text-dourado">
        <span className="h-1.5 w-1.5 rounded-full bg-dourado" aria-hidden />
        {tipo === "PJ" ? "Pessoa jurídica" : "Pessoa física"}
      </span>
    </>
  )
}

function MetaItem({
  Icon,
  mono,
  children,
}: {
  Icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  mono?: boolean
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />}
      <span className={mono ? "tabular-nums font-mono" : undefined}>
        {children}
      </span>
    </span>
  )
}

// --------------------------------------------------------------------------
// Card 1 — Resumo financeiro
// --------------------------------------------------------------------------

function ResumoFinanceiroCard({ cliente }: { cliente: ClienteDetail }) {
  const f = cliente.financeiro_resumo
  const empty =
    f.receitas === 0 && f.despesas === 0 && f.pendentes === 0

  return (
    <Card className="gap-0 rounded-card py-0">
      <CardHeader className="border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold">
          Resumo financeiro
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-4">
        {empty ? (
          <p className="font-display italic text-muted text-base">
            Sem lançamentos ainda.
          </p>
        ) : (
          <>
            <Row label="Receitas" value={formatBRL(f.receitas)} tone="default" />
            <Row
              label="Despesas"
              value={formatBRL(f.despesas)}
              tone={f.despesas > 0 ? "muted" : "default"}
            />
            <Row
              label="Pendentes"
              value={formatBRL(f.pendentes)}
              tone={f.pendentes > 0 ? "warn" : "default"}
              divider
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  value,
  tone = "default",
  divider,
}: {
  label: string
  value: string
  tone?: "default" | "muted" | "warn"
  divider?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-2.5",
        divider && "mt-1 border-t border-border pt-3.5"
      )}
    >
      <span className="text-[0.8125rem] text-muted">{label}</span>
      <span
        className={cn(
          "tabular-nums font-mono text-[0.9375rem] font-medium",
          tone === "warn" ? "text-alerta" : tone === "muted" ? "text-muted" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  )
}

// --------------------------------------------------------------------------
// Card 2 — Processos vinculados
// --------------------------------------------------------------------------

function ProcessosVinculadosCard({ cliente }: { cliente: ClienteDetail }) {
  const total = cliente.total_processos
  const processos = cliente.processos ?? []

  return (
    <Card className="gap-0 rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold">
          Processos vinculados
        </CardTitle>
        <span className="ml-auto text-[0.72rem] text-muted">
          {total} no total
        </span>
      </CardHeader>
      <CardContent className="px-0 py-0">
        {processos.length === 0 ? (
          <p className="font-display italic text-muted text-base px-5 py-6">
            Nenhum processo cadastrado pra este cliente.
          </p>
        ) : (
          <ul>
            {processos.slice(0, 5).map((p) => (
              <ProcessoLi key={p.id} processo={p} />
            ))}
            {total > 5 && (
              <li className="border-t border-border px-5 py-2.5 text-center">
                <Link
                  to={`/processos?cliente=${cliente.id}`}
                  className="text-[0.8125rem] font-medium text-dourado underline-offset-4 hover:underline"
                >
                  Ver todos os {total} processos
                </Link>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ProcessoLi({ processo }: { processo: ClienteProcessoSummary }) {
  return (
    <li className="border-b border-border px-5 py-2.5 last:border-b-0">
      <Link
        to={`/processos/${processo.id}`}
        className="block transition-colors hover:bg-dourado/5"
      >
        <div className="font-sans text-sm font-medium text-foreground">
          {truncate(processo.titulo ?? "Sem título", 38)}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[0.72rem] text-muted">
          <span className="capitalize">{processo.area || "—"}</span>
          <span>·</span>
          <span className="capitalize">{processo.status || "—"}</span>
          {processo.valor_causa > 0 && (
            <>
              <span>·</span>
              <span className="tabular-nums font-mono">
                {formatBRL(processo.valor_causa)}
              </span>
            </>
          )}
        </div>
      </Link>
    </li>
  )
}

// --------------------------------------------------------------------------
// Card 3 — Ultima interação (stub honesto)
// --------------------------------------------------------------------------

function UltimaInteracaoCard({ cliente }: { cliente: ClienteDetail }) {
  return (
    <Card className="gap-0 rounded-card py-0">
      <CardHeader className="border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold">
          Notas e observações
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-4">
        {cliente.observacao ? (
          <p className="text-[0.875rem] leading-relaxed text-foreground">
            {cliente.observacao}
          </p>
        ) : (
          <p className="font-display italic text-muted text-base">
            Sem observações registradas. Use o botão Editar pra adicionar contexto.
          </p>
        )}
        {cliente.profissao && (
          <p className="mt-4 border-t border-border pt-3 text-[0.8125rem] text-muted">
            <span className="font-semibold text-foreground">Profissão:</span>{" "}
            {cliente.profissao}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------------------------
// Loading
// --------------------------------------------------------------------------

function DetailLoading() {
  return (
    <>
      <div className="flex items-start gap-5 rounded-card border border-border p-6">
        <Skeleton className="h-[54px] w-[54px] rounded-full" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-40" />
          <div className="flex gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-card" />
        ))}
      </div>
    </>
  )
}
