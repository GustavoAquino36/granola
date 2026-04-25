import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react"
import { fetchConfig, queryKeys, setConfig } from "@/api/granola"
import type { OabConfig } from "@/types/domain"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const CONFIG_KEY = "djen_oabs"

/**
 * Editor da configuracao DJEN — lista de OABs (UF + numero + nome opcional).
 * Persistida em granola_config.djen_oabs como JSON. O coletor DJEN faz
 * 1 chamada por OAB nessa lista pra trazer todas as comunicacoes oficiais.
 *
 * Padrao: o componente externo so monta o Inner quando data ja carregou,
 * com `key` pra forcar remount ao trocar valor — evita useEffect+setState
 * pra hidratar local state (regra do projeto: React Compiler complaint).
 */
export function OabsConfigEditor() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.config(CONFIG_KEY),
    queryFn: () => fetchConfig(CONFIG_KEY),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }
  if (isError) {
    return (
      <p className="rounded-card border-l-2 border-erro bg-erro/8 px-3 py-2 text-sm text-erro">
        Não foi possível carregar a configuração.
      </p>
    )
  }

  return <OabsEditorInner key={data?.value ?? ""} initialValue={data?.value ?? ""} />
}

function OabsEditorInner({ initialValue }: { initialValue: string }) {
  const queryClient = useQueryClient()

  const [oabs, setOabs] = useState<OabConfig[]>(() => parseOabs(initialValue))
  const [dirty, setDirty] = useState(false)

  const mutation = useMutation({
    mutationFn: () => setConfig(CONFIG_KEY, JSON.stringify(oabs)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config(CONFIG_KEY) })
      setDirty(false)
    },
  })

  function addOab() {
    setOabs((prev) => [...prev, { uf: "SP", numero: "", nome: "" }])
    setDirty(true)
  }
  function removeOab(idx: number) {
    setOabs((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }
  function updateOab(idx: number, patch: Partial<OabConfig>) {
    setOabs((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, ...patch } : o))
    )
    setDirty(true)
  }

  return (
    <div className="space-y-3">
      {oabs.length === 0 ? (
        <p className="rounded-card border border-border bg-surface-alt px-4 py-3 font-display italic text-base text-muted">
          Nenhuma OAB configurada. A coleta DJEN não vai trazer comunicações até
          adicionar pelo menos uma.
        </p>
      ) : (
        <ul className="space-y-2">
          {oabs.map((oab, idx) => (
            <li
              key={idx}
              className="grid grid-cols-[60px_140px_1fr_36px] items-center gap-2"
            >
              <Input
                value={oab.uf}
                onChange={(e) =>
                  updateOab(idx, { uf: e.target.value.toUpperCase().slice(0, 2) })
                }
                maxLength={2}
                className="text-center font-mono uppercase"
                placeholder="UF"
                aria-label="UF"
              />
              <Input
                value={oab.numero}
                onChange={(e) =>
                  updateOab(idx, { numero: e.target.value.replace(/\D/g, "") })
                }
                className="font-mono"
                placeholder="000000"
                aria-label="Número"
              />
              <Input
                value={oab.nome ?? ""}
                onChange={(e) => updateOab(idx, { nome: e.target.value })}
                placeholder="Nome do advogado (opcional)"
                aria-label="Nome"
              />
              <button
                type="button"
                onClick={() => removeOab(idx)}
                aria-label="Remover OAB"
                className="grid h-9 w-9 place-items-center rounded-pill bg-transparent text-muted transition-colors hover:bg-erro/10 hover:text-erro"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addOab}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Adicionar OAB
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!dirty || mutation.isPending || hasInvalid(oabs)}
          className={cn(
            "gap-1.5 bg-dourado text-tinta hover:bg-dourado-claro",
            "hover:shadow-[0_4px_12px_-4px_rgba(198,158,91,0.6)]"
          )}
        >
          {mutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : mutation.isSuccess && !dirty ? (
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
          ) : null}
          Salvar configuração
        </Button>
        {mutation.isError && (
          <span className="text-sm text-erro">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Não foi possível salvar."}
          </span>
        )}
        {hasInvalid(oabs) && (
          <span className="text-[0.78rem] text-erro">
            Preencha UF e número de cada OAB antes de salvar.
          </span>
        )}
      </div>
    </div>
  )
}

function hasInvalid(oabs: OabConfig[]): boolean {
  return oabs.some(
    (o) => !o.uf || o.uf.length !== 2 || !o.numero || o.numero.length < 3
  )
}

function parseOabs(raw: string): OabConfig[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
