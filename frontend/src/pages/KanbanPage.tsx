import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  fetchKanban,
  moveProcessoKanban,
  queryKeys,
} from "@/api/granola"
import type { KanbanCard, KanbanColuna, KanbanResponse } from "@/types/domain"
import { formatCNJ, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Kanban v2: substitui o HTML5 native drag do monolito por @dnd-kit.
 * - A11y: arraste por teclado funciona (KeyboardSensor)
 * - Touch: PointerSensor cobre mobile sem polyfill
 * - Optimistic update: ao soltar, refresca a lista invalidando o cache
 *
 * Paridade com legado: cards de processos status='ativo', click vai pra detalhe.
 * CRUD de colunas continua admin-only no backend (sem UI no frontend hoje, igual legacy).
 */
export function KanbanPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<number | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.kanban,
    queryFn: fetchKanban,
  })

  const colunas = useMemo(() => data?.colunas ?? [], [data])

  // Mapa rapido pra achar o card sendo arrastado pra mostrar no DragOverlay
  const cardById = useMemo(() => {
    const m = new Map<number, { card: KanbanCard; coluna: KanbanColuna }>()
    for (const col of colunas) {
      for (const c of col.cards) m.set(c.id, { card: c, coluna: col })
    }
    return m
  }, [colunas])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor)
  )

  /**
   * Move otimisticamente: ao soltar, atualizo o cache local IMEDIATAMENTE
   * pra que o card ja apareca na coluna destino. Assim o dropAnimation
   * default do dnd-kit (que anima do ponto do cursor ate a posicao final
   * do draggable com mesmo id) consegue achar o destino correto e a
   * animacao toca no sentido certo (cursor → destino).
   *
   * Se a mutation falhar, invalida o cache pra reverter.
   */
  const moveMutation = useMutation({
    mutationFn: ({
      processoId,
      coluna,
    }: {
      processoId: number
      coluna: string
    }) => moveProcessoKanban(processoId, coluna),
    onError: () => {
      // Reverte o optimistic update
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban })
    },
    onSuccess: () => {
      // Refresca processos pra refletir a nova kanban_coluna em outras telas
      queryClient.invalidateQueries({ queryKey: ["granola", "processos"] })
    },
  })

  function onDragStart(event: DragStartEvent) {
    setActiveId(Number(event.active.id))
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const processoId = Number(active.id)
    const targetColuna = String(over.id)
    const fromColuna = cardById.get(processoId)?.coluna.key
    if (!fromColuna || fromColuna === targetColuna) return

    // Optimistic update SINCRONO — antes de chamar o backend.
    // Move o card de fromColuna pra targetColuna no cache do TanStack
    // pra que o React renderize o destino imediatamente. O dropAnimation
    // do dnd-kit detecta o draggable na nova posicao e anima ate la.
    queryClient.setQueryData<KanbanResponse>(queryKeys.kanban, (prev) => {
      if (!prev) return prev
      let movedCard: KanbanCard | undefined
      const colunasSemCard = prev.colunas.map((col) => {
        if (col.key !== fromColuna) return col
        const idx = col.cards.findIndex((c) => c.id === processoId)
        if (idx < 0) return col
        movedCard = col.cards[idx]
        return { ...col, cards: col.cards.filter((c) => c.id !== processoId) }
      })
      if (!movedCard) return prev
      const next = { ...movedCard, kanban_coluna: targetColuna }
      return {
        ...prev,
        colunas: colunasSemCard.map((col) =>
          col.key === targetColuna
            ? { ...col, cards: [next, ...col.cards] }
            : col
        ),
      }
    })

    moveMutation.mutate({ processoId, coluna: targetColuna })
  }

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      <header className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Kanban
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading
              ? "carregando…"
              : `${totalCards(colunas)} processos · ${colunas.length} colunas`}
          </p>
        </div>
      </header>

      {isLoading ? (
        <KanbanLoading />
      ) : isError ? (
        <div className="rounded-card border border-erro/30 bg-erro/5 px-4 py-3 text-sm text-erro">
          Não foi possível carregar o board.
        </div>
      ) : colunas.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-5 py-12 text-center">
          <p className="font-display italic text-lg text-muted">
            Nenhuma coluna configurada ainda.
          </p>
          <p className="mt-2 text-sm text-muted">
            Configuração de colunas é feita pelo admin no backend (
            <code className="font-mono text-[0.75rem]">/api/granola/kanban/coluna</code>
            ).
          </p>
        </div>
      ) : (
        <>
          {totalCards(colunas) === 0 && (
            <div className="mb-4 rounded-card border border-border bg-surface-alt px-5 py-4">
              <p className="font-display italic text-base text-foreground">
                Nenhum processo está atribuído a uma coluna ainda.
              </p>
              <p className="mt-1 text-[0.84rem] text-muted">
                Processos novos aparecem em <strong>Novo</strong> automaticamente.
                Em <a href="/processos" className="text-dourado underline-offset-2 hover:underline">/processos</a> você
                pode editar cada um e atribuir uma coluna; ou arraste-os aqui mesmo quando aparecerem.
              </p>
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <div
              className="flex gap-4 overflow-x-auto pb-4"
              style={{ scrollbarGutter: "stable" }}
            >
              {colunas.map((col) => (
                <KanbanColumn
                  key={col.key}
                  coluna={col}
                  onCardClick={(id) => navigate(`/processos/${id}`)}
                />
              ))}
            </div>

            <DragOverlay>
              {activeId !== null && cardById.has(activeId) ? (
                <CardView card={cardById.get(activeId)!.card} dragging />
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------

function KanbanColumn({
  coluna,
  onCardClick,
}: {
  coluna: KanbanColuna
  onCardClick: (processoId: number) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.key })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-card border border-border bg-surface-alt transition-colors",
        isOver && "border-dourado bg-dourado/5"
      )}
    >
      <div
        className="flex items-center justify-between border-b border-border px-3 py-2.5"
        style={{ borderLeft: `3px solid ${coluna.cor || "#332030"}` }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: coluna.cor || "#332030" }}
            aria-hidden
          />
          <span className="font-sans text-[0.875rem] font-semibold text-foreground">
            {coluna.label}
          </span>
        </div>
        <span className="tabular-nums rounded-pill bg-surface px-2 py-0.5 font-mono text-[0.7rem] font-bold text-muted">
          {coluna.cards.length}
        </span>
      </div>

      <div className="flex min-h-[140px] flex-col gap-2 p-2">
        {coluna.cards.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center px-2 py-6 text-[1.5rem] text-muted/30"
            aria-label="Coluna vazia"
          >
            —
          </div>
        ) : (
          coluna.cards.map((c) => (
            <DraggableCard
              key={c.id}
              card={c}
              onClick={() => onCardClick(c.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DraggableCard({
  card,
  onClick,
}: {
  card: KanbanCard
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  })
  const titulo = card.titulo || card.numero_cnj || `Processo #${card.id}`
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Arrastar ${titulo} para outra coluna ou pressionar Enter para abrir`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        "cursor-grab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dourado/40 focus-visible:rounded-card",
        isDragging && "opacity-30"
      )}
    >
      <CardView card={card} />
    </div>
  )
}

function CardView({
  card,
  dragging,
}: {
  card: KanbanCard
  dragging?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface px-3 py-2.5 shadow-1",
        !dragging && "hover-lift hover:border-dourado/40 hover:shadow-2",
        dragging && "rotate-1 shadow-elev ring-2 ring-dourado/40"
      )}
    >
      <div className="text-[0.84rem] font-medium leading-snug text-foreground">
        {truncate(card.titulo || formatCNJ(card.numero_cnj || "") || `Processo #${card.id}`, 60)}
      </div>
      {card.cliente_nome && (
        <div className="mt-1 text-[0.72rem] text-muted">
          {truncate(card.cliente_nome, 32)}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        {card.area && (
          <span className="rounded-pill bg-tinta/8 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-tinta">
            {card.area}
          </span>
        )}
        {card.numero_cnj && (
          <span className="tabular-nums truncate font-mono text-[0.65rem] text-muted">
            {formatCNJ(card.numero_cnj)}
          </span>
        )}
      </div>
    </div>
  )
}

function KanbanLoading() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="w-[280px] shrink-0 rounded-card border border-border bg-surface-alt"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-8 rounded-pill" />
          </div>
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-16 w-full rounded-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function totalCards(colunas: KanbanColuna[]): number {
  return colunas.reduce((acc, c) => acc + c.cards.length, 0)
}
