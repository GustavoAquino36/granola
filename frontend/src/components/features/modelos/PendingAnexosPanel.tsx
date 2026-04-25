import { useRef, useState } from "react"
import { FileUp, Paperclip, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatBytes, MAX_ANEXO_BYTES } from "./anexo-utils"

interface PendingAnexosPanelProps {
  /** Lista de Files mantida no estado do parent — sao enviados em batch
   *  apos o primeiro save do modelo (que cria o registro no DB e gera o id). */
  pending: File[]
  onChange: (next: File[]) => void
  /** Quando upload em batch esta acontecendo, desabilitamos add/remove. */
  uploading?: boolean
}

/**
 * Painel de anexos no modo "novo modelo" — antes do primeiro save.
 *
 * Diferente do ModeloAnexosPanel (que precisa de modeloId pra subir),
 * aqui os arquivos vivem so na memoria do browser (File objects). Quando
 * o user clicar Salvar pela primeira vez, ModeloEditorPage faz o upsert
 * do modelo + upload sequencial dos pending anexos + redirect.
 *
 * UX igual: drag-drop zone, lista com remover. So nao tem download
 * (arquivo nao foi pro disco ainda) nem versao.
 */
export function PendingAnexosPanel({
  pending,
  onChange,
  uploading,
}: PendingAnexosPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function addFile(file: File | null) {
    setErrorMsg(null)
    if (!file) return
    if (file.size > MAX_ANEXO_BYTES) {
      setErrorMsg(`Arquivo muito grande (${formatBytes(file.size)}). Máximo 10 MB.`)
      return
    }
    // Evita duplicatas na lista pendente (mesmo nome+tamanho = mesmo arquivo)
    if (pending.some((f) => f.name === file.name && f.size === file.size)) {
      setErrorMsg(`"${file.name}" já está na lista.`)
      return
    }
    onChange([...pending, file])
  }

  function removeFile(idx: number) {
    onChange(pending.filter((_, i) => i !== idx))
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
            {pending.length}
          </span>
        </div>
        <span className="text-[0.7rem] italic text-muted">
          serão enviados ao salvar o modelo
        </span>
      </div>

      {pending.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {pending.map((f, idx) => (
            <li
              key={`${f.name}-${idx}`}
              className="flex items-center gap-2 rounded-card border border-dashed border-border-strong bg-surface-alt px-3 py-2"
            >
              <Paperclip
                className="h-3.5 w-3.5 shrink-0 text-muted"
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-sans text-[0.84rem] font-medium text-foreground">
                  {f.name}
                </div>
                <div className="tabular-nums font-mono text-[0.68rem] text-muted">
                  {formatBytes(f.size)} · pendente
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                disabled={uploading}
                aria-label="Remover da lista"
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-pill text-muted transition-colors",
                  "hover:bg-erro/10 hover:text-erro",
                  uploading && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted"
                )}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          if (uploading) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (uploading) return
          e.preventDefault()
          setDragOver(false)
          const files = Array.from(e.dataTransfer.files ?? [])
          // Permite drag de varios pra adicionar todos
          for (const file of files) {
            addFile(file)
          }
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-5 text-center transition-all duration-200 ease-out",
          dragOver
            ? "border-dourado bg-dourado/5 scale-[1.005]"
            : "border-border-strong bg-surface-alt hover:border-dourado/60 hover:bg-dourado/5",
          uploading
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer"
        )}
      >
        <FileUp className="h-5 w-5 text-muted" strokeWidth={1.5} />
        <div className="font-sans text-[0.8rem] text-foreground">
          Arraste arquivos aqui ou{" "}
          <span className="text-dourado underline-offset-2 hover:underline">
            selecione no disco
          </span>
        </div>
        <div className="text-[0.7rem] text-muted">
          PDF, DOCX, imagens · até 10 MB · vários arquivos suportados
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            for (const file of files) {
              addFile(file)
            }
            // Limpa pra permitir re-adicionar o mesmo arquivo após remover
            e.target.value = ""
          }}
        />
      </div>

      {errorMsg && (
        <p className="mt-2 rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
          {errorMsg}
        </p>
      )}
    </section>
  )
}
