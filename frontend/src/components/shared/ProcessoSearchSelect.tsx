import { fetchProcessos, queryKeys } from "@/api/granola"
import type { Processo } from "@/types/domain"
import { formatCNJ } from "@/lib/format"
import { AsyncSearchSelect } from "./AsyncSearchSelect"

/**
 * Combobox async pra processo — mesmo padrao do ClienteSearchSelect, usa o
 * AsyncSearchSelect generico embaixo. Preview opcional pra modo edit evitar
 * fetch redundante.
 */
type ProcessoPreview = Pick<
  Processo,
  "id" | "numero_cnj" | "titulo" | "cliente_nome" | "area"
>

interface ProcessoSearchSelectProps {
  value: number | null | undefined
  onChange: (processoId: number | null) => void
  selectedPreview?: ProcessoPreview | null
}

export function ProcessoSearchSelect({
  value,
  onChange,
  selectedPreview,
}: ProcessoSearchSelectProps) {
  const selected =
    selectedPreview && selectedPreview.id === value ? selectedPreview : null

  return (
    <AsyncSearchSelect<ProcessoPreview>
      value={selected}
      onChange={(item) => onChange(item ? item.id : null)}
      placeholder="Buscar processo por CNJ, titulo, cliente…"
      emptyHintIdle="Digite pra buscar processos."
      buildQueryKey={(search) =>
        queryKeys.processos({
          busca: search || undefined,
          limite: 10,
        })
      }
      fetcher={async (search) => {
        const data = await fetchProcessos({
          busca: search || undefined,
          limite: 10,
        })
        return data.processos
      }}
      renderSelected={(p) => (
        <>
          <div className="truncate font-sans text-[0.875rem] font-medium text-foreground">
            {p.titulo || (p.numero_cnj ? formatCNJ(p.numero_cnj) : `Processo #${p.id}`)}
          </div>
          <div className="truncate tabular-nums font-mono text-[0.7rem] text-muted">
            {p.numero_cnj ? formatCNJ(p.numero_cnj) : "sem CNJ"}
            {p.cliente_nome ? ` · ${p.cliente_nome}` : ""}
          </div>
        </>
      )}
      renderOption={(p) => (
        <>
          <div className="truncate font-sans text-[0.875rem] font-medium text-foreground">
            {p.titulo || (p.numero_cnj ? formatCNJ(p.numero_cnj) : `Processo #${p.id}`)}
          </div>
          <div className="truncate tabular-nums font-mono text-[0.7rem] text-muted">
            {p.numero_cnj ? formatCNJ(p.numero_cnj) : "sem CNJ"}
            {p.cliente_nome ? ` · ${p.cliente_nome}` : ""}
            {p.area ? ` · ${p.area}` : ""}
          </div>
        </>
      )}
    />
  )
}
