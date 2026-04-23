import { createContext, useContext } from "react"
import type { AuthUser } from "@/types/auth"

export interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  /** True enquanto estamos checando a sessao (primeira carga). */
  isLoading: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/** Key padrao do TanStack Query pra /api/auth/me. Compartilhada entre
 *  provider e hooks que precisam invalidar manualmente a sessao. */
export const AUTH_ME_KEY = ["auth", "me"] as const

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth precisa estar dentro de <AuthProvider>")
  }
  return ctx
}
