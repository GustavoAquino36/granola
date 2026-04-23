import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { fetchAgenda, fetchPrazos, queryKeys } from "@/api/granola"
import { describeDeadline } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/card"

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"]

export function MiniCalendario() {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const mesStr = useMemo(
    () => `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`,
    [visibleMonth]
  )

  const { data: agendaResponse } = useQuery({
    queryKey: queryKeys.agenda({ mes: mesStr }),
    queryFn: () => fetchAgenda({ mes: mesStr }),
  })

  const { data: prazosResponse } = useQuery({
    queryKey: queryKeys.prazos({ status: "pendente" }),
    queryFn: () => fetchPrazos({ status: "pendente" }),
    // Mesmo key que ProximosPrazosCard => cache compartilhado.
  })

  const cells = useMemo(
    () => buildCalendarCells(visibleMonth, agendaResponse?.eventos ?? [], prazosResponse?.prazos ?? []),
    [visibleMonth, agendaResponse, prazosResponse]
  )

  const monthLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
    const raw = fmt.format(visibleMonth)
    // Capitalize primeira letra
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }, [visibleMonth])

  function prevMonth() {
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  }
  function nextMonth() {
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-card py-0">
      <CardHeader className="flex items-center border-b border-border px-5 py-3">
        <CardTitle className="font-display text-[1.15rem] font-medium text-foreground">
          {monthLabel}
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <NavButton label="Mes anterior" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </NavButton>
          <NavButton label="Proximo mes" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </NavButton>
        </CardAction>
      </CardHeader>

      <div className="px-5 py-4">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w, i) => (
            <div
              key={`dow-${i}`}
              className="text-center text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted py-1"
            >
              {w}
            </div>
          ))}
          {cells.map((cell) => (
            <DayCell key={cell.key} cell={cell} />
          ))}
        </div>

        {/* Legenda */}
        <div className="mt-4 flex items-center gap-4 text-[0.7rem] text-muted">
          <LegendDot color="bg-dourado" label="Compromisso" />
          <LegendDot color="bg-erro" label="Prazo fatal" />
        </div>
      </div>
    </Card>
  )
}

// --------------------------------------------------------------------------

interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  hasEvent: boolean
  hasFatal: boolean
}

function DayCell({ cell }: { cell: CalendarCell }) {
  return (
    <div
      className={cn(
        "relative aspect-square grid place-items-center rounded-[5px] text-[0.78rem] font-mono tabular-nums transition-colors duration-150",
        cell.inMonth ? "text-foreground" : "text-muted/50",
        cell.isToday
          ? "bg-dourado font-semibold text-tinta"
          : "hover:bg-dourado/10 cursor-pointer"
      )}
      aria-current={cell.isToday ? "date" : undefined}
    >
      {cell.day}
      {cell.hasEvent && !cell.hasFatal && (
        <span
          className={cn(
            "absolute bottom-1 h-1 w-1 rounded-full",
            cell.isToday ? "bg-tinta" : "bg-dourado"
          )}
          aria-hidden
        />
      )}
      {cell.hasFatal && (
        <span
          className={cn(
            "absolute bottom-1 h-1 w-1 rounded-full",
            cell.isToday ? "bg-tinta" : "bg-erro"
          )}
          aria-hidden
        />
      )}
    </div>
  )
}

function NavButton({
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

// --------------------------------------------------------------------------
// Monta as 42 celulas (6 semanas x 7 dias) pro calendario
// --------------------------------------------------------------------------

interface DayMark {
  hasEvent: boolean
  hasFatal: boolean
}

function buildCalendarCells(
  firstOfMonth: Date,
  agenda: { data_inicio: string }[],
  prazos: { data_vencimento: string; prioridade?: string }[]
): CalendarCell[] {
  const year = firstOfMonth.getFullYear()
  const month = firstOfMonth.getMonth()

  // Primeiro dia visivel (pode ser do mes anterior).
  const firstWeekday = new Date(year, month, 1).getDay() // 0 = Dom
  const start = new Date(year, month, 1 - firstWeekday)

  // Marcacoes por dia (chave = YYYY-MM-DD)
  const marks = new Map<string, DayMark>()
  function mark(key: string, patch: Partial<DayMark>) {
    const prev = marks.get(key) ?? { hasEvent: false, hasFatal: false }
    marks.set(key, { ...prev, ...patch })
  }

  for (const ev of agenda) {
    const d = parseDay(ev.data_inicio)
    if (d) mark(keyOf(d), { hasEvent: true })
  }

  for (const pz of prazos) {
    const d = parseDay(pz.data_vencimento)
    if (!d) continue
    const deadline = describeDeadline(d)
    const isFatal =
      deadline.status === "vencido" ||
      deadline.status === "hoje" ||
      (deadline.status === "urgente" && pz.prioridade === "alta")
    mark(keyOf(d), isFatal ? { hasFatal: true } : { hasEvent: true })
  }

  const cells: CalendarCell[] = []
  const today = new Date()
  const todayKey = keyOf(today)

  for (let i = 0; i < 42; i++) {
    const current = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const k = keyOf(current)
    const m = marks.get(k)
    cells.push({
      key: k,
      day: current.getDate(),
      inMonth: current.getMonth() === month,
      isToday: k === todayKey,
      hasEvent: m?.hasEvent ?? false,
      hasFatal: m?.hasFatal ?? false,
    })
  }

  return cells
}

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Aceita YYYY-MM-DD, DD/MM/YYYY, ISO com T. */
function parseDay(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return new Date(+br[3], +br[2] - 1, +br[1])
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3])
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}
