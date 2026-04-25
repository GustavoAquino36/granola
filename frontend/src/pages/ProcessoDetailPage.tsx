import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
} from "lucide-react"
import {
  archiveProcesso,
  fetchProcessoById,
  queryKeys,
  unarchiveProcesso,
  updateProcessoStatus,
} from "@/api/granola"
import type { ProcessoDetail, Parte, Prazo } from "@/types/domain"
import {
  describeDeadline,
  formatBRL,
  formatCNJ,
  formatDate,
  formatOAB,
  truncate,
} from "@/lib/format"
import { cn } from "@/lib/utils"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { MovimentacoesCard } from "@/components/features/processos/MovimentacoesCard"
import { DocumentosCard } from "@/components/features/documentos/DocumentosCard"
import { FinanceiroCard } from "@/components/features/financeiro/FinanceiroCard"
import { ProcessoFormDialog } from "@/components/features/processos/ProcessoFormDialog"
import { ApiError } from "@/api/client"

export function ProcessoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const numId = Number(id)
  const valid = Number.isFinite(numId) && numId > 0
  const [showEditDialog, setShowEditDialog] = useState(false)
  /** Qual acao de confirmacao esta aberta (encerrar / arquivar / reativar). */
  const [confirm, setConfirm] = useState<null | "encerrar" | "arquivar" | "reativar">(
    null
  )

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.processo(numId),
    queryFn: () => fetchProcessoById(numId),
    enabled: valid,
  })

  const mutation = useMutation({
    mutationFn: async (action: "encerrar" | "arquivar" | "reativar" | string) => {
      if (action === "arquivar") return archiveProcesso(numId)
      if (action === "reativar") return unarchiveProcesso(numId)
      if (action === "encerrar") return updateProcessoStatus(numId, "encerrado")
      // Qualquer outra string = status direto (suspenso, ativo etc)
      return updateProcessoStatus(numId, action)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(numId) })
      queryClient.invalidateQueries({ queryKey: ["granola", "processos"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      setConfirm(null)
    },
  })

  if (!valid) {
    return (
      <div className="px-8 py-12 text-center">
        <p className="font-display text-xl italic text-muted">
          ID de processo inválido.
        </p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => navigate("/processos")}
        >
          Voltar pra lista
        </Button>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      <button
        type="button"
        onClick={() => navigate("/processos")}
        className="mb-5 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Processos
      </button>

      {isLoading ? (
        <DetailLoading />
      ) : isError || !data ? (
        <NotFoundOrError error={error} />
      ) : (
        <>
          <DetailHead
            processo={data}
            onEdit={() => setShowEditDialog(true)}
            onQuickStatus={(action) => {
              if (action === "encerrar" || action === "arquivar" || action === "reativar") {
                setConfirm(action)
              } else {
                mutation.mutate(action)
              }
            }}
            isUpdating={mutation.isPending}
          />

          <div className="mt-5">
            <MovimentacoesCard
              processoId={data.id}
              movimentacoes={data.movimentacoes}
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <PartesCard partes={data.partes} />
            <PrazosVinculadosCard prazos={data.prazos} />
          </div>

          <div className="mt-5">
            <FinanceiroCard
              lancamentos={data.financeiro ?? []}
              processoId={data.id}
              clienteId={data.cliente_id}
            />
          </div>

          <div className="mt-5">
            <DocumentosCard
              documentos={data.documentos ?? []}
              processoId={data.id}
              clienteId={data.cliente_id}
            />
          </div>

          <ProcessoFormDialog
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            processo={data}
          />

          <AlertDialog
            open={confirm !== null}
            onOpenChange={(open) => !open && setConfirm(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  {confirm === "encerrar" && "Encerrar este processo?"}
                  {confirm === "arquivar" && "Arquivar este processo?"}
                  {confirm === "reativar" && "Reativar este processo?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === "encerrar" && (
                    <>
                      O processo <strong>{data.titulo}</strong> sai de atendimento
                      ativo. Movimentações e prazos ficam preservados; você pode
                      reativar mudando o status depois.
                    </>
                  )}
                  {confirm === "arquivar" && (
                    <>
                      <strong>{data.titulo}</strong> sai da lista principal.
                      <strong> Nao e apagado</strong> — histórico, partes e documentos
                      ficam intactos. Pode reativar a qualquer momento.
                    </>
                  )}
                  {confirm === "reativar" && (
                    <>
                      Volta pra lista de processos ativos. Ele passa a receber
                      coletas DataJud e entra novamente em filtros de status.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {mutation.isError && (
                <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : "Não foi possível concluir."}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={mutation.isPending}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault()
                    if (confirm) mutation.mutate(confirm)
                  }}
                  disabled={mutation.isPending}
                  className={cn(
                    confirm === "reativar"
                      ? "bg-dourado text-tinta hover:bg-dourado-claro"
                      : "bg-erro text-marfim hover:bg-erro/90"
                  )}
                >
                  {mutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {confirm === "encerrar" && "Encerrar"}
                  {confirm === "arquivar" && "Arquivar"}
                  {confirm === "reativar" && "Reativar"}
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
// Not found / error elegante (404 ou outro)
// --------------------------------------------------------------------------

function NotFoundOrError({ error }: { error: Error | unknown | null }) {
  const navigate = useNavigate()
  const is404 = error instanceof ApiError && error.status === 404
  return (
    <div className="rounded-card border border-border bg-surface px-5 py-12 text-center">
      <p className="font-display italic text-lg text-muted">
        {is404
          ? "Processo não encontrado."
          : "Não foi possível carregar o processo."}
      </p>
      {is404 && (
        <p className="mt-2 text-sm text-muted">
          O processo pode ter sido excluído ou o link está incorreto.
        </p>
      )}
      {!is404 && error instanceof Error && (
        <p className="mt-2 font-mono text-[0.78rem] text-erro">{error.message}</p>
      )}
      <div className="mt-5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/processos")}
          className="gap-1.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Voltar pra lista
        </Button>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Detail head
// --------------------------------------------------------------------------

type QuickStatusAction =
  | "ativo"
  | "suspenso"
  | "encerrar"
  | "arquivar"
  | "reativar"

function DetailHead({
  processo,
  onEdit,
  onQuickStatus,
  isUpdating,
}: {
  processo: ProcessoDetail
  onEdit: () => void
  onQuickStatus: (action: QuickStatusAction) => void
  isUpdating: boolean
}) {
  const sigla = processoSigla(processo)
  const prazoAlarme = prazoMaisProximo(processo.prazos)
  const arquivado = processo.status === "arquivado"
  const encerrado = processo.status === "encerrado"

  return (
    <div
      className={cn(
        "flex flex-col items-start gap-5 rounded-card border border-border p-6 shadow-1 md:flex-row",
        "bg-gradient-to-b from-dourado/8 to-transparent"
      )}
    >
      <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full border border-dourado/30 bg-roxo text-marfim">
        <span className="tabular-nums font-mono text-sm font-semibold">
          {sigla}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[1.85rem] font-normal leading-[1.1] text-foreground">
          {processo.titulo || "Sem título"}
        </h1>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {prazoAlarme && (
            <Badge tone="fatal">
              Prazo {prazoAlarme.label} · {formatDate(prazoAlarme.data)}
            </Badge>
          )}
          {processo.vara && <Badge tone="neutro">{processo.vara}</Badge>}
          {processo.area && (
            <Badge tone="dourado">
              <span className="capitalize">{processo.area}</span>
            </Badge>
          )}
          {encerrado && <Badge tone="dourado">Encerrado</Badge>}
          {arquivado && <Badge tone="neutro">Arquivado</Badge>}
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem] text-muted">
          {processo.numero_cnj && (
            <Meta label="CNJ">
              <span className="tabular-nums font-mono text-foreground">
                {formatCNJ(processo.numero_cnj)}
              </span>
            </Meta>
          )}
          {processo.cliente && (
            <Meta label="Cliente">
              <Link
                to={`/clientes/${processo.cliente.id}`}
                className="text-foreground underline decoration-dourado/30 underline-offset-[3px] hover:decoration-dourado"
              >
                {processo.cliente.nome}
              </Link>
            </Meta>
          )}
          {processo.data_distribuicao && (
            <Meta label="Distribuido">
              <span className="tabular-nums font-mono text-foreground">
                {formatDate(processo.data_distribuicao)}
              </span>
            </Meta>
          )}
          {processo.polo && (
            <Meta label="Polo">
              <span className="capitalize text-foreground">{processo.polo}</span>
            </Meta>
          )}
          {processo.valor_causa > 0 && (
            <Meta label="Valor da causa">
              <span className="tabular-nums font-mono text-foreground">
                {formatBRL(processo.valor_causa)}
              </span>
            </Meta>
          )}
          {processo.numero_interno && (
            <Meta label="Interno">
              <span className="tabular-nums font-mono text-foreground">
                {processo.numero_interno}
              </span>
            </Meta>
          )}
        </dl>
      </div>

      <div className="flex shrink-0 gap-2 self-start">
        {processo.link_autos && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-card"
            asChild
          >
            <a href={processo.link_autos} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
              Abrir no e-SAJ
            </a>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-card"
          onClick={onEdit}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Editar
        </Button>
        <StatusActions
          processo={processo}
          onQuickStatus={onQuickStatus}
          isUpdating={isUpdating}
        />
      </div>
    </div>
  )
}

function StatusActions({
  processo,
  onQuickStatus,
  isUpdating,
}: {
  processo: ProcessoDetail
  onQuickStatus: (a: QuickStatusAction) => void
  isUpdating: boolean
}) {
  const arquivado = processo.status === "arquivado"
  const encerrado = processo.status === "encerrado"
  const suspenso = processo.status === "suspenso"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-card"
          disabled={isUpdating}
        >
          {isUpdating ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          ) : null}
          Status
          <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel className="font-sans text-[0.68rem] uppercase tracking-wider text-muted">
          Mudar status
        </DropdownMenuLabel>
        {!arquivado && (
          <>
            {(encerrado || suspenso) && (
              <DropdownMenuItem onClick={() => onQuickStatus("ativo")}>
                <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                Marcar em andamento
              </DropdownMenuItem>
            )}
            {!suspenso && !encerrado && (
              <DropdownMenuItem onClick={() => onQuickStatus("suspenso")}>
                <PauseCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                Suspender
              </DropdownMenuItem>
            )}
            {!encerrado && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onQuickStatus("encerrar")}
              >
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Encerrar
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        {arquivado ? (
          <DropdownMenuItem onClick={() => onQuickStatus("reativar")}>
            <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.75} />
            Reativar (tira do arquivo)
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onQuickStatus("arquivar")}
          >
            <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
            Arquivar
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Meta({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="font-semibold text-foreground">{label}</dt>
      <dd className="inline">{children}</dd>
    </div>
  )
}

type Tone = "fatal" | "neutro" | "dourado" | "ok"

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const map: Record<Tone, { bg: string; fg: string; dot: string }> = {
    fatal: { bg: "bg-erro/12", fg: "text-erro", dot: "bg-erro" },
    neutro: { bg: "bg-fumaca/14", fg: "text-fumaca", dot: "bg-fumaca" },
    dourado: { bg: "bg-dourado/16", fg: "text-[#9a7a40]", dot: "bg-dourado" },
    ok: { bg: "bg-sucesso/12", fg: "text-sucesso", dot: "bg-sucesso" },
  }
  const s = map[tone]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-[0.7rem] font-semibold",
        s.bg,
        s.fg
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {children}
    </span>
  )
}

/** Monograma do processo: usa tipo/area ou "P" como fallback. */
function processoSigla(p: ProcessoDetail): string {
  const ft = (p.area || "").toUpperCase()
  if (ft.startsWith("TRAB")) return "TR"
  if (ft.startsWith("CIV")) return "CV"
  if (ft.startsWith("TRIB")) return "TB"
  if (ft.startsWith("EMP")) return "EM"
  if (ft.startsWith("CON")) return "CS"
  if (p.tribunal) return p.tribunal.slice(0, 2).toUpperCase()
  return "P"
}

/** Retorna o prazo pendente mais proximo (se <= 7 dias) com label curta. */
function prazoMaisProximo(prazos: Prazo[]): { data: string; label: string } | null {
  const pendentes = prazos
    .filter((p) => p.status === "pendente")
    .map((p) => ({ prazo: p, d: describeDeadline(p.data_vencimento) }))
    .filter((x) => x.d.status !== "ok")
    .sort((a, b) => a.d.daysDelta - b.d.daysDelta)

  if (pendentes.length === 0) return null

  const first = pendentes[0]
  const label =
    first.d.status === "vencido"
      ? "vencido"
      : first.d.status === "hoje"
        ? "hoje"
        : first.d.status === "urgente"
          ? "urgente"
          : "proximo"
  return { data: first.prazo.data_vencimento, label }
}

// --------------------------------------------------------------------------
// Card de partes
// --------------------------------------------------------------------------

function PartesCard({ partes }: { partes: Parte[] }) {
  const ativos = partes.filter(
    (p) => (p.polo || "").toLowerCase() === "ativo"
  )
  const passivos = partes.filter(
    (p) => (p.polo || "").toLowerCase() === "passivo"
  )
  const outros = partes.filter(
    (p) => !["ativo", "passivo"].includes((p.polo || "").toLowerCase())
  )

  return (
    <Card className="gap-0 rounded-card py-0">
      <CardHeader className="border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold">
          Partes
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-4">
        {partes.length === 0 ? (
          <p className="font-display italic text-muted text-base">
            Nenhuma parte cadastrada ainda.
          </p>
        ) : (
          <div className="space-y-4">
            {ativos.length > 0 && (
              <ParteGrupo titulo="Polo ativo" partes={ativos} />
            )}
            {passivos.length > 0 && (
              <ParteGrupo titulo="Polo passivo" partes={passivos} />
            )}
            {outros.length > 0 && (
              <ParteGrupo titulo="Outros" partes={outros} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ParteGrupo({ titulo, partes }: { titulo: string; partes: Parte[] }) {
  return (
    <div>
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted">
        {titulo}
      </div>
      <div className="mt-2 space-y-3">
        {partes.map((p) => (
          <div key={p.id}>
            <div className="font-sans text-[0.9375rem] font-medium text-foreground">
              {p.nome}
            </div>
            {p.cpf_cnpj && (
              <div className="mt-0.5 tabular-nums font-mono text-[0.78rem] text-muted">
                {p.cpf_cnpj}
              </div>
            )}
            {(p.advogado || p.oab) && (
              <div className="mt-0.5 text-[0.78rem] text-muted">
                Adv:{" "}
                <span className="text-foreground">
                  {p.advogado || "—"}
                </span>
                {p.oab && (
                  <>
                    {" · "}
                    <span className="tabular-nums font-mono">
                      {formatOAB(p.oab)}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Card de prazos vinculados
// --------------------------------------------------------------------------

function PrazosVinculadosCard({
  prazos,
}: {
  prazos: Prazo[]
}) {
  const pendentes = prazos.filter((p) => p.status === "pendente")
  const concluidos = prazos.filter((p) => p.status === "concluido").length

  return (
    <Card className="gap-0 rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold">
          Prazos vinculados
        </CardTitle>
        <span className="ml-auto text-[0.72rem] text-muted">
          {pendentes.length} pendente{pendentes.length === 1 ? "" : "s"}
          {concluidos > 0 ? ` · ${concluidos} concluido${concluidos === 1 ? "" : "s"}` : ""}
        </span>
      </CardHeader>
      <CardContent className="px-0 py-0">
        {pendentes.length === 0 ? (
          <p className="font-display italic text-muted text-base px-5 py-6">
            Nenhum prazo pendente neste processo.
          </p>
        ) : (
          <ul>
            {pendentes.slice(0, 4).map((p) => (
              <PrazoLi key={p.id} prazo={p} />
            ))}
            {pendentes.length > 4 && (
              <li className="border-t border-border px-5 py-2.5 text-center">
                <Link
                  to="/prazos"
                  className="text-[0.8125rem] font-medium text-dourado underline-offset-4 hover:underline"
                >
                  Ver todos os {pendentes.length} prazos
                </Link>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function PrazoLi({ prazo }: { prazo: Prazo }) {
  const d = describeDeadline(prazo.data_vencimento)
  const tone =
    d.status === "vencido" || d.status === "hoje" || d.status === "urgente"
      ? "fatal"
      : d.status === "proximo"
        ? "warn"
        : "ok"
  return (
    <li className="border-b border-border px-5 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-sans text-sm font-medium text-foreground">
            {truncate(prazo.titulo, 60)}
          </div>
          <div className="mt-0.5 tabular-nums font-mono text-[0.72rem] text-muted">
            {formatDate(prazo.data_vencimento)} · {d.label}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-pill px-2 py-[2px] text-[0.65rem] font-semibold",
            tone === "fatal"
              ? "bg-erro/12 text-erro"
              : tone === "warn"
                ? "bg-alerta/12 text-alerta"
                : "bg-sucesso/12 text-sucesso"
          )}
        >
          {prazo.prioridade}
        </span>
      </div>
    </li>
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
          <Skeleton className="h-8 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-24 rounded-pill" />
            <Skeleton className="h-5 w-32 rounded-pill" />
            <Skeleton className="h-5 w-20 rounded-pill" />
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
      <Skeleton className="mt-5 h-24 rounded-card" />
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </>
  )
}
