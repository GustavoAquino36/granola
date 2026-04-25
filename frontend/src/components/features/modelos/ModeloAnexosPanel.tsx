import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Download,
  FileUp,
  Loader2,
  Paperclip,
  Trash2,
} from "lucide-react"
import {
  deleteModeloAnexo,
  queryKeys,
  uploadModeloAnexo,
} from "@/api/granola"
import type { ModeloAnexo } from "@/types/domain"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"

const MAX_BYTES = 10 * 1024 * 1024 // bate com o backend

interface ModeloAnexosPanelProps {
  modeloId: number
  anexos: ModeloAnexo[]
}

export function ModeloAnexosPanel({ modeloId, anexos }: ModeloAnexosPanelProps) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ModeloAnexo | null>(null)

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file)
      return uploadModeloAnexo({
        modelo_id: modeloId,
        file: base64,
        nome: file.name,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelo(modeloId) })
      setErrorMsg(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (target: ModeloAnexo) => deleteModeloAnexo(target.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelo(modeloId) })
      setDeleteTarget(null)
    },
  })

  function pickFile(file: File | null) {
    setErrorMsg(null)
    if (!file) return
    if (file.size > MAX_BYTES) {
      setErrorMsg(`Arquivo muito grande (${formatBytes(file.size)}). Máximo 10 MB.`)
      return
    }
    uploadMutation.mutate(file)
  }

  return (
    <section className="rounded-card border border-border bg-surface px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
          <h3 className="font-sans text-[0.95rem] font-semibold text-foreground">
            Anexos
          </h3>
          <span className="tabular-nums rounded-pill bg-surface-alt px-2 py-0.5 font-mono text-[0.7rem] text-muted">
            {anexos.length}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => inputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="gap-1 text-[0.78rem] hover:bg-dourado/10"
        >
          {uploadMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <FileUp className="h-3 w-3" strokeWidth={1.75} />
          )}
          Adicionar arquivo
        </Button>
      </div>

      {/* Lista + dropzone abaixo */}
      {anexos.length > 0 ? (
        <ul className="mb-3 space-y-1.5">
          {anexos.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-card border border-border bg-surface-alt px-3 py-2"
            >
              <Paperclip
                className="h-3.5 w-3.5 shrink-0 text-muted"
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-sans text-[0.84rem] font-medium text-foreground">
                  {a.nome}
                </div>
                <div className="tabular-nums font-mono text-[0.68rem] text-muted">
                  {formatBytes(a.tamanho_bytes ?? 0)}
                </div>
              </div>
              <a
                href={`/uploads/${a.caminho}`}
                target="_blank"
                rel="noopener noreferrer"
                download={a.nome}
                aria-label="Baixar"
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-pill text-muted transition-colors",
                  "hover:bg-dourado/10 hover:text-foreground"
                )}
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
              <button
                type="button"
                onClick={() => setDeleteTarget(a)}
                aria-label="Excluir anexo"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-pill text-muted transition-colors hover:bg-erro/10 hover:text-erro"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const dropped = e.dataTransfer.files?.[0]
          if (dropped) pickFile(dropped)
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-5 text-center transition-all duration-200 ease-out",
          dragOver
            ? "border-dourado bg-dourado/5 scale-[1.005]"
            : "border-border-strong bg-surface-alt hover:border-dourado/60 hover:bg-dourado/5"
        )}
      >
        {uploadMutation.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin text-dourado" />
        ) : (
          <FileUp className="h-5 w-5 text-muted" strokeWidth={1.5} />
        )}
        <div className="font-sans text-[0.8rem] text-foreground">
          {uploadMutation.isPending
            ? "Enviando…"
            : (
              <>
                Arraste um arquivo aqui ou{" "}
                <span className="text-dourado underline-offset-2 hover:underline">
                  selecione no disco
                </span>
              </>
            )}
        </div>
        <div className="text-[0.7rem] text-muted">PDF, DOCX, imagens · até 10 MB</div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {(errorMsg || uploadMutation.isError) && (
        <p className="mt-2 rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
          {errorMsg ||
            (uploadMutation.error instanceof Error
              ? uploadMutation.error.message
              : "Não foi possível enviar.")}
        </p>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          {deleteTarget && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-xl font-normal">
                  Remover anexo?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <strong>{deleteTarget.nome}</strong> será apagado do disco e do
                  modelo. Outros modelos não são afetados.
                </AlertDialogDescription>
              </AlertDialogHeader>
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
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// --------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = reader.result as string
      const idx = result.indexOf(",")
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
