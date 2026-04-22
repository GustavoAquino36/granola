/**
 * Fetcher central do frontend-v2.
 *
 * - Sempre `credentials: "include"` pra o cookie `granola_session` setado pelo backend
 *   ir junto (o Vite proxy mantem same-origin, entao cookie funciona sem CORS credentials).
 * - Sempre `Content-Type: application/json` em POST/PUT/PATCH.
 * - Erros de rede ou status nao-2xx viram `ApiError` com a mensagem do backend
 *   (ou um fallback em portugues).
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
}

async function handleResponse<T>(response: Response): Promise<T> {
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
      `Erro ${response.status} · ${response.statusText || "falha na requisicao"}`

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
  return handleResponse<T>(response)
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
  return handleResponse<T>(response)
}
