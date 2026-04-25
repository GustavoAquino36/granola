/**
 * Helpers compartilhados entre ModeloAnexosPanel (modo edit, upload direto)
 * e PendingAnexosPanel (modo create, upload deferido pra apos o save).
 */

/** Bate com MAX_UPLOAD_BYTES do backend. */
export const MAX_ANEXO_BYTES = 10 * 1024 * 1024

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = reader.result as string
      const idx = result.indexOf(",")
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
