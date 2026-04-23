import { useCallback, useEffect, useState } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "granola:theme"

/** Le a preferencia atual — tratando inicializacao em SSR-safe. */
function readTheme(): Theme {
  if (typeof document === "undefined") return "light"
  const attr = document.documentElement.dataset.theme
  if (attr === "dark") return "dark"
  return "light"
}

function writeTheme(theme: Theme) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* localStorage bloqueado (modo privado) — ignora silenciosamente */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readTheme())

  useEffect(() => {
    // Sincroniza se algo trocar fora do hook (ex: outra aba).
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
        writeTheme(e.newValue)
        setTheme(e.newValue)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark"
      writeTheme(next)
      return next
    })
  }, [])

  return { theme, toggle }
}
