import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import {
  deleteDocumento,
  fetchDocumentos,
  queryKeys,
} from "@/api/granola"
import type { Documento, TipoDocumento } from "@/types/domain"
import { useAuth } from "@/lib/auth-context"
import { formatDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DocumentoUploadDialog } from "@/components/features/documentos/DocumentoUploadDialog"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const TIPO_FILTROS: { key: "todos" | TipoDocumento; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "peticao", label: "Petição" },
  { key: "contrato", label: "Contrato" },
  { key: "procuracao", label: "Procuração" },
  { key: "decisao", label: "Decisão" },
  { key: "sentenca", label: "Sentença" },
  { key: "comprovante", label: "Comprovante" },
  { key: "outro", label: "Outro" },
]

export function DocumentosPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const [busca, setBusca] = useState("")
  const [tipoFiltro, setTipoFiltro] =
    useState<"todos" | TipoDocumento>("todos")
  const [showUpload, setShowUpload] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Documento | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.documentos({}),
    queryFn: () => fetchDocumentos({}),
  })

  const todos = useMemo(() => data?.documentos ?? [], [data])
  const filtrados = useMemo(() => {
    const buscaTrim = busca.trim().toLowerCase()
    return todos.filter((d) => {
      if (tipoFiltro !== "todos" && d.tipo !== tipoFiltro) return false
      if (!buscaTrim) return true
      return (
        d.nome.toLowerCase().includes(buscaTrim) ||
        (d.observacao ?? "").toLowerCase().includes(buscaTrim)
      )
    })
  }, [todos, busca, tipoFiltro])

  const deleteMutation = useMutation({
    mutationFn: (target: Documento) => deleteDocumento(target.id),
    onSuccess: (_data, target) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "documentos"] })
      if (target.processo_id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.processo(target.processo_id),
        })
      }
      setDeleteTarget(null)
    },
  })

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      <header className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Documentos
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading ? "carregando…" : summaryLabel(filtrados.length)}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            size="default"
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
            onClick={() => setShowUpload(true)}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            Enviar documento
          </Button>
        </div>
      </header>

      <Card className="gap-0 overflow-hidden rounded-card py-0">
        <CardHeader className="flex items-center gap-3 border-b border-border px-5 py-3">
          <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
            Acervo
          </CardTitle>
          <CardAction className="min-w-0 w-full max-w-[320px] md:w-[280px]">
            <div
              className={cn(
                "flex items-center gap-2 rounded-pill border border-border bg-surface-alt px-3 py-1.5 text-muted transition-all",
                "focus-within:border-dourado focus-within:bg-surface"
              )}
            >
              <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, observação…"
                className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
          </CardAction>
        </CardHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-alt px-5 py-2.5">
          <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Tipo
          </span>
          {TIPO_FILTROS.map((t) => (
            <FilterChip
              key={t.key}
              active={tipoFiltro === t.key}
              onClick={() => setTipoFiltro(t.key)}
            >
              {t.label}
            </FilterChip>
          ))}
        </div>

        {isLoading ? (
          <DocumentosLoading />
        ) : isError ? (
          <div className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 mx-5 my-4 text-sm text-erro">
            Não foi possível carregar os documentos.
          </div>
        ) : filtrados.length === 0 ? (
          <EmptyState busca={busca} tipo={tipoFiltro} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <Th>Documento</Th>
                <Th>Tipo</Th>
                <Th>Tamanho</Th>
                <Th>Enviado</Th>
                <TableHead className="py-2.5 pl-3 pr-5 w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((d) => (
                <DocumentoRow
                  key={d.id}
                  doc={d}
                  isAdmin={isAdmin}
                  onOpenProcesso={() => {
                    if (d.processo_id) navigate(`/processos/${d.processo_id}`)
                  }}
                  onDelete={() => setDeleteTarget(d)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <DocumentoUploadDialog open={showUpload} onOpenChange={setShowUpload} />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          {deleteTarget && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  Excluir este documento?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <strong>{deleteTarget.nome}</strong> será removido do banco e
                  o arquivo apagado de{" "}
                  <code className="font-mono text-[0.75rem]">
                    granola/data/uploads/
                  </code>
                  . Essa ação não pode ser desfeita.
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
    </div>
  )
}

// --------------------------------------------------------------------------

function DocumentoRow({
  doc,
  isAdmin,
  onOpenProcesso,
  onDelete,
}: {
  doc: Documento
  isAdmin: boolean
  onOpenProcesso: () => void
  onDelete: () => void
}) {
  const linkable = Boolean(doc.processo_id)
  const downloadHref = `/uploads/${doc.caminho}`
  return (
    <TableRow
      className={cn(
        "border-border",
        linkable && "cursor-pointer hover:bg-dourado/5"
      )}
      onClick={linkable ? onOpenProcesso : undefined}
    >
      <TableCell className="py-3 pl-5 pr-3">
        <div className="flex items-start gap-2">
          <FileText
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {truncate(doc.nome, 60)}
            </div>
            {doc.observacao && (
              <div className="mt-0.5 text-[0.72rem] text-muted">
                {truncate(doc.observacao, 80)}
              </div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="py-3 px-3">
        <span className="capitalize rounded-pill bg-tinta/8 px-2 py-0.5 text-[0.7rem] font-medium text-tinta">
          {doc.tipo}
        </span>
      </TableCell>
      <TableCell className="tabular-nums py-3 px-3 font-mono text-[0.78rem] text-foreground">
        {formatBytes(doc.tamanho_bytes)}
      </TableCell>
      <TableCell className="py-3 px-3">
        <span className="tabular-nums font-mono text-[0.75rem] text-muted">
          {formatDate(doc.criado_em)}
        </span>
      </TableCell>
      <TableCell className="py-3 pl-3 pr-5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Mais ações"
              onClick={(e) => e.stopPropagation()}
              className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem asChild>
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                download={doc.nome}
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                Baixar / abrir
              </a>
            </DropdownMenuItem>
            {linkable && (
              <DropdownMenuItem onClick={onOpenProcesso}>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                Abrir processo
              </DropdownMenuItem>
            )}
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-pill border px-3 py-1 text-[0.78rem] font-medium transition-colors duration-[180ms]",
        active
          ? "border-tinta bg-tinta text-marfim"
          : "border-border-strong bg-surface text-foreground hover:border-dourado"
      )}
    >
      {children}
    </button>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="py-2.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted">
      {children}
    </TableHead>
  )
}

function DocumentosLoading() {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2fr_0.8fr_0.6fr_0.8fr_0.2fr] gap-3"
        >
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-5 w-20 rounded-pill" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-7 rounded-pill justify-self-end" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  busca,
  tipo,
}: {
  busca: string
  tipo: "todos" | TipoDocumento
}) {
  return (
    <div className="px-5 py-12 text-center">
      <FileText
        className="mx-auto mb-4 h-8 w-8 text-muted/60"
        strokeWidth={1.5}
      />
      <p className="font-display italic text-lg text-muted">
        {busca
          ? "Nenhum documento encontrado para essa busca."
          : tipo !== "todos"
            ? `Nenhum documento do tipo "${tipo}".`
            : "Nenhum documento enviado ainda."}
      </p>
      {!busca && tipo === "todos" && (
        <p className="mt-2 text-sm text-muted">
          Clique em <strong className="text-foreground">Enviar documento</strong> no topo pra começar.
        </p>
      )}
    </div>
  )
}

function summaryLabel(total: number): string {
  if (total === 0) return "nenhum registro aqui"
  return `${total} ${total === 1 ? "documento" : "documentos"}`
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
