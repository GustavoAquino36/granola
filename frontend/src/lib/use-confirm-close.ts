import { useCallback } from "react"

/**
 * Helper pra Dialogs que tem form com mudancas nao salvas.
 *
 * Uso:
 *   const isDirty = form.formState.isDirty
 *   const handleOpenChange = useConfirmCloseOnDirty(isDirty, onOpenChange)
 *   <Dialog open={open} onOpenChange={handleOpenChange}>
 *
 * Quando dirty=true e o user tenta fechar (overlay/Esc/Cancel), pergunta
 * via window.confirm. Quando dirty=false, fecha direto.
 *
 * Por que nao usar AlertDialog interno? Confirmar perda de dados eh
 * justamente uma situacao em que `confirm` nativo eh OK — bloqueante,
 * ouvido pra screen readers, e nao acumula UI dentro de UI.
 */
export function useConfirmCloseOnDirty(
  isDirty: boolean,
  onOpenChange: (open: boolean) => void
) {
  return useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true)
        return
      }
      // Tentando fechar
      if (!isDirty) {
        onOpenChange(false)
        return
      }
      const ok = window.confirm(
        "Você tem alterações não salvas. Fechar mesmo assim?"
      )
      if (ok) onOpenChange(false)
    },
    [isDirty, onOpenChange]
  )
}
