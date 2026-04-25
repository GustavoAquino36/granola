/**
 * Shape do usuario autenticado, conforme retorno de /api/auth/me e /api/auth/login.
 * Fonte: granola/server.py (linhas 218-231 e 756-810).
 */
export interface AuthUser {
  id: number
  username: string
  display_name: string
  role: string
  ambiente: string
  /** Backend marca 1 quando o usuario PRECISA trocar a senha (admin reset, etc.).
   *  Frontend redireciona pra /config?force-change quando true. */
  must_change_password?: 0 | 1
}

export interface LoginResponse {
  status: "ok"
  token: string
  user: {
    id: number
    username: string
    display_name: string
    role: string
    must_change_password: 0 | 1
  }
}

export interface MeResponse {
  authenticated: true
  id: number
  username: string
  display_name: string
  role: string
  ambiente: string
  must_change_password?: 0 | 1
}
