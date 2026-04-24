import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileUp, Loader2, X } from "lucide-react"
import { uploadDocumento, queryKeys } from "@/api/granola"
import type { TipoDocumento } from "@/types/domain"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
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

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — bate com o backend (MAX_UPLOAD_BYTES)

const TIPOS: { value: TipoDocumento; label: string }[] = [
  { value: "peticao", label: "Petição" },
  { value: "contrato", label: "Contrato" },
  { value: "procuracao", label: "Procuração" },
  { value: "decisao", label: "Decisão" },
  { value: "sentenca", label: "Sentença" },
  { value: "comprovante", label: "Comprovante" },
  { value: "outro", label: "Outro" },
]

interface DocumentoUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-preenche e trava o processo (uso a partir do detalhe). */
  fixedProcessoId?: number | null
  fixedClienteId?: number | null
  onSaved?: (id: number) => void
}

/**
 * Dialog wrapper. State do form vive em UploadForm — montado/desmontado
 * via `open && <UploadForm key=... />` pra obter reset automatico (padrao
 * key-remount documentado no CLAUDE.md §6.4 pra evitar cascading renders).
 */
export function DocumentoUploadDialog({
  open,
  onOpenChange,
  fixedProcessoId,
  fixedClienteId,
  onSaved,
}: DocumentoUploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        {open && (
          <UploadForm
            key={fixedProcessoId ?? "free"}
            fixedProcessoId={fixedProcessoId}
            fixedClienteId={fixedClienteId}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface UploadFormProps {
  fixedProcessoId?: number | null
  fixedClienteId?: number | null
  onClose: () => void
  onSaved?: (id: number) => void
}

function UploadForm({
  fixedProcessoId,
  fixedClienteId,
  onClose,
  onSaved,
}: UploadFormProps) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [tipo, setTipo] = useState<TipoDocumento>("peticao")
  const [observacao, setObservacao] = useState("")
  const [processoId, setProcessoId] = useState<number | null>(
    fixedProcessoId ?? null
  )
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function pickFile(f: File | null) {
    setErrorMsg(null)
    if (!f) {
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setErrorMsg(`Arquivo muito grande (${formatBytes(f.size)}). Máximo 10 MB.`)
      return
    }
    setFile(f)
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Selecione um arquivo.")
      const base64 = await fileToBase64(file)
      return uploadDocumento({
        file: base64,
        nome: file.name,
        tipo,
        processo_id: processoId,
        cliente_id: fixedClienteId ?? null,
        observacao: observacao.trim() || null,
      })
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["granola", "documentos"] })
      if (processoId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) })
      }
      onSaved?.(id)
      onClose()
    },
  })

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setErrorMsg("Selecione um arquivo antes de enviar.")
      return
    }
    mutation.mutate()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">
          Upload de documento
        </DialogTitle>
        <DialogDescription>
          Os arquivos ficam em{" "}
          <code className="font-mono text-[0.75rem]">granola/data/uploads/</code>{" "}
          na máquina local. Tamanho máximo: 10 MB.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Drop zone */}
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
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-8 text-center transition-all duration-200 ease-out",
            dragOver
              ? "border-dourado bg-dourado/5 scale-[1.01]"
              : "border-border-strong bg-surface-alt hover:border-dourado/60 hover:bg-dourado/5"
          )}
        >
          {file ? (
            <>
              <FileUp className="h-6 w-6 text-dourado" strokeWidth={1.5} />
              <div className="font-sans text-[0.875rem] font-medium text-foreground">
                {file.name}
              </div>
              <div className="text-[0.72rem] text-muted">
                {formatBytes(file.size)} · {file.type || "tipo desconhecido"}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  pickFile(null)
                }}
                className="mt-1 inline-flex items-center gap-1 text-[0.72rem] font-medium text-erro hover:underline"
              >
                <X className="h-3 w-3" strokeWidth={2} /> remover
              </button>
            </>
          ) : (
            <>
              <FileUp className="h-7 w-7 text-muted" strokeWidth={1.5} />
              <div className="font-sans text-[0.875rem] text-foreground">
                Arraste o arquivo aqui ou{" "}
                <span className="text-dourado underline-offset-2 hover:underline">
                  selecione no disco
                </span>
              </div>
              <div className="text-[0.72rem] text-muted">
                PDF, DOCX, imagens · até 10 MB
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setTipo(v as TipoDocumento)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!fixedProcessoId && (
            <div className="space-y-1.5">
              <Label>Processo (opcional)</Label>
              <ProcessoSearchSelect
                value={processoId}
                onChange={setProcessoId}
              />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="doc-observacao">Observação</Label>
          <Textarea
            id="doc-observacao"
            rows={3}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Notas internas, contexto do envio…"
          />
        </div>

        {(errorMsg || mutation.isError) && (
          <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
            {errorMsg ||
              (mutation.error instanceof Error
                ? mutation.error.message
                : "Não foi possível enviar.")}
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
            disabled={mutation.isPending || !file}
            className={cn(
              "bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
          >
            {mutation.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Enviar documento
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

// --------------------------------------------------------------------------
// Helpers
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
