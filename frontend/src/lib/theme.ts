import { useCallback, useSyncExternalStore } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "granola:theme"

/** Subscribers que reagem quando o tema muda (em qualquer aba ou no mesmo tab). */
const subscribers = new Set<() => void>()

function emit() {
  for (const sub of subscribers) sub()
}

/** Le o tema atual — primeira fonte: dataset do <html>; fallback: localStorage. */
function readTheme(): Theme {
  if (typeof document === "undefined") return "light"
  const attr = document.documentElement.dataset.theme
  if (attr === "dark") return "dark"
  if (attr === "light") return "light"
  // Fallback: localStorage (caso o atributo nao tenha sido aplicado ainda)
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "dark") return "dark"
  } catch {
    /* ignore */
  }
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
  emit()
}

/** Listener de storage events (sync entre abas). Registrado uma vez. */
let storageBound = false
function bindStorageListener() {
  if (storageBound || typeof window === "undefined") return
  storageBound = true
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
      // Outra aba mudou — escreve no DOM e notifica subscribers locais
      document.documentElement.dataset.theme = e.newValue
      emit()
    }
  })
}

function subscribe(callback: () => void) {
  bindStorageListener()
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

/**
 * Hook de tema com estado **compartilhado** entre todas as instâncias.
 * Antes (bug): cada call de useTheme criava useState próprio, então o
 * botão da Topbar não sabia quando ConfigPage trocava o tema. Agora todos
 * leem da mesma fonte (document.documentElement.dataset.theme) via
 * useSyncExternalStore + pub-sub, então qualquer mudança propaga em
 * tempo real pra todos os consumidores.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme)

  const toggle = useCallback(() => {
    const current = readTheme()
    writeTheme(current === "dark" ? "light" : "dark")
  }, [])

  const setThemeExplicit = useCallback((next: Theme) => {
    writeTheme(next)
  }, [])

  return { theme, toggle, setTheme: setThemeExplicit }
}
