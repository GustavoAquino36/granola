import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react"
import { criarMovimentacao, queryKeys } from "@/api/granola"
import type {
  ColetaLogEntry,
  FonteMovimentacao,
  Movimentacao,
  MovimentacaoInput,
} from "@/types/domain"
import { formatDate, truncate } from "@/lib/format"
import { useColetaDatajud } from "@/lib/useColetaDatajud"
import { cn } from "@/lib/utils"
import {
  Card,
  CardAction,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface MovimentacoesCardProps {
  processoId: number
  movimentacoes: Movimentacao[]
}

export function MovimentacoesCard({
  processoId,
  movimentacoes,
}: MovimentacoesCardProps) {
  const [showManualForm, setShowManualForm] = useState(false)
  const [showResumoBanner, setShowResumoBanner] = useState(false)

  const coleta = useColetaDatajud({
    invalidateProcessoId: processoId,
    onDone: () => setShowResumoBanner(true),
  })

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <CardHeader className="flex items-center gap-2 border-b border-border px-5 py-3">
        <CardTitle className="font-sans text-[0.9375rem] font-semibold text-foreground">
          Movimentações
        </CardTitle>
        {movimentacoes.length > 0 && (
          <span className="text-[0.72rem] text-muted">
            · {movimentacoes.length}
          </span>
        )}
        <CardAction className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 rounded-card text-muted"
            onClick={() => setShowManualForm((v) => !v)}
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Manual
          </Button>
          <Button
            size="sm"
            disabled={coleta.running}
            onClick={coleta.start}
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
          >
            {coleta.running ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
            )}
            {coleta.running ? "Coletando…" : "Coletar DataJud"}
          </Button>
        </CardAction>
      </CardHeader>

      {/* Erro de start */}
      {coleta.error && !coleta.running && (
        <div className="border-b border-erro/20 bg-erro/5 px-5 py-2.5 text-[0.8125rem] text-erro">
          {coleta.error}
        </div>
      )}

      {/* Painel ao vivo enquanto coleta roda */}
      {coleta.running && (
        <ColetaLogPanel entries={coleta.entries} />
      )}

      {/* Resumo apos terminar */}
      {showResumoBanner && coleta.resumo && !coleta.running && (
        <ColetaResumoBanner
          resumo={coleta.resumo}
          onDismiss={() => setShowResumoBanner(false)}
        />
      )}

      {/* Form manual (inline, simples) */}
      {showManualForm && (
        <ManualMovForm
          processoId={processoId}
          onClose={() => setShowManualForm(false)}
        />
      )}

      {/* Timeline de movs */}
      <MovsList movs={movimentacoes} />
    </Card>
  )
}

// --------------------------------------------------------------------------
// Painel de log ao vivo
// --------------------------------------------------------------------------

