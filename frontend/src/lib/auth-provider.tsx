import { useCallback, useMemo } from "react"
import type { ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchMe, postLogin, postLogout } from "@/api/auth"
import { ApiError } from "@/api/client"
import {
  AUTH_ME_KEY,
  AuthContext,
  type AuthContextValue,
} from "./auth-context"
import type { AuthUser } from "@/types/auth"

/**
 * Provider que expoe o estado de autenticacao via AuthContext.
 * Deve ficar DENTRO do QueryClientProvider (usa useQuery/useMutation).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const meQuery = useQuery<AuthUser | null>({
    queryKey: AUTH_ME_KEY,
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
        must_change_password: response.user.must_change_password,
      }
      queryClient.setQueryData(AUTH_ME_KEY, user)
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
    queryClient.setQueryData(AUTH_ME_KEY, null)
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
