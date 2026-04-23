import { QueryClient } from "@tanstack/react-query"

/**
 * QueryClient centralizado do frontend-v2.
 *
 * Defaults:
 *  - `staleTime` de 30s: evita refetches redundantes na navegacao entre rotas.
 *  - `retry: 1`: backend local, se cair o primeiro request provavelmente cai o retry.
 *  - `refetchOnWindowFocus: false`: o advogado abre/fecha abas toda hora; nao precisamos
 *    revalidar tudo a cada foco.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
