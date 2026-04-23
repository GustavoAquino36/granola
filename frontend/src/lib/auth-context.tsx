import { createContext, useCallback, useContext, useMemo } from "react"
import type { ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchMe, postLogin, postLogout } from "@/api/auth"
import { ApiError } from "@/api/client"
import type { AuthUser } from "@/types/auth"

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  /** True enquanto estamos checando a sessao (primeira carga). */
  isLoading: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const ME_KEY = ["auth", "me"] as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const meQuery = useQuery<AuthUser | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const data = await fetchMe()
        return {
          id: data.id,
          username: data.username,
          display_name: data.display_name,
          role: data.role,
          ambiente: data.ambiente,
        }
      } catch (err) {
        // 401 = nao autenticado, comportamento esperado. Qualquer outro erro vaza.
        if (err instanceof ApiError && err.status === 401) {
          return null
        }
        throw err
      }
    },
    // Sessao e leve. Refazer a cada 5min mantem a UI honesta sobre logout em outra aba.
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const loginMutation = useMutation({
    mutationFn: postLogin,
  })

  const logoutMutation = useMutation({
    mutationFn: postLogout,
  })

  const login = useCallback(
    async (username: string, password: string) => {
      const response = await loginMutation.mutateAsync({ username, password })
      const user: AuthUser = {
        id: response.user.id,
        username: response.user.username,
        display_name: response.user.display_name,
        role: response.user.role,
        ambiente: "granola",
      }
      queryClient.setQueryData(ME_KEY, user)
      return user
    },
    [loginMutation, queryClient]
  )

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync()
    } catch {
      // Backend fora do ar? Limpa sessao local de qualquer jeito.
    }
    queryClient.setQueryData(ME_KEY, null)
    // Limpa todo o cache: evita que a proxima pessoa que logar veja
    // dados do usuario anterior num flash antes do refetch.
    queryClient.clear()
  }, [logoutMutation, queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      isAuthenticated: meQuery.data != null,
      isLoading: meQuery.isLoading,
      login,
      logout,
    }),
    [meQuery.data, meQuery.isLoading, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth precisa estar dentro de <AuthProvider>")
  }
  return ctx
}
