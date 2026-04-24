import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, X } from "lucide-react"
import { fetchClientes, queryKeys } from "@/api/granola"
import type { Cliente } from "@/types/domain"
import { formatCpfCnpj, truncate } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ClienteSearchSelectProps {
  value: number | null | undefined
  onChange: (clienteId: number | null) => void
  /** Preview do cliente selecionado. Se passado, evita o fetch extra de cliente por id. */
  selectedPreview?: Pick<Cliente, "id" | "nome" | "cpf_cnpj" | "tipo"> | null
}

/**
 * Combobox simples pra selecionar cliente. Sem Popover — usa lista inline
 * aberta quando o input tem foco.
 * Busca vai pro backend com debounce de 250ms.
 */
export function ClienteSearchSelect({
  value,
  onChange,
  selectedPreview,
}: ClienteSearchSelectProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounce manual — aguarda 250ms sem mudancas antes de firar o fetch
  const [debouncedQuery, setDebouncedQuery] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  const { data, isFetching } = useQuery({
    queryKey: queryKeys.clientes({
      busca: debouncedQuery || undefined,
      ativo: 1,
      limite: 10,
    }),
    queryFn: () =>
      fetchClientes({
        busca: debouncedQuery || undefined,
        ativo: 1,
        limite: 10,
      }),
    enabled: open,
  })

  // Fecha ao clicar fora
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

  // Estado selected: se nao temos preview mas temos value, mostra "cliente #ID"
  const selected =
    selectedPreview && selectedPreview.id === value ? selectedPreview : null

  if (value && selected) {
    return (
      <div
        ref={containerRef}
        className="flex items-center gap-2 rounded-card border border-border-strong bg-surface-alt px-2.5 py-1.5"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-[0.875rem] font-medium text-foreground">
            {selected.nome}
          </div>
          {selected.cpf_cnpj && (
            <div className="truncate tabular-nums font-mono text-[0.7rem] text-muted">
              {formatCpfCnpj(selected.cpf_cnpj)}
              {" · "}
              {selected.tipo}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Remover cliente"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-pill text-muted transition-colors hover:bg-erro/10 hover:text-erro"
        >
          <X className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </div>
    )
  }

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
          placeholder="Buscar cliente por nome, CPF/CNPJ…"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[0.875rem] outline-none placeholder:text-muted"
          autoComplete="off"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[240px] overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-2">
          {isFetching && (
            <div className="px-2 py-2 text-[0.75rem] text-muted">
              Buscando…
            </div>
          )}
          {!isFetching && (data?.clientes ?? []).length === 0 && (
            <div className="px-2 py-2 text-[0.75rem] text-muted">
              {debouncedQuery
                ? `Nenhum cliente com "${truncate(debouncedQuery, 30)}".`
                : "Digite pra buscar clientes."}
            </div>
          )}
          {(data?.clientes ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id)
                setOpen(false)
                setQuery("")
              }}
              className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left transition-colors hover:bg-dourado/8"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-sans text-[0.875rem] font-medium text-foreground">
                  {c.nome}
                </div>
                {c.cpf_cnpj && (
                  <div className="truncate tabular-nums font-mono text-[0.7rem] text-muted">
                    {formatCpfCnpj(c.cpf_cnpj)}
                    {" · "}
                    {c.tipo}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
