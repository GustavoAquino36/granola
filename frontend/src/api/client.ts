/**
 * Fetcher central do frontend.
 *
 * - Sempre `credentials: "include"` pra o cookie `granola_session` setado pelo backend
 *   ir junto (o Vite proxy mantem same-origin, entao cookie funciona sem CORS credentials).
 * - Sempre `Content-Type: application/json` em POST/PUT/PATCH.
 * - Erros de rede ou status nao-2xx viram `ApiError` com a mensagem do backend
 *   (ou um fallback em portugues).
 * - 401 mid-session dispara handler global (registrado pelo AuthProvider) que
 *   limpa o cache e manda pra /login. Antes disso, cada componente tinha que
 *   tratar 401 sozinho — agora eh centralizado.
 */

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.payload = payload
  }
}

interface RequestOptions {
  signal?: AbortSignal
  /** Quando true, suprime o handler global de 401 (usado pelo /api/auth/me
   *  pra evitar loop quando o user ainda nao esta autenticado). */
  ignoreUnauthorized?: boolean
}

// --------------------------------------------------------------------------
// Handler global de 401 — registrado pelo AuthProvider no mount.
// --------------------------------------------------------------------------

let unauthorizedHandler: (() => void) | null = null

/** Registrado pelo AuthProvider. Disparado quando qualquer fetch retorna 401
 *  fora do contexto de "checar sessao" (que usa ignoreUnauthorized). */
export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler
}

async function handleResponse<T>(
  response: Response,
  ignoreUnauthorized?: boolean
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? ""
  const isJson = contentType.includes("application/json")
  const payload = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : null) ??
      (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : null) ??
      `Erro ${response.status} · ${response.statusText || "falha na requisição"}`

    // 401 mid-session: dispara handler global. Se nao foi suprimido pelo
    // chamador (fetchMe usa ignoreUnauthorized), o AuthProvider redireciona.
    if (response.status === 401 && !ignoreUnauthorized && unauthorizedHandler) {
      // setTimeout pra garantir que o erro propague antes da limpeza do cache
      // (evita race com componentes que ainda dependem de queries em-voo)
      setTimeout(() => unauthorizedHandler?.(), 0)
    }

    throw new ApiError(message, response.status, payload)
  }

  return payload as T
}

export async function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
  })
  return handleResponse<T>(response, options?.ignoreUnauthorized)
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: options?.signal,
  })
  return handleResponse<T>(response, options?.ignoreUnauthorized)
}
