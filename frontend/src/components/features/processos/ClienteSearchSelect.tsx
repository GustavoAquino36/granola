import { fetchClientes, queryKeys } from "@/api/granola"
import type { Cliente } from "@/types/domain"
import { formatCpfCnpj } from "@/lib/format"
import { AsyncSearchSelect } from "@/components/shared/AsyncSearchSelect"

/**
 * Combobox async pra cliente. Wrapper do AsyncSearchSelect generico que
 * conhece o shape de Cliente — mantem a ergonomia historica de receber
 * apenas `value` (id) + `selectedPreview` para evitar fetch redundante.
 */
type ClientePreview = Pick<Cliente, "id" | "nome" | "cpf_cnpj" | "tipo">

interface ClienteSearchSelectProps {
  value: number | null | undefined
  onChange: (clienteId: number | null) => void
  /** Preview do cliente selecionado. Se passado, evita o fetch extra de cliente por id. */
  selectedPreview?: ClientePreview | null
}

export function ClienteSearchSelect({
  value,
  onChange,
  selectedPreview,
}: ClienteSearchSelectProps) {
  const selected =
    selectedPreview && selectedPreview.id === value ? selectedPreview : null

  return (
    <AsyncSearchSelect<ClientePreview>
      value={selected}
      onChange={(item) => onChange(item ? item.id : null)}
      placeholder="Buscar cliente por nome, CPF/CNPJ…"
      emptyHintIdle="Digite pra buscar clientes."
      buildQueryKey={(search) =>
        queryKeys.clientes({
          busca: search || undefined,
          ativo: 1,
          limite: 10,
        })
      }
      fetcher={async (search) => {
        const data = await fetchClientes({
          busca: search || undefined,
          ativo: 1,
          limite: 10,
        })
        return data.clientes
      }}
      renderSelected={(c) => (
        <>
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
        </>
      )}
      renderOption={(c) => (
        <>
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
        </>
      )}
    />
  )
}
