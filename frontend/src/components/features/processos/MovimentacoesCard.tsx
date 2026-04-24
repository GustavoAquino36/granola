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
import {
  useColetaPublicacoes,
  type ColetaPublicacoesSource,
} from "@/lib/useColetaPublicacoes"
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

/** Resumo generico unificado pros dois fluxos (Datajud + DJEN tem campos
 *  equivalentes onde precisamos exibir). */
interface ResumoGenerico {
  consultados?: number
  oabs_consultadas?: number
  com_novidade: number
  novas_movimentacoes: unknown[]
  erros: string[]
  inicio: string
  fim: string | null
}

interface LastFinished {
  source: ColetaPublicacoesSource
  resumo: ResumoGenerico
}

export function MovimentacoesCard({
  processoId,
  movimentacoes,
}: MovimentacoesCardProps) {
  const [showManualForm, setShowManualForm] = useState(false)
  const [lastFinished, setLastFinished] = useState<LastFinished | null>(null)

  const coletaDatajud = useColetaPublicacoes<ResumoGenerico>("datajud", {
    invalidateProcessoId: processoId,
    onDone: (resumo) => {
      if (resumo) setLastFinished({ source: "datajud", resumo })
    },
  })
  const coletaDjen = useColetaPublicacoes<ResumoGenerico>("djen", {
    invalidateProcessoId: processoId,
    onDone: (resumo) => {
      if (resumo) setLastFinished({ source: "djen", resumo })
    },
  })

  const anyRunning = coletaDatajud.running || coletaDjen.running
  const activeColeta = coletaDatajud.running
    ? { source: "datajud" as const, entries: coletaDatajud.entries }
    : coletaDjen.running
      ? { source: "djen" as const, entries: coletaDjen.entries }
      : null

  const startError = coletaDatajud.error || coletaDjen.error

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
            disabled={anyRunning}
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Manual
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={anyRunning}
            onClick={coletaDjen.start}
            className="gap-1.5 rounded-card"
            title="Coletar publicações DJEN (comunicações por OAB)"
          >
            {coletaDjen.running ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
            )}
            DJEN
          </Button>
          <Button
            size="sm"
            disabled={anyRunning}
            onClick={coletaDatajud.start}
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
            title="Coletar publicações do DataJud CNJ (fonte padrão)"
          >
            {coletaDatajud.running ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
            )}
            {coletaDatajud.running ? "Coletando…" : "Coletar DataJud"}
          </Button>
        </CardAction>
      </CardHeader>

      {startError && !anyRunning && (
        <div className="border-b border-erro/20 bg-erro/5 px-5 py-2.5 text-[0.8125rem] text-erro">
          {startError}
        </div>
      )}

      {activeColeta && (
        <ColetaLogPanel
          source={activeColeta.source}
          entries={activeColeta.entries}
        />
      )}

      {lastFinished && !anyRunning && (
        <ColetaResumoBanner
          source={lastFinished.source}
          resumo={lastFinished.resumo}
          onDismiss={() => setLastFinished(null)}
        />
      )}

      {showManualForm && (
        <ManualMovForm
          processoId={processoId}
          onClose={() => setShowManualForm(false)}
        />
      )}

      <MovsList movs={movimentacoes} />
    </Card>
  )
}

// --------------------------------------------------------------------------

const SOURCE_LABEL: Record<ColetaPublicacoesSource, string> = {
  datajud: "DataJud",
  djen: "DJEN",
}

function ColetaLogPanel({
  source,
  entries,
}: {
  source: ColetaPublicacoesSource
  entries: ColetaLogEntry[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])

  // Filtra so entries da fonte em andamento (reduz ruido)
  const filtered = entries.filter((e) => e.source === source)
  const ultimas = filtered.slice(-20)

  return (
    <div className="border-b border-dourado/25 bg-dourado/5 px-5 py-3">
      <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-dourado">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-dourado" />
        Coleta {SOURCE_LABEL[source]} em andamento · {filtered.length} eventos
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

function ColetaResumoBanner({
  source,
  resumo,
  onDismiss,
}: {
  source: ColetaPublicacoesSource
  resumo: ResumoGenerico
  onDismiss: () => void
}) {
  const novidades = resumo.com_novidade
  const novasMovs = resumo.novas_movimentacoes.length
  const erros = resumo.erros.length
  const consultadosLabel =
    source === "datajud"
      ? `${resumo.consultados ?? 0} tribunais`
      : `${resumo.oabs_consultadas ?? 0} OABs`

  const tone = erros > 0 ? "warn" : novidades > 0 ? "success" : "neutral"

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
          Coleta {SOURCE_LABEL[source]} concluída
        </div>
        <div className="mt-0.5 text-muted">
          {consultadosLabel} ·{" "}
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.processo(processoId),
      })
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

function MovsList({ movs }: { movs: Movimentacao[] }) {
  if (movs.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <Download
          className="mx-auto mb-3 h-6 w-6 text-muted/50"
          strokeWidth={1.5}
        />
        <p className="font-display italic text-muted text-base">
          Sem movimentações ainda. Clique em{" "}
          <strong className="not-italic text-foreground">Coletar DataJud</strong>{" "}
          pra importar do CNJ ou{" "}
          <strong className="not-italic text-foreground">DJEN</strong> pra
          buscar por OAB.
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
