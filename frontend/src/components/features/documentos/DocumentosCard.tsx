import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Download, FileText, Loader2, Plus, Trash2 } from "lucide-react"
import { deleteDocumento, queryKeys } from "@/api/granola"
import type { Documento } from "@/types/domain"
import { useAuth } from "@/lib/auth-context"
import { formatDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DocumentoUploadDialog } from "./DocumentoUploadDialog"
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface DocumentosCardProps {
  documentos: Documento[]
  /** Trava o upload pra esse processo. */
  processoId: number
  clienteId?: number | null
}

/**
 * Card de documentos vinculados — usado no ProcessoDetailPage.
 * Compartilha o DocumentoUploadDialog com a pagina standalone.
 */
export function DocumentosCard({
  documentos,
  processoId,
  clienteId,
}: DocumentosCardProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const [showUpload, setShowUpload] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Documento | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (target: Documento) => deleteDocumento(target.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "documentos"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) })
      setDeleteTarget(null)
    },
  })

  return (
    <Card className="gap-0 rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold">
          Documentos
        </CardTitle>
        <span className="ml-auto text-[0.72rem] text-muted">
          {documentos.length}{" "}
          {documentos.length === 1 ? "arquivo" : "arquivos"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-2 gap-1 text-[0.78rem] text-foreground hover:bg-dourado/10"
          onClick={() => setShowUpload(true)}
        >
          <Plus className="h-3 w-3" strokeWidth={2} /> Enviar
        </Button>
      </CardHeader>
      <CardContent className="px-0 py-0">
        {documentos.length === 0 ? (
          <p className="font-display italic text-muted text-base px-5 py-6">
            Nenhum documento neste processo ainda.
          </p>
        ) : (
          <ul>
            {documentos.map((doc) => (
              <DocumentoLi
                key={doc.id}
                doc={doc}
                isAdmin={isAdmin}
                onDelete={() => setDeleteTarget(doc)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <DocumentoUploadDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        fixedProcessoId={processoId}
        fixedClienteId={clienteId ?? null}
      />

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
                  o arquivo apagado do disco. Essa ação não pode ser desfeita.
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
    </Card>
  )
}

function DocumentoLi({
  doc,
  isAdmin,
  onDelete,
}: {
  doc: Documento
  isAdmin: boolean
  onDelete: () => void
}) {
  const downloadHref = `/uploads/${doc.caminho}`
  return (
    <li className="flex items-start gap-3 border-b border-border px-5 py-3 last:border-b-0">
      <FileText
        className="mt-0.5 h-4 w-4 shrink-0 text-muted"
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <div className="font-sans text-sm font-medium text-foreground">
          {truncate(doc.nome, 60)}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[0.72rem] text-muted">
          <span className="capitalize rounded-pill bg-tinta/8 px-1.5 py-0 text-[0.65rem] font-medium text-tinta">
            {doc.tipo}
          </span>
          <span>{formatBytes(doc.tamanho_bytes)}</span>
          <span>·</span>
          <span className="tabular-nums font-mono">
            {formatDate(doc.criado_em)}
          </span>
        </div>
        {doc.observacao && (
          <div className="mt-1 text-[0.72rem] italic text-muted">
            {truncate(doc.observacao, 120)}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={downloadHref}
          target="_blank"
          rel="noopener noreferrer"
          download={doc.nome}
          aria-label="Baixar"
          className={cn(
            "grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors",
            "hover:bg-dourado/10 hover:text-foreground"
          )}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
        </a>
        {isAdmin && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Excluir"
            className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-erro/10 hover:text-erro"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
    </li>
  )
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