function ColetaLogPanel({ entries }: { entries: ColetaLogEntry[] }) {
  // Auto-scroll pro final conforme chegam entries novas
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])

  // Filtra so entries do datajud (reduz ruido se houver coletas paralelas)
  const datajudEntries = entries.filter((e) => e.source === "datajud")
  const ultimas = datajudEntries.slice(-20)

  return (
    <div className="border-b border-dourado/25 bg-dourado/5 px-5 py-3">
      <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-dourado">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-dourado" />
        Coleta DataJud em andamento · {datajudEntries.length} eventos
      </div>
      <div
        ref={scrollRef}
        className="mt-2 max-h-[180px] overflow-y-auto rounded-card bg-surface/80 p-2 font-mono text-[0.72rem]"
      >
        {ultimas.length === 0 ? (
          <div className="text-muted">Aguardando o backend responder…</div>
        ) : (
          <ul className="space-y-0.5">
            {ultimas.map((e) => (
              <li key={e.seq} className="flex gap-2">
                <span className="shrink-0 text-muted">
                  {e.ts.slice(11, 19)}
                </span>
                <span className={cn("shrink-0", levelColor(e.level))}>
                  [{e.level}]
                </span>
                <span className="min-w-0 flex-1 text-foreground">
                  {truncate(e.msg, 140)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function levelColor(level: string): string {
  switch (level) {
    case "error":
      return "text-erro"
    case "warn":
      return "text-alerta"
    case "success":
      return "text-sucesso"
    default:
      return "text-dourado"
  }
}

// --------------------------------------------------------------------------
// Banner de resumo pos-coleta
// --------------------------------------------------------------------------

function ColetaResumoBanner({
  resumo,
  onDismiss,
}: {
  resumo: NonNullable<ReturnType<typeof useColetaDatajud>["resumo"]>
  onDismiss: () => void
}) {
  const novidades = resumo.com_novidade
  const novasMovs = resumo.novas_movimentacoes.length
  const erros = resumo.erros.length

  const tone =
    erros > 0 ? "warn" : novidades > 0 ? "success" : "neutral"

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b px-5 py-3 text-[0.8125rem]",
        tone === "success" && "border-sucesso/25 bg-sucesso/6",
        tone === "warn" && "border-alerta/25 bg-alerta/6",
        tone === "neutral" && "border-border bg-surface-alt"
      )}
    >
      <CheckCircle2
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "success"
            ? "text-sucesso"
            : tone === "warn"
              ? "text-alerta"
              : "text-muted"
        )}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <div className="font-sans font-semibold text-foreground">
          Coleta concluída
        </div>
        <div className="mt-0.5 text-muted">
          {resumo.consultados} tribunais consultados ·{" "}
          <strong className="text-foreground">{novidades}</strong> processo
          {novidades === 1 ? "" : "s"} com novidade ·{" "}
          <strong className="text-foreground">{novasMovs}</strong>{" "}
          movimentaç{novasMovs === 1 ? "ão" : "ões"} nova
          {novasMovs === 1 ? "" : "s"}
          {erros > 0 ? (
            <>
              {" · "}
              <strong className="text-alerta">
                {erros} erro{erros === 1 ? "" : "s"}
              </strong>
            </>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-[0.72rem] text-muted hover:text-foreground"
      >
        Fechar
      </button>
    </div>
  )
}

// --------------------------------------------------------------------------
// Form manual simples (data + tipo + descricao)
// --------------------------------------------------------------------------

function ManualMovForm({
  processoId,
  onClose,
}: {
  processoId: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [descricao, setDescricao] = useState("")
  const [tipo, setTipo] = useState("")
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))

  const mutation = useMutation({
    mutationFn: (input: MovimentacaoInput) => criarMovimentacao(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      setDescricao("")
      setTipo("")
      onClose()
    },
  })

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!descricao.trim()) return
    mutation.mutate({
      processo_id: processoId,
      tipo: tipo.trim() || "manual",
      descricao: descricao.trim(),
      data_movimento: data,
      fonte: "manual",
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-2 border-b border-border bg-surface-alt px-5 py-3 md:grid-cols-[120px_160px_1fr_auto] md:items-end"
    >
      <Field label="Data">
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="w-full rounded-card border border-border-strong bg-surface px-2.5 py-1.5 font-mono text-[0.8125rem] text-foreground outline-none focus:border-dourado"
        />
      </Field>
      <Field label="Tipo">
        <input
          type="text"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          placeholder="Ex: Despacho"
          className="w-full rounded-card border border-border-strong bg-surface px-2.5 py-1.5 text-[0.8125rem] text-foreground outline-none focus:border-dourado"
        />
      </Field>
      <Field label="Descricao">
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="O que aconteceu?"
          autoFocus
          className="w-full rounded-card border border-border-strong bg-surface px-2.5 py-1.5 text-[0.8125rem] text-foreground outline-none focus:border-dourado"
        />
      </Field>
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={mutation.isPending || !descricao.trim()}
          className="bg-dourado text-tinta hover:bg-dourado-claro"
        >
          {mutation.isPending && (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          )}
          Adicionar
        </Button>
      </div>
      {mutation.isError && (
        <div className="text-[0.75rem] text-erro md:col-span-4">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Falha ao salvar."}
        </div>
      )}
    </form>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-sans text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

// --------------------------------------------------------------------------
// Lista de movs (timeline)
// --------------------------------------------------------------------------

function MovsList({ movs }: { movs: Movimentacao[] }) {
  if (movs.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <Download
          className="mx-auto mb-3 h-6 w-6 text-muted/50"
          strokeWidth={1.5}
        />
        <p className="font-display italic text-muted text-base">
          Sem movimentações ainda. Clique em <strong className="not-italic text-foreground">Coletar DataJud</strong> pra importar do CNJ.
        </p>
      </div>
    )
  }

  return (
    <ol className="flex flex-col">
      {movs.slice(0, 50).map((m) => (
        <li
          key={m.id}
          className="grid grid-cols-[110px_1fr_auto] items-start gap-3 border-b border-border px-5 py-3 last:border-b-0 hover:bg-dourado/4"
        >
          <div className="tabular-nums pt-0.5 font-mono text-[0.72rem] text-muted">
            {formatDate(m.data_movimento)}
          </div>
          <div className="min-w-0">
            <div className="font-sans text-[0.875rem] font-semibold text-foreground">
              {m.tipo || "Movimentacao"}
            </div>
            {m.descricao && (
              <div className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">
                {truncate(m.descricao, 200)}
              </div>
            )}
          </div>
          <SourceTag fonte={m.fonte} />
        </li>
      ))}
      {movs.length > 50 && (
        <li className="px-5 py-2.5 text-center text-[0.75rem] text-muted">
          Mostrando as 50 mais recentes de {movs.length}.
        </li>
      )}
    </ol>
  )
}

function SourceTag({ fonte }: { fonte: FonteMovimentacao }) {
  const map: Record<string, { label: string; cls: string }> = {
    datajud_auto: {
      label: "DataJud",
      cls: "bg-dourado/16 text-[#9a7a40]",
    },
    djen_auto: { label: "DJEN", cls: "bg-dourado/16 text-[#9a7a40]" },
    esaj_auto: { label: "e-SAJ", cls: "bg-sucesso/12 text-sucesso" },
    pje_auto: { label: "PJe", cls: "bg-sucesso/12 text-sucesso" },
    manual: { label: "Manual", cls: "bg-fumaca/14 text-fumaca" },
  }
  const s = map[fonte] ?? { label: fonte, cls: "bg-fumaca/14 text-fumaca" }
  return (
    <span
      className={cn(
        "shrink-0 self-start rounded-pill px-2 py-[2px] text-[0.65rem] font-semibold",
        s.cls
      )}
    >
      {s.label}
    </span>
  )
}
