import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQuery, type QueryKey } from "@tanstack/react-query"
import { Search, X } from "lucide-react"
import { truncate } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Combobox async generico — pesquisa textual com debounce que dispara um
 * fetch parametrizado e renderiza o resultado em lista inline (sem Popover).
 *
 * Foi extraido de ClienteSearchSelect na Fase 4 pra ser reusado pelo
 * ProcessoSearchSelect (no PrazoFormDialog/DocumentoUploadDialog). A regra
 * do projeto eh: ao introduzir abstracao, refatorar o codigo antigo no
 * mesmo commit pra evitar dois estilos.
 */
export interface AsyncSearchSelectProps<T extends { id: number }> {
  /** Item atualmente selecionado (renderiza pill em vez do input). null = vazio. */
  value: T | null
  onChange: (item: T | null) => void
  /** Placeholder do input quando aberto. */
  placeholder: string
  /** Mensagem-empty quando o usuario ainda nao digitou. */
  emptyHintIdle: string
  /** Funcao que monta a queryKey a partir do termo de busca debounced. */
  buildQueryKey: (search: string) => QueryKey
  /** Funcao que dispara o fetch a partir do termo de busca debounced. */
  fetcher: (search: string) => Promise<T[]>
  /** Render da pill compacta quando ja ha selecao. */
  renderSelected: (item: T) => ReactNode
  /** Render de cada linha da lista de resultados. */
  renderOption: (item: T) => ReactNode
  /** ms de debounce. Default: 250. */
  debounceMs?: number
  /** Limite max de itens visiveis (apenas ajusta scroll). */
  maxVisible?: number
}

export function AsyncSearchSelect<T extends { id: number }>({
  value,
  onChange,
  placeholder,
  emptyHintIdle,
  buildQueryKey,
  fetcher,
  renderSelected,
  renderOption,
  debounceMs = 250,
}: AsyncSearchSelectProps<T>) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const [debouncedQuery, setDebouncedQuery] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), debounceMs)
    return () => clearTimeout(id)
  }, [query, debounceMs])

  const { data, isFetching } = useQuery({
    queryKey: buildQueryKey(debouncedQuery),
    queryFn: () => fetcher(debouncedQuery),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  if (value) {
    return (
      <div
        ref={containerRef}
        className="flex items-center gap-2 rounded-card border border-border-strong bg-surface-alt px-2.5 py-1.5"
      >
        <div className="min-w-0 flex-1">{renderSelected(value)}</div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Remover selecao"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-pill text-muted transition-colors hover:bg-erro/10 hover:text-erro"
        >
          <X className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </div>
    )
  }

  const items = data ?? []

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "flex items-center gap-2 rounded-card border border-border-strong bg-surface px-2.5 py-1.5",
          "focus-within:border-dourado"
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.75} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[0.875rem] outline-none placeholder:text-muted"
          autoComplete="off"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[240px] overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-2">
          {isFetching && (
            <div className="px-2 py-2 text-[0.75rem] text-muted">Buscando…</div>
          )}
          {!isFetching && items.length === 0 && (
            <div className="px-2 py-2 text-[0.75rem] text-muted">
              {debouncedQuery
                ? `Nenhum resultado pra "${truncate(debouncedQuery, 30)}".`
                : emptyHintIdle}
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChange(item)
                setOpen(false)
                setQuery("")
              }}
              className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left transition-colors hover:bg-dourado/8"
            >
              <div className="min-w-0 flex-1">{renderOption(item)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
