import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react"
import {
  fetchAgenda,
  fetchGcalStatus,
  queryKeys,
  syncGcal,
} from "@/api/granola"
import type { AgendaEvent } from "@/types/domain"
import { cn } from "@/lib/utils"
import { AgendaFormDialog } from "@/components/features/agenda/AgendaFormDialog"
import { GcalConnectDialog } from "@/components/features/agenda/GcalConnectDialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

const TIPO_COLOR: Record<string, string> = {
  audiencia: "bg-erro",
  reuniao: "bg-dourado",
  prazo: "bg-alerta",
  compromisso: "bg-[#3a6e9e]",
  outro: "bg-fumaca",
}

export function AgendaPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const [showNew, setShowNew] = useState(false)
  const [newDate, setNewDate] = useState<string | null>(null)
  const [editing, setEditing] = useState<AgendaEvent | null>(null)
  const [showGcal, setShowGcal] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const mesStr = useMemo(
    () =>
      `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`,
    [visibleMonth]
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.agenda({ mes: mesStr }),
    queryFn: () => fetchAgenda({ mes: mesStr }),
  })
  const eventos = useMemo(() => data?.eventos ?? [], [data])

  const { data: gcalStatus } = useQuery({
    queryKey: queryKeys.gcalStatus,
    queryFn: fetchGcalStatus,
  })

  const monthLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric",
    })
    const raw = fmt.format(visibleMonth)
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }, [visibleMonth])

  const cells = useMemo(
    () => buildCalendarCells(visibleMonth, eventos),
    [visibleMonth, eventos]
  )

  // Eventos do dia selecionado pra mostrar lista lateral. Sem dia selecionado,
  // usa hoje (se for do mes visivel).
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const todayKey = keyOf(new Date())
  const focusKey = selectedDay ?? todayKey
  const eventosDoDia = useMemo(() => {
    return eventos
      .filter((ev) => keyOfRaw(ev.data_inicio) === focusKey)
      .slice()
      .sort((a, b) => (a.data_inicio || "").localeCompare(b.data_inicio || ""))
  }, [eventos, focusKey])

  const syncMutation = useMutation({
    mutationFn: syncGcal,
    onSuccess: (stats) => {
      setSyncMsg(
        `Sync concluído · ${stats.pushed} novos · ${stats.updated} atualizados · ${stats.pulled} importados${
          stats.errors.length > 0 ? ` · ${stats.errors.length} erros` : ""
        }`
      )
      queryClient.invalidateQueries({ queryKey: ["granola", "agenda"] })
      setTimeout(() => setSyncMsg(null), 5000)
    },
    onError: (err) => {
      setSyncMsg(
        err instanceof Error ? `Erro: ${err.message}` : "Erro ao sincronizar"
      )
    },
  })

  function prevMonth() {
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
    setSelectedDay(null)
  }
  function nextMonth() {
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
    setSelectedDay(null)
  }
  function today() {
    const t = new Date()
    setVisibleMonth(new Date(t.getFullYear(), t.getMonth(), 1))
    setSelectedDay(keyOf(t))
  }

  function openNewForDate(date: string) {
    setNewDate(date)
    setShowNew(true)
  }

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      {/* HEADER */}
      <header className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Agenda
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading
              ? "carregando…"
              : `${eventos.length} ${eventos.length === 1 ? "evento" : "eventos"} em ${monthLabel.toLowerCase()}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* GCal status + sync */}
          {gcalStatus?.authenticated ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-card text-[0.8rem]"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              title="Sincronizar com Google Calendar"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Sync Google
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-card text-[0.8rem]"
              onClick={() => setShowGcal(true)}
              title="Conectar ao Google Calendar"
            >
              <CircleDot className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
              Conectar Google
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-pill"
            onClick={() => setShowGcal(true)}
            title="Configurações do Google Calendar"
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.75} />
          </Button>

          <Button
            size="default"
            className={cn(
              "gap-1.5 rounded-card bg-dourado text-tinta hover:bg-dourado-claro",
              "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
            )}
            onClick={() => {
              setNewDate(null)
              setShowNew(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Novo evento
          </Button>
        </div>
      </header>

      {syncMsg && (
        <div className="mb-4 rounded-card border border-border bg-surface-alt px-4 py-2 text-sm text-foreground">
          {syncMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
        {/* CALENDARIO */}
        <Card className="gap-0 overflow-hidden rounded-card py-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="font-display text-[1.25rem] font-medium text-foreground">
              {monthLabel}
            </div>
            <div className="flex items-center gap-1">
              <NavBtn label="Mês anterior" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </NavBtn>
              <Button
                variant="ghost"
                size="sm"
                onClick={today}
                className="h-7 px-3 text-[0.78rem]"
              >
                Hoje
              </Button>
              <NavBtn label="Próximo mês" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </NavBtn>
            </div>
          </div>

          {isLoading ? (
            <div className="p-5">
              <Skeleton className="aspect-[7/6] w-full rounded-card" />
            </div>
          ) : isError ? (
            <div className="px-5 py-8 text-sm text-erro">
              Não foi possível carregar a agenda.
            </div>
          ) : (
            <div className="p-3">
              {/* cabecalho dos dias da semana */}
              <div className="mb-1 grid grid-cols-7 gap-1">
                {WEEKDAYS.map((w, i) => (
                  <div
                    key={`dow-${i}`}
                    className="py-1 text-center text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted"
                  >
                    {w}
                  </div>
                ))}
              </div>
              {/* 6 semanas x 7 dias */}
              <div className="grid grid-cols-7 gap-1">
                {cells.map((cell) => (
                  <DayCell
                    key={cell.key}
                    cell={cell}
                    selected={selectedDay === cell.key}
                    onClick={() => {
                      if (cell.eventos.length > 0) {
                        setSelectedDay(cell.key)
                      } else {
                        openNewForDate(cell.key)
                      }
                    }}
                    onPlusClick={() => openNewForDate(cell.key)}
                  />
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* SIDEBAR — eventos do dia focado */}
        <Card className="gap-0 overflow-hidden rounded-card py-0">
          <div className="border-b border-border px-5 py-3">
            <div className="font-sans text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-muted">
              {focusKey === todayKey ? "Hoje" : "Dia selecionado"}
            </div>
            <div className="font-display text-[1.1rem] text-foreground">
              {formatDayLong(focusKey)}
            </div>
          </div>
          <div className="px-3 py-2">
            {eventosDoDia.length === 0 ? (
              <div className="px-2 py-6 text-center font-display italic text-[0.95rem] text-muted">
                nenhum evento neste dia.
                <button
                  type="button"
                  onClick={() => openNewForDate(focusKey)}
                  className="mt-2 block w-full text-[0.78rem] font-medium text-dourado underline-offset-2 hover:underline"
                >
                  + adicionar
                </button>
              </div>
            ) : (
              <ul className="space-y-1">
                {eventosDoDia.map((ev) => (
                  <EventoLi
                    key={ev.id}
                    evento={ev}
                    onOpen={() => setEditing(ev)}
                    onOpenProcesso={() =>
                      ev.processo_id && navigate(`/processos/${ev.processo_id}`)
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Legenda */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-[0.72rem] text-muted">
        <LegendDot color="bg-erro" label="Audiência" />
        <LegendDot color="bg-dourado" label="Reunião" />
        <LegendDot color="bg-alerta" label="Prazo" />
        <LegendDot color="bg-[#3a6e9e]" label="Compromisso" />
        <LegendDot color="bg-fumaca" label="Outro" />
      </div>

      {/* Dialogs */}
      <AgendaFormDialog
        open={showNew}
        onOpenChange={(o) => {
          setShowNew(o)
          if (!o) setNewDate(null)
        }}
        defaultDate={newDate}
      />
      <AgendaFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        evento={editing}
      />
      <GcalConnectDialog
        open={showGcal}
        onOpenChange={setShowGcal}
        status={gcalStatus}
      />
    </div>
  )
}

// --------------------------------------------------------------------------

function NavBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-dourado/10 hover:text-foreground"
    >
      {children}
    </button>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} aria-hidden />
      {label}
    </span>
  )
}

interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  eventos: AgendaEvent[]
}

function DayCell({
  cell,
  selected,
  onClick,
  onPlusClick,
}: {
  cell: CalendarCell
  selected: boolean
  onClick: () => void
  onPlusClick: () => void
}) {
  const hasEvents = cell.eventos.length > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex aspect-[1/0.85] flex-col rounded-[5px] p-1.5 text-left transition-all duration-150",
        cell.inMonth ? "border border-border bg-surface" : "border border-transparent bg-surface/40",
        cell.isToday && "ring-2 ring-dourado/50",
        selected && "border-dourado bg-dourado/5",
        hasEvents && "hover-lift hover:border-dourado/40 hover:shadow-1",
        !hasEvents && cell.inMonth && "hover:bg-dourado/5 cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "tabular-nums font-mono text-[0.78rem]",
            cell.inMonth ? "text-foreground" : "text-muted/50",
            cell.isToday && "font-bold text-dourado"
          )}
        >
          {cell.day}
        </span>
        {cell.inMonth && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onPlusClick()
            }}
            className="grid h-4 w-4 place-items-center rounded-pill text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-dourado/15 hover:text-foreground"
            title="Novo evento neste dia"
            role="button"
          >
            <Plus className="h-2.5 w-2.5" strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-1 flex-col gap-0.5 overflow-hidden">
        {cell.eventos.slice(0, 3).map((ev) => {
          const dotColor = TIPO_COLOR[ev.tipo] ?? TIPO_COLOR.outro
          return (
            <div
              key={ev.id}
              className="flex items-center gap-1 truncate text-[0.65rem] leading-tight text-foreground"
              title={ev.titulo}
            >
              <span
                className={cn("h-1 w-1 shrink-0 rounded-full", dotColor)}
                aria-hidden
              />
              <span className="truncate">{ev.titulo}</span>
            </div>
          )
        })}
        {cell.eventos.length > 3 && (
          <span className="text-[0.6rem] text-muted">
            +{cell.eventos.length - 3} mais
          </span>
        )}
      </div>
    </button>
  )
}

function EventoLi({
  evento,
  onOpen,
  onOpenProcesso,
}: {
  evento: AgendaEvent
  onOpen: () => void
  onOpenProcesso: () => void
}) {
  const dotColor = TIPO_COLOR[evento.tipo] ?? TIPO_COLOR.outro
  const hora = formatHora(evento.data_inicio)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="hover-lift flex w-full items-start gap-2 rounded-card border border-transparent px-3 py-2 text-left transition-colors hover:border-dourado/30 hover:bg-dourado/5"
      >
        <span
          className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dotColor)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {hora && (
              <span className="tabular-nums shrink-0 font-mono text-[0.72rem] font-bold text-foreground">
                {hora}
              </span>
            )}
            {evento.google_event_id && (
              <span
                className="rounded-pill bg-sucesso/12 px-1 py-0 text-[0.6rem] font-medium text-sucesso"
                title="Sincronizado com Google Calendar"
              >
                GCal
              </span>
            )}
          </div>
          <div className="font-sans text-[0.85rem] font-medium leading-tight text-foreground">
            {evento.titulo}
          </div>
          {evento.local && (
            <div className="mt-0.5 text-[0.7rem] text-muted">{evento.local}</div>
          )}
          {evento.processo_titulo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenProcesso()
              }}
              className="mt-1 truncate text-[0.7rem] text-dourado underline-offset-2 hover:underline"
            >
              {evento.numero_cnj || evento.processo_titulo}
            </button>
          )}
        </div>
      </button>
    </li>
  )
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function buildCalendarCells(
  firstOfMonth: Date,
  eventos: AgendaEvent[]
): CalendarCell[] {
  const year = firstOfMonth.getFullYear()
  const month = firstOfMonth.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const start = new Date(year, month, 1 - firstWeekday)

  const eventosPorDia = new Map<string, AgendaEvent[]>()
  for (const ev of eventos) {
    const k = keyOfRaw(ev.data_inicio)
    if (!k) continue
    const list = eventosPorDia.get(k) ?? []
    list.push(ev)
    eventosPorDia.set(k, list)
  }

  const cells: CalendarCell[] = []
  const todayKey = keyOf(new Date())

  for (let i = 0; i < 42; i++) {
    const current = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i
    )
    const k = keyOf(current)
    cells.push({
      key: k,
      day: current.getDate(),
      inMonth: current.getMonth() === month,
      isToday: k === todayKey,
      eventos: eventosPorDia.get(k) ?? [],
    })
  }
  return cells
}

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function keyOfRaw(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Aceita YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS — usamos so os primeiros 10 chars
  if (raw.length >= 10) return raw.slice(0, 10)
  return null
}

function formatDayLong(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  if (!y || !m || !d) return key
  const date = new Date(y, m - 1, d)
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(date)
}

function formatHora(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Espera "YYYY-MM-DDTHH:MM:SS" ou "YYYY-MM-DDTHH:MM"
  const match = raw.match(/T(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : null
}
