import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Calendar,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react"
import {
  criarMovimentacao,
  criarPrazoDaMov,
  marcarMovPendente,
  marcarMovVista,
  queryKeys,
} from "@/api/granola"
import type {
  ColetaLogEntry,
  FonteMovimentacao,
  Movimentacao,
  MovimentacaoInput,
  TratamentoMov,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

      <MovsList movs={movimentacoes} processoId={processoId} />
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

function MovsList({
  movs,
  processoId,
}: {
  movs: Movimentacao[]
  processoId: number
}) {
  const [criarPrazoFor, setCriarPrazoFor] = useState<Movimentacao | null>(null)

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
    <>
      <ol className="flex flex-col">
        {movs.slice(0, 50).map((m) => (
          <MovLi
            key={m.id}
            mov={m}
            processoId={processoId}
            onCriarPrazo={() => setCriarPrazoFor(m)}
          />
        ))}
        {movs.length > 50 && (
          <li className="px-5 py-2.5 text-center text-[0.75rem] text-muted">
            Mostrando as 50 mais recentes de {movs.length}.
          </li>
        )}
      </ol>

      <CriarPrazoDialog
        mov={criarPrazoFor}
        processoId={processoId}
        onClose={() => setCriarPrazoFor(null)}
      />
    </>
  )
}

function MovLi({
  mov,
  processoId,
  onCriarPrazo,
}: {
  mov: Movimentacao
  processoId: number
  onCriarPrazo: () => void
}) {
  const queryClient = useQueryClient()

  const marcarVista = useMutation({
    mutationFn: () => marcarMovVista(mov.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) }),
  })
  const marcarPendente = useMutation({
    mutationFn: () => marcarMovPendente(mov.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) }),
  })

  const tratamento = mov.tratamento ?? "pendente"
  const isVisto = tratamento === "visto"
  const isPrazo = tratamento === "prazo"
  const isIgnorado = tratamento === "ignorado"
  const muted = isVisto || isIgnorado

  return (
    <li
      className={cn(
        "grid grid-cols-[110px_1fr_auto_32px] items-start gap-3 border-b border-border px-5 py-3 last:border-b-0 hover:bg-dourado/4",
        muted && "opacity-70"
      )}
    >
      <div className="tabular-nums pt-0.5 font-mono text-[0.72rem] text-muted">
        {formatDate(mov.data_movimento)}
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            "font-sans text-[0.875rem] font-semibold",
            isVisto || isIgnorado ? "text-muted" : "text-foreground"
          )}
        >
          {mov.tipo || "Movimentacao"}
        </div>
        {mov.descricao && (
          <div className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">
            {truncate(mov.descricao, 200)}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <SourceTag fonte={mov.fonte} />
        {tratamento !== "pendente" && (
          <TratamentoBadge tratamento={tratamento} />
        )}
      </div>
      <div className="pt-0.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Acoes da movimentacao"
              className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
              disabled={marcarVista.isPending || marcarPendente.isPending}
            >
              {marcarVista.isPending || marcarPendente.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {!isVisto && !isPrazo && (
              <DropdownMenuItem onClick={() => marcarVista.mutate()}>
                <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                Marcar como vista
              </DropdownMenuItem>
            )}
            {(isVisto || isIgnorado) && (
              <DropdownMenuItem onClick={() => marcarPendente.mutate()}>
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                Voltar para pendente
              </DropdownMenuItem>
            )}
            {!isPrazo && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onCriarPrazo}>
                  <Calendar className="h-3.5 w-3.5 text-dourado" strokeWidth={1.75} />
                  Criar prazo desta movimentação
                </DropdownMenuItem>
              </>
            )}
            {isPrazo && (
              <DropdownMenuItem disabled>
                <CheckCircle2 className="h-3.5 w-3.5 text-sucesso" strokeWidth={1.75} />
                Prazo ja criado
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

function TratamentoBadge({ tratamento }: { tratamento: TratamentoMov }) {
  const map: Record<string, { label: string; cls: string }> = {
    visto: { label: "Vista", cls: "bg-fumaca/14 text-fumaca" },
    prazo: { label: "Prazo criado", cls: "bg-sucesso/12 text-sucesso" },
    ignorado: { label: "Ignorada", cls: "bg-fumaca/14 text-fumaca" },
  }
  const key = typeof tratamento === "string" ? tratamento : ""
  const s = map[key]
  if (!s) return null
  return (
    <span
      className={cn(
        "rounded-pill px-2 py-[2px] text-[0.62rem] font-semibold",
        s.cls
      )}
    >
      {s.label}
    </span>
  )
}

// --------------------------------------------------------------------------
// Dialog pra criar prazo a partir de uma movimentacao
// --------------------------------------------------------------------------

function CriarPrazoDialog({
  mov,
  processoId,
  onClose,
}: {
  mov: Movimentacao | null
  processoId: number
  onClose: () => void
}) {
  return (
    <Dialog open={mov !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        {mov && (
          <CriarPrazoForm
            // key force remount quando mov muda — estado interno reseta
            // sem precisar de useEffect + setState (React best practice)
            key={mov.id}
            mov={mov}
            processoId={processoId}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CriarPrazoForm({
  mov,
  processoId,
  onClose,
}: {
  mov: Movimentacao
  processoId: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [titulo, setTitulo] = useState(mov.tipo || "Prazo processual")
  const [dataVenc, setDataVenc] = useState(() =>
    new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  )
  const [prioridade, setPrioridade] = useState<"alta" | "media" | "normal">(
    "media"
  )
  const [descricao, setDescricao] = useState(mov.descricao ?? "")

  const mutation = useMutation({
    mutationFn: () =>
      criarPrazoDaMov({
        mov_id: mov.id,
        titulo: titulo.trim(),
        data_vencimento: dataVenc,
        prioridade,
        descricao: descricao.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) })
      queryClient.invalidateQueries({ queryKey: ["granola", "prazos"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      onClose()
    },
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-xl font-normal">
          Criar prazo desta movimentação
        </DialogTitle>
        <DialogDescription>
          A movimentação fica marcada como <strong>Prazo criado</strong> e
          o prazo novo entra em <em>Próximos prazos</em> do dashboard.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <Field label="Título">
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Contestação"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data de vencimento">
            <Input
              type="date"
              className="font-mono"
              value={dataVenc}
              onChange={(e) => setDataVenc(e.target.value)}
            />
          </Field>
          <Field label="Prioridade">
            <Select
              value={prioridade}
              onValueChange={(v) =>
                setPrioridade(v as "alta" | "media" | "normal")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="media">Média</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Descrição">
          <Textarea
            rows={3}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Contexto ou observacoes relevantes"
          />
        </Field>
      </div>

      {mutation.isError && (
        <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Falha ao criar prazo."}
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={mutation.isPending || !titulo.trim() || !dataVenc}
          onClick={() => mutation.mutate()}
          className="bg-dourado text-tinta hover:bg-dourado-claro"
        >
          {mutation.isPending && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          )}
          Criar prazo
        </Button>
      </DialogFooter>
    </>
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
