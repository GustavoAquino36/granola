import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { FileText, Plus, Search } from "lucide-react"
import { fetchModelos, queryKeys } from "@/api/granola"
import type { ModeloResumo } from "@/types/domain"
import { CATEGORIAS_MODELO } from "@/components/features/modelos/categorias"
import { formatDate, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type FiltroCategoria = "todas" | string

export function ModelosPage() {
  const navigate = useNavigate()
  const [busca, setBusca] = useState("")
  const [categoria, setCategoria] = useState<FiltroCategoria>("todas")

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.modelos({}),
    queryFn: () => fetchModelos({}),
  })

  const todos = useMemo(() => data?.modelos ?? [], [data])

  // Conta modelos por categoria pra mostrar na chip — UX ajuda a saber
  // onde ha conteudo sem precisar clicar em todas
  const countsByCategoria = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of todos) {
      const k = (m.categoria ?? "outros").toLowerCase()
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return map
  }, [todos])

  const filtrados = useMemo(() => {
    const buscaTrim = busca.trim().toLowerCase()
    return todos.filter((m) => {
      if (
        categoria !== "todas" &&
        (m.categoria ?? "").toLowerCase() !== categoria
      )
        return false
      if (!buscaTrim) return true
      return (
        m.nome.toLowerCase().includes(buscaTrim) ||
        (m.descricao ?? "").toLowerCase().includes(buscaTrim) ||
        (m.tags ?? "").toLowerCase().includes(buscaTrim)
      )
    })
  }, [todos, busca, categoria])

  return (
    <div className="px-8 py-8 lg:px-10 lg:py-10">
      {/* HEADER — fiel ao mock do Dr. Claudio */}
      <header className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-normal leading-[1.15] text-foreground md:text-[2.1rem]">
            Modelos
          </h1>
          <p className="font-display mt-1.5 text-base italic text-muted">
            {isLoading
              ? "carregando…"
              : `${todos.length} ${todos.length === 1 ? "peça pronta" : "peças prontas"} · versionamento automático · clonável e editável`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/modelos/novo")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-card bg-dourado px-4 py-2",
            "font-sans text-[0.875rem] font-semibold text-tinta transition-all duration-[180ms]",
            "hover:bg-dourado-claro hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Novo modelo
        </button>
      </header>

      {/* Filtro de categoria — bar separado, fiel ao mock */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface-alt px-5 py-3">
        <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted">
          Categoria
        </span>
        <CategoriaChip
          active={categoria === "todas"}
          onClick={() => setCategoria("todas")}
        >
          Todas
          {categoria === "todas" && (
            <span className="ml-1.5 text-[0.7rem] opacity-70">×</span>
          )}
        </CategoriaChip>
        {CATEGORIAS_MODELO.map((cat) => {
          const count = countsByCategoria.get(cat.value) ?? 0
          if (count === 0 && categoria !== cat.value) return null
          return (
            <CategoriaChip
              key={cat.value}
              active={categoria === cat.value}
              onClick={() =>
                setCategoria(categoria === cat.value ? "todas" : cat.value)
              }
            >
              {cat.label}
              {count > 0 && (
                <span
                  className={cn(
                    "ml-1.5 text-[0.65rem]",
                    categoria === cat.value ? "opacity-70" : "text-muted"
                  )}
                >
                  {count}
                </span>
              )}
            </CategoriaChip>
          )
        })}
        <div className="ml-auto min-w-0 w-full max-w-[280px] md:w-[260px]">
          <div
            className={cn(
              "flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1 text-muted transition-all",
              "focus-within:border-dourado"
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nome, descrição, tag…"
              className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
      </div>

      {/* GRID DE CARDS */}
      {isLoading ? (
        <ModelosLoading />
      ) : isError ? (
        <div className="rounded-card border border-erro/30 bg-erro/5 px-4 py-3 text-sm text-erro">
          Não foi possível carregar os modelos.
        </div>
      ) : filtrados.length === 0 ? (
        <EmptyState busca={busca} categoria={categoria} hasAny={todos.length > 0} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtrados.map((m) => (
            <ModeloCard
              key={m.id}
              modelo={m}
              onClick={() => navigate(`/modelos/${m.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------

function ModeloCard({
  modelo,
  onClick,
}: {
  modelo: ModeloResumo
  onClick: () => void
}) {
  const cat = CATEGORIAS_MODELO.find(
    (c) => c.value === (modelo.categoria ?? "").toLowerCase()
  )
  const catLabel = cat?.label ?? modelo.categoria ?? "outros"
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "hover-lift group flex h-full flex-col rounded-card border border-border bg-surface px-5 py-4 text-left transition-all",
        "hover:border-dourado/40 hover:shadow-2"
      )}
    >
      {/* Eyebrow: CATEGORIA · v N */}
      <div className="flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-[0.18em]">
        <span className="text-dourado">{catLabel}</span>
        <span className="tabular-nums font-mono text-muted">
          · v {modelo.versao}
        </span>
      </div>
      {/* Titulo Cormorant */}
      <h3 className="font-display mt-2.5 text-[1.25rem] font-medium leading-tight text-foreground">
        {truncate(modelo.nome, 60)}
      </h3>
      {/* Descricao */}
      {modelo.descricao && (
        <p className="mt-1.5 text-[0.84rem] leading-snug text-muted">
          {truncate(modelo.descricao, 120)}
        </p>
      )}
      {/* Footer mono */}
      <div className="tabular-nums mt-auto pt-3 font-mono text-[0.7rem] text-muted">
        {modelo.usos} {modelo.usos === 1 ? "uso" : "usos"}
        {" · atualizado "}
        {formatDate(modelo.atualizado_em ?? modelo.criado_em)}
        {modelo.total_anexos > 0 && (
          <>
            {" · "}
            <span title={`${modelo.total_anexos} anexo${modelo.total_anexos === 1 ? "" : "s"}`}>
              📎 {modelo.total_anexos}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

function CategoriaChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-pill border px-3 py-1 text-[0.78rem] font-medium transition-colors duration-[180ms]",
        active
          ? "border-tinta bg-tinta text-marfim"
          : "border-border-strong bg-surface text-foreground hover:border-dourado"
      )}
    >
      {children}
    </button>
  )
}

function ModelosLoading() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="rounded-card py-0">
          <div className="px-5 py-4 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  )
}

function EmptyState({
  busca,
  categoria,
  hasAny,
}: {
  busca: string
  categoria: FiltroCategoria
  hasAny: boolean
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-5 py-12 text-center">
      <FileText
        className="mx-auto mb-4 h-8 w-8 text-muted/60"
        strokeWidth={1.5}
      />
      <p className="font-display italic text-lg text-muted">
        {hasAny
          ? busca
            ? "Nenhum modelo bate com essa busca."
            : `Nenhum modelo na categoria selecionada.`
          : "Nenhum modelo criado ainda."}
      </p>
      {!hasAny && (
        <p className="mt-2 text-sm text-muted">
          Templates seus, totalmente personalizáveis. Clique em{" "}
          <strong className="text-foreground">Novo modelo</strong> pra começar.
        </p>
      )}
      {hasAny && categoria !== "todas" && !busca && (
        <p className="mt-2 text-sm text-muted">
          Crie um novo modelo nessa categoria ou troque o filtro pra "Todas".
        </p>
      )}
    </div>
  )
}
