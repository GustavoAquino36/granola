"""
Granola — CRM Jurídico | HTTP Server
Servidor HTTP standalone com API REST, seguindo padrões Brunch.
"""
import http.server
import json
import urllib.parse
import re
import secrets
import base64
import hashlib
import os
import sys
import logging
from pathlib import Path
from datetime import datetime

# Fix Python path when running as script (python granola/server.py)
_parent = str(Path(__file__).resolve().parent.parent)
if _parent not in sys.path:
    sys.path.insert(0, _parent)

from granola.database import GranolaDB, AuthDB, init_db
from granola.publicacoes import (
    verificar_coleta_diaria, coletar_publicacoes, get_status_coleta,
    _chromium_is_running as esaj_chromium_running, _launch_chromium as esaj_launch_chromium,
    CDP_PORT as ESAJ_CDP_PORT,
    get_progresso_esaj,
    get_logs as get_coleta_logs, clear_logs as clear_coleta_logs,
    pause_esaj, resume_esaj, is_paused_esaj,
)
from granola.publicacoes_pje import (
    verificar_coleta_diaria_pje, coletar_publicacoes_pje, get_status_coleta_pje,
    _chromium_is_running as pje_chromium_running, _ensure_chromium as pje_ensure_chromium,
    CDP_PORT as PJE_CDP_PORT,
    get_progresso_pje,
    pause_pje, resume_pje, is_paused_pje,
)
from granola.datajud import (
    coletar_publicacoes_datajud, get_status_coleta_datajud,
    verificar_coleta_diaria_datajud,
)
from granola.djen import (
    coletar_publicacoes_djen, get_status_coleta_djen,
    set_oabs as djen_set_oabs, get_oabs as djen_get_oabs,
)
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"  # Permitir OAuth via HTTP (localhost)
from granola import gcal_sync

# ============================================================
#  Configuração
# ============================================================
PORT = 3458
STATIC_DIR = str(Path(__file__).parent.parent / "frontend")
UPLOAD_DIR = Path(__file__).parent / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

ALLOWED_ORIGINS = {
    "http://127.0.0.1:3458",
    "http://localhost:3458",
    "https://granola.valerius.com.br",
    "https://granola.lucasmunhoz.adv.br",
    # TODO remover no cutover da Fase 7 (dev do frontend-v2 via Vite em :5173)
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}

CSP_HEADER = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
    "img-src 'self' data: blob:; "
    "connect-src 'self' https://granola.lucasmunhoz.adv.br https://granola.valerius.com.br; "
    "frame-ancestors 'none'"
)

# Campos que requerem approval de operadores
APPROVAL_FIELDS = {
    "processo": {"valor_causa", "valor_condenacao"},
    "financeiro": {"valor"},
}

_security_log = logging.getLogger("granola.security")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")


# ============================================================
#  Handler HTTP
# ============================================================
class GranolaHandler(http.server.SimpleHTTPRequestHandler):
    """Serve arquivos estáticos e API REST do Granola."""

    db: GranolaDB = None
    auth_db: AuthDB = None
    _login_attempts: dict = {}

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        # No-cache para arquivos estáticos (HTML/JS/CSS) — sempre versão fresca
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    # ---- Logging silencioso ----
    def log_message(self, format, *args):
        pass  # Sem spam no console

    # ---- CORS / Security ----
    def _get_cors_origin(self):
        origin = self.headers.get("Origin", "")
        return origin if origin in ALLOWED_ORIGINS else "http://127.0.0.1:3458"

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", self._get_cors_origin())
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Content-Security-Policy", CSP_HEADER)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode())

    def _safe_error(self, e: Exception, context: str = "operação") -> str:
        msg = str(e)
        msg = re.sub(r'[A-Za-z]:\\[^\s"\']+', '[path]', msg)
        msg = re.sub(r'/[^\s"\']*/', '[path]/', msg)
        _security_log.error(f"ERROR context={context} detail={e}")
        return msg

    # ---- Auth ----
    def _get_session_user(self) -> dict | None:
        cookie_header = self.headers.get("Cookie", "")
        token = None
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith("granola_session="):
                token = part.split("=", 1)[1]
                break
        if not token:
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                token = auth[7:]
        if not token:
            return None
        return self.__class__.auth_db.validate_session(token)

    def _require_auth(self) -> dict | None:
        user = self._get_session_user()
        if not user:
            self._json_response({"error": "Não autenticado"}, 401)
            return None
        return user

    def _require_admin(self) -> dict | None:
        user = self._require_auth()
        if not user:
            return None
        if user.get("role") != "admin":
            self._json_response({"error": "Acesso restrito a administradores"}, 403)
            return None
        return user

    # ---- OPTIONS (CORS preflight) ----
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self._get_cors_origin())
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    # ---- GET ----
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self._handle_api_get(path, parsed.query)
        else:
            if path == "/" or path == "":
                self.path = "/index.html"
            super().do_GET()

    # ---- POST ----
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else b""
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {}
        self._handle_api_post(path, data)

    # ============================================================
    #  API GET Routes
    # ============================================================
    def _handle_api_get(self, path, query_string):
        params = urllib.parse.parse_qs(query_string)
        db = self.__class__.db
        auth_db = self.__class__.auth_db

        def _p(key, default=None):
            """Extrai param da query string."""
            v = params.get(key, [default])[0]
            return v

        # ---- Auth ----
        if path == "/api/auth/me":
            user = self._get_session_user()
            if not user:
                self._json_response({"authenticated": False}, 401)
            else:
                self._json_response({
                    "authenticated": True,
                    "id": user["id"],
                    "username": user["username"],
                    "display_name": user.get("display_name", user["username"]),
                    "role": user["role"],
                    "ambiente": user.get("ambiente", "granola"),
                })
            return

        # ---- Stats ----
        if path == "/api/granola/stats":
            user = self._require_auth()
            if not user:
                return
            self._json_response(db.stats())
            return

        # ---- Clientes ----
        if path == "/api/granola/clientes":
            user = self._require_auth()
            if not user:
                return
            busca = _p("busca")
            tipo = _p("tipo")
            ativo = int(_p("ativo", "1"))
            limite = int(_p("limite", "200"))
            clientes = db.listar_clientes(busca=busca, tipo=tipo, ativo=ativo, limite=limite)
            self._json_response({"clientes": clientes, "total": len(clientes)})
            return

        if path == "/api/granola/cliente":
            user = self._require_auth()
            if not user:
                return
            cid = _p("id")
            if not cid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            cliente = db.get_cliente_detail(int(cid))
            if not cliente:
                self._json_response({"error": "Cliente não encontrado"}, 404)
                return
            self._json_response({"cliente": cliente})
            return

        # ---- Processos ----
        if path == "/api/granola/processos":
            user = self._require_auth()
            if not user:
                return
            procs = db.listar_processos(
                cliente_id=int(_p("cliente_id")) if _p("cliente_id") else None,
                status=_p("status"),
                area=_p("area"),
                busca=_p("busca"),
                limite=int(_p("limite", "500")),
            )
            self._json_response({"processos": procs, "total": len(procs)})
            return

        if path == "/api/granola/processo":
            user = self._require_auth()
            if not user:
                return
            pid = _p("id")
            if not pid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            proc = db.get_processo_detail(int(pid))
            if not proc:
                self._json_response({"error": "Processo não encontrado"}, 404)
                return
            self._json_response({"processo": proc})
            return

        # ---- Kanban ----
        if path == "/api/granola/kanban":
            user = self._require_auth()
            if not user:
                return
            self._json_response(db.get_kanban())
            return

        if path == "/api/granola/kanban/colunas":
            user = self._require_auth()
            if not user:
                return
            self._json_response({"colunas": db.listar_kanban_colunas()})
            return

        # ---- Prazos ----
        if path == "/api/granola/prazos":
            user = self._require_auth()
            if not user:
                return
            prazos = db.listar_prazos(
                processo_id=int(_p("processo_id")) if _p("processo_id") else None,
                dias=int(_p("dias")) if _p("dias") else None,
                prioridade=_p("prioridade"),
                status=_p("status", "pendente"),
            )
            self._json_response({"prazos": prazos, "total": len(prazos)})
            return

        # ---- Agenda ----
        if path == "/api/granola/agenda":
            user = self._require_auth()
            if not user:
                return
            eventos = db.listar_agenda(mes=_p("mes"), tipo=_p("tipo"))
            self._json_response({"eventos": eventos, "total": len(eventos)})
            return

        # ---- Financeiro ----
        if path == "/api/granola/financeiro":
            user = self._require_auth()
            if not user:
                return
            fins = db.listar_financeiro(
                cliente_id=int(_p("cliente_id")) if _p("cliente_id") else None,
                processo_id=int(_p("processo_id")) if _p("processo_id") else None,
                tipo=_p("tipo"),
                status=_p("status"),
                periodo_inicio=_p("periodo_inicio"),
                periodo_fim=_p("periodo_fim"),
                limite=int(_p("limite", "500")),
            )
            self._json_response({"lancamentos": fins, "total": len(fins)})
            return

        if path == "/api/granola/financeiro/resumo":
            user = self._require_auth()
            if not user:
                return
            resumo = db.resumo_financeiro(
                cliente_id=int(_p("cliente_id")) if _p("cliente_id") else None,
                processo_id=int(_p("processo_id")) if _p("processo_id") else None,
                periodo_inicio=_p("periodo_inicio"),
                periodo_fim=_p("periodo_fim"),
            )
            self._json_response(resumo)
            return

        # ---- Documentos ----
        if path == "/api/granola/documentos":
            user = self._require_auth()
            if not user:
                return
            docs = db.listar_documentos(
                processo_id=int(_p("processo_id")) if _p("processo_id") else None,
                cliente_id=int(_p("cliente_id")) if _p("cliente_id") else None,
            )
            self._json_response({"documentos": docs, "total": len(docs)})
            return

        # ---- Notificações ----
        if path == "/api/granola/notificacoes":
            user = self._require_auth()
            if not user:
                return
            lidas_param = _p("lidas")
            lidas = None
            if lidas_param is not None:
                lidas = lidas_param == "1"
            notifs = db.listar_notificacoes(user["id"], lidas=lidas)
            count = db.contar_notificacoes_nao_lidas(user["id"])
            self._json_response({"notificacoes": notifs, "nao_lidas": count})
            return

        # ---- Pending Edits ----
        if path == "/api/granola/pending":
            user = self._require_admin()
            if not user:
                return
            edits = db.listar_pending_edits()
            self._json_response({"edits": edits, "total": len(edits)})
            return

        # ---- Movimentações ----
        if path == "/api/granola/movimentacoes":
            user = self._require_auth()
            if not user:
                return
            pid = _p("processo_id")
            if not pid:
                self._json_response({"error": "processo_id é obrigatório"}, 400)
                return
            movs = db.listar_movimentacoes(int(pid))
            self._json_response({"movimentacoes": movs, "total": len(movs)})
            return

        # ---- Publicações e-SAJ ----
        if path == "/api/granola/publicacoes/status":
            user = self._require_auth()
            if not user:
                return
            self._json_response(get_status_coleta())
            return

        if path == "/api/granola/publicacoes-pje/status":
            user = self._require_auth()
            if not user:
                return
            self._json_response(get_status_coleta_pje())
            return

        if path == "/api/granola/publicacoes-datajud/status":
            user = self._require_auth()
            if not user:
                return
            self._json_response(get_status_coleta_datajud())
            return

        if path == "/api/granola/publicacoes-djen/status":
            user = self._require_auth()
            if not user:
                return
            self._json_response(get_status_coleta_djen())
            return

        if path == "/api/granola/publicacoes-djen/oabs":
            user = self._require_admin()
            if not user:
                return
            self._json_response({"oabs": djen_get_oabs()})
            return

        if path == "/api/granola/publicacoes/progresso":
            user = self._require_auth()
            if not user:
                return
            self._json_response({
                "esaj": get_progresso_esaj(),
                "pje": get_progresso_pje(),
                "paused": {
                    "esaj": is_paused_esaj(),
                    "pje": is_paused_pje(),
                },
            })
            return

        # Log ao vivo da coleta — paginado por seq monotônico
        # Uso: GET /api/granola/publicacoes/log?since=N (N vem da resposta anterior)
        if path == "/api/granola/publicacoes/log":
            user = self._require_auth()
            if not user:
                return
            # params é o dict já parseado pelo caller (urllib.parse.parse_qs)
            try:
                since = int(params.get("since", ["0"])[0])
            except (ValueError, TypeError):
                since = 0
            self._json_response(get_coleta_logs(since=since))
            return

        # ---- Chromium status ----
        if path == "/api/granola/chromium-esaj":
            user = self._require_auth()
            if not user:
                return
            self._json_response({
                "running": esaj_chromium_running(),
                "port": ESAJ_CDP_PORT,
            })
            return

        if path == "/api/granola/chromium-pje":
            user = self._require_auth()
            if not user:
                return
            self._json_response({
                "running": pje_chromium_running(),
                "port": PJE_CDP_PORT,
            })
            return

        if path == "/api/granola/tribunais":
            user = self._require_auth()
            if not user:
                return
            import re as _re
            from datetime import timedelta
            # Processos e última movimentação de cada
            rows = db.conn.execute(
                """SELECT p.id, p.numero_cnj,
                          (SELECT MAX(m.criado_em) FROM granola_movimentacoes m WHERE m.processo_id = p.id) as ultima_mov
                   FROM granola_processos p
                   WHERE p.numero_cnj IS NOT NULL"""
            ).fetchall()
            tribunais = {}
            agora = datetime.now()
            limite_24h = (agora - timedelta(hours=24)).isoformat()
            for r in rows:
                cnj = r["numero_cnj"]
                m = _re.search(r"\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}", cnj)
                if not m:
                    continue
                j, tt = m.group(1), m.group(2)
                key = f".{j}.{tt}."
                if key not in tribunais:
                    tribunais[key] = {"justica": j, "tribunal": tt, "count": 0, "desatualizados": 0}
                tribunais[key]["count"] += 1
                if not r["ultima_mov"] or r["ultima_mov"] < limite_24h:
                    tribunais[key]["desatualizados"] += 1
            NOMES = {
                ".8.26.": "TJSP (e-SAJ)", ".5.02.": "TRT2 (PJe)", ".5.15.": "TRT15 (PJe)", ".4.03.": "TRF3 (PJe)",
            }
            for k in tribunais:
                tribunais[k]["nome"] = NOMES.get(k, f"Tribunal {k}")
            self._json_response({"tribunais": tribunais})
            return

        if path == "/api/granola/processos/por-tribunal":
            user = self._require_auth()
            if not user:
                return
            import re as _re
            rows = db.conn.execute(
                """SELECT p.id, p.numero_cnj, p.titulo, p.status, p.tribunal,
                          (SELECT COUNT(*) FROM granola_movimentacoes m WHERE m.processo_id = p.id) as total_movs,
                          (SELECT MAX(m.criado_em) FROM granola_movimentacoes m WHERE m.processo_id = p.id) as ultima_coleta,
                          (SELECT m.descricao FROM granola_movimentacoes m WHERE m.processo_id = p.id ORDER BY m.criado_em DESC LIMIT 1) as ultima_mov_desc
                   FROM granola_processos p
                   WHERE p.numero_cnj IS NOT NULL
                   ORDER BY p.numero_cnj"""
            ).fetchall()
            grupos = {}
            NOMES = {
                ".8.26.": {"nome": "TJSP", "sistema": "e-SAJ"},
                ".5.02.": {"nome": "TRT2", "sistema": "PJe"},
                ".5.15.": {"nome": "TRT15", "sistema": "PJe"},
                ".4.03.": {"nome": "TRF3", "sistema": "PJe"},
            }
            for r in rows:
                cnj = r["numero_cnj"]
                m = _re.search(r"\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}", cnj)
                if not m:
                    continue
                key = f".{m.group(1)}.{m.group(2)}."
                info = NOMES.get(key, {"nome": f"Tribunal {key}", "sistema": "?"})
                if key not in grupos:
                    grupos[key] = {"nome": info["nome"], "sistema": info["sistema"], "processos": []}
                grupos[key]["processos"].append({
                    "id": r["id"],
                    "numero_cnj": cnj,
                    "titulo": r["titulo"],
                    "status": r["status"],
                    "total_movs": r["total_movs"],
                    "ultima_coleta": r["ultima_coleta"],
                    "ultima_mov_desc": (r["ultima_mov_desc"] or "")[:80],
                })
            self._json_response({"grupos": grupos})
            return

        if path == "/api/granola/publicacoes/novas":
            user = self._require_auth()
            if not user:
                return
            limite = int(_p("limite", "50"))
            conn = db.conn
            rows = conn.execute(
                """SELECT m.*, p.numero_cnj, p.titulo as titulo_processo
                   FROM granola_movimentacoes m
                   JOIN granola_processos p ON m.processo_id = p.id
                   WHERE m.fonte IN ('esaj_auto', 'pje_auto')
                   ORDER BY m.criado_em DESC
                   LIMIT ?""",
                (limite,)
            ).fetchall()
            self._json_response({
                "movimentacoes": [dict(r) for r in rows],
                "total": len(rows),
            })
            return

        # ---- Publicações: relatório de tratamento ----
        if path == "/api/granola/publicacoes/tratamento":
            user = self._require_auth()
            if not user:
                return
            status = _p("status") or None  # pendente | visto | prazo | ignorado | None=todas
            limite = int(_p("limite", "200"))
            movs = db.listar_publicacoes_tratamento(tratamento=status, limite=limite)
            self._json_response({
                "movimentacoes": movs,
                "total": len(movs),
                "pendentes": db.contar_publicacoes_pendentes(),
            })
            return

        # ---- Config ----
        if path == "/api/granola/config":
            user = self._require_auth()
            if not user:
                return
            key = _p("key", "saldo_bancario")
            self._json_response({"key": key, "value": db.get_config(key)})
            return

        # ---- Gastos por sócio ----
        if path == "/api/granola/gastos":
            user = self._require_auth()
            if not user:
                return
            gastos = db.listar_gastos_socios()
            reembolsos = db.listar_reembolsos()
            saldo = db.get_config("saldo_bancario", "0")
            # Saldo pessoal de cada sócio
            saldo_enzo = db.get_config("saldo_pessoal_enzo", "0")
            saldo_lucas = db.get_config("saldo_pessoal_lucas", "0")
            saldo_hiroshi = db.get_config("saldo_pessoal_hiroshi", "0")
            self._json_response({
                "gastos": gastos,
                "reembolsos": reembolsos,
                "saldo_bancario": float(saldo),
                "saldo_pessoal": {
                    "enzo": float(saldo_enzo),
                    "lucas": float(saldo_lucas),
                    "hiroshi": float(saldo_hiroshi),
                },
            })
            return

        # ---- Uploads (serve images) ----
        if path.startswith("/api/granola/upload/"):
            user = self._require_auth()
            if not user:
                return
            filename = path.split("/")[-1]
            filepath = UPLOAD_DIR / filename
            if not filepath.exists() or ".." in filename:
                self._json_response({"error": "Não encontrado"}, 404)
                return
            self.send_response(200)
            ext = filepath.suffix.lower()
            ct = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext.lstrip("."), "application/octet-stream")
            self.send_header("Content-Type", ct)
            self.end_headers()
            self.wfile.write(filepath.read_bytes())
            return

        # ---- Admin: Users ----
        if path == "/api/admin/users":
            user = self._require_admin()
            if not user:
                return
            self._json_response({"users": auth_db.list_users()})
            return

        # ---- Audit Log ---- (restrito ao usuário 'admin' principal)
        if path == "/api/granola/audit":
            user = self._require_admin()
            if not user:
                return
            if user.get("username") != "admin":
                self._json_response({"error": "Audit Log restrito ao administrador principal"}, 403)
                return
            limite = int(_p("limite", "200"))
            rows = auth_db.conn.execute(
                "SELECT * FROM audit_log WHERE module = 'granola' ORDER BY criado_em DESC LIMIT ?",
                (limite,)
            ).fetchall()
            self._json_response({"logs": [dict(r) for r in rows], "total": len(rows)})
            return

        # ---- Google Calendar: Status ----
        if path == "/api/granola/gcal/status":
            user = self._require_auth()
            if not user:
                return
            self._json_response({
                "authenticated": gcal_sync.is_authenticated(),
                "calendar_id": gcal_sync.get_calendar_id(),
            })
            return

        # ---- Google Calendar: Auth (inicia OAuth) ----
        if path == "/api/granola/gcal/auth":
            user = self._require_auth()
            if not user:
                return
            try:
                redirect_uri = "http://localhost:3458/api/granola/gcal/callback"
                auth_url, state = gcal_sync.create_auth_flow(redirect_uri)
                self._json_response({"auth_url": auth_url, "state": state})
            except FileNotFoundError as e:
                self._json_response({"error": str(e)}, 400)
            return

        # ---- Google Calendar: OAuth Callback ----
        if path == "/api/granola/gcal/callback":
            code = _p("code")
            state = _p("state")
            if not code:
                self._json_response({"error": "Codigo de autorizacao ausente"}, 400)
                return
            try:
                redirect_uri = "http://localhost:3458/api/granola/gcal/callback"
                full_url = redirect_uri + "?" + query_string
                gcal_sync.complete_auth_flow(full_url, redirect_uri, state)
                # Retorna HTML simples para fechar a aba
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"""<html><body style="font-family:sans-serif;text-align:center;padding:60px">
                    <h2>Google Calendar conectado!</h2>
                    <p>Pode fechar esta aba e voltar ao Granola.</p>
                    <script>setTimeout(()=>window.close(),2000)</script>
                </body></html>""")
            except Exception as e:
                self._json_response({"error": str(e)}, 400)
            return

        # ---- Google Calendar: Listar Agendas ----
        if path == "/api/granola/gcal/calendars":
            user = self._require_auth()
            if not user:
                return
            cals = gcal_sync.list_calendars()
            self._json_response({"calendars": cals})
            return

        self._json_response({"error": "Endpoint não encontrado"}, 404)

    # ============================================================
    #  API POST Routes
    # ============================================================
    def _handle_api_post(self, path, data):
        db = self.__class__.db
        auth_db = self.__class__.auth_db

        # ---- Auth: Login ----
        if path == "/api/auth/login":
            username = data.get("username", "").strip()
            password = data.get("password", "")
            remember = bool(data.get("remember", False))
            if not username or not password:
                self._json_response({"error": "Usuário e senha são obrigatórios"}, 400)
                return
            # Rate limiting
            ip = self.client_address[0]
            now = datetime.now()
            attempts = self.__class__._login_attempts.get(ip, [])
            attempts = [t for t in attempts if (now - t).total_seconds() < 900]
            if len(attempts) >= 5:
                self._json_response({"error": "Muitas tentativas. Aguarde 15 minutos."}, 429)
                return
            user = auth_db.login(username, password)
            if not user:
                attempts.append(now)
                self.__class__._login_attempts[ip] = attempts
                self._json_response({"error": "Usuário ou senha inválidos"}, 401)
                return
            token = auth_db.create_session(user["id"], remember=remember)
            cookie_max_age = 2592000 if remember else 28800  # 30 dias vs 8 horas
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", self._get_cors_origin())
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header(
                "Set-Cookie",
                f"granola_session={token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age={cookie_max_age}"
            )
            self.end_headers()
            resp = {
                "status": "ok",
                "token": token,
                "user": {
                    "id": user["id"],
                    "username": user["username"],
                    "display_name": user.get("display_name", user["username"]),
                    "role": user["role"],
                    "must_change_password": user.get("must_change_password", 0),
                },
            }
            self.wfile.write(json.dumps(resp, ensure_ascii=False).encode())
            auth_db.log_action(user["id"], user["username"], "login")
            # Primeiro login do dia → dispara coleta DataJud em background
            try:
                if verificar_coleta_diaria_datajud():
                    print(f"  [datajud-autologin] coleta agendada (login de {user['username']})")
            except Exception as e:
                print(f"  [datajud-autologin] erro: {e}")
            return

        # ---- Auth: Logout ----
        if path == "/api/auth/logout":
            user = self._get_session_user()
            cookie_header = self.headers.get("Cookie", "")
            token = None
            for part in cookie_header.split(";"):
                part = part.strip()
                if part.startswith("granola_session="):
                    token = part.split("=", 1)[1]
            if token:
                auth_db.logout(token)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", self._get_cors_origin())
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header(
                "Set-Cookie",
                "granola_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0"
            )
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        # ---- Auth: Change Password ----
        if path == "/api/auth/change-password":
            user = self._require_auth()
            if not user:
                return
            new_pw = data.get("new_password", "")
            if len(new_pw) < 6:
                self._json_response({"error": "Senha deve ter no mínimo 6 caracteres"}, 400)
                return
            auth_db.change_password(user["id"], new_pw)
            self._json_response({"status": "ok"})
            return

        # ---- Cliente: Upsert ----
        if path == "/api/granola/cliente/upsert":
            user = self._require_auth()
            if not user:
                return
            try:
                cid = db.upsert_cliente(data)
                auth_db.log_action(
                    user["id"], user["username"], "cliente_upsert", "granola",
                    "cliente", cid, data.get("nome", "")
                )
                self._json_response({"id": cid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "cliente_upsert")}, 400)
            return

        # ---- Cliente: Delete (hard) ----
        if path == "/api/granola/cliente/delete":
            user = self._require_admin()
            if not user:
                return
            cid = data.get("id")
            if not cid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            result = db.hard_delete_cliente(int(cid))
            auth_db.log_action(user["id"], user["username"], "cliente_delete", "granola", "cliente", int(cid))
            self._json_response({"status": "ok", **result})
            return

        # ---- Processo: Upsert ----
        if path == "/api/granola/processo/upsert":
            user = self._require_auth()
            if not user:
                return
            # Approval workflow para campos sensíveis
            if user["role"] != "admin":
                for field in APPROVAL_FIELDS.get("processo", set()):
                    if field in data and data[field] is not None:
                        processo_id = data.get("id")
                        if processo_id:
                            old = db.get_processo(int(processo_id))
                            old_val = old.get(field) if old else None
                            if str(old_val) != str(data[field]):
                                db.create_pending_edit(
                                    "processo", int(processo_id), user["id"],
                                    user["username"], field, old_val, data[field]
                                )
                                db.criar_notificacao(
                                    "pending_edit",
                                    f"Edição pendente: {field} (processo #{processo_id})",
                                    f"{user['username']} alterou {field}: {old_val} → {data[field]}",
                                    entity_type="processo", entity_id=int(processo_id),
                                )
                                del data[field]
            try:
                pid = db.upsert_processo(data)
                auth_db.log_action(
                    user["id"], user["username"], "processo_upsert", "granola",
                    "processo", pid, data.get("titulo", data.get("numero_cnj", ""))
                )
                self._json_response({"id": pid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "processo_upsert")}, 400)
            return

        # ---- Processo: Swap cliente ↔ parte contrária ----
        if path == "/api/granola/processo/swap-cliente":
            user = self._require_auth()
            if not user:
                return
            pid = data.get("id")
            if not pid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            try:
                ok = db.swap_cliente_parte_contraria(int(pid))
                if ok:
                    auth_db.log_action(
                        user["id"], user["username"], "processo_swap_cliente",
                        "granola", "processo", int(pid)
                    )
                    self._json_response({"status": "ok"})
                else:
                    self._json_response({"error": "Processo não encontrado"}, 404)
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "processo_swap")}, 400)
            return

        # ---- Processo: Delete ----
        if path == "/api/granola/processo/delete":
            user = self._require_auth()
            if not user:
                return
            pid = data.get("id")
            if not pid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            db.delete_processo(int(pid))
            auth_db.log_action(user["id"], user["username"], "processo_delete", "granola", "processo", int(pid))
            self._json_response({"status": "ok"})
            return

        # ---- Processo: Status ----
        if path == "/api/granola/processo/status":
            user = self._require_auth()
            if not user:
                return
            pid = data.get("id")
            status = data.get("status")
            if not pid or not status:
                self._json_response({"error": "id e status são obrigatórios"}, 400)
                return
            db.update_processo_status(int(pid), status)
            auth_db.log_action(
                user["id"], user["username"], "processo_status", "granola",
                "processo", int(pid), "", json.dumps({"status": status}, ensure_ascii=False)
            )
            self._json_response({"status": "ok"})
            return

        # ---- Processo: Kanban move ----
        if path == "/api/granola/processo/kanban":
            user = self._require_auth()
            if not user:
                return
            pid = data.get("id")
            coluna = data.get("kanban_coluna")
            if not pid or not coluna:
                self._json_response({"error": "id e kanban_coluna são obrigatórios"}, 400)
                return
            db.update_processo_kanban(int(pid), coluna)
            self._json_response({"status": "ok"})
            return

        # ---- Parte: Upsert ----
        if path == "/api/granola/parte/upsert":
            user = self._require_auth()
            if not user:
                return
            try:
                pid = db.upsert_parte(data)
                self._json_response({"id": pid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "parte_upsert")}, 400)
            return

        # ---- Parte: Delete ----
        if path == "/api/granola/parte/delete":
            user = self._require_auth()
            if not user:
                return
            pid = data.get("id")
            if not pid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            db.delete_parte(int(pid))
            self._json_response({"status": "ok"})
            return

        # ---- Movimentação: Criar ----
        if path == "/api/granola/movimentacao/criar":
            user = self._require_auth()
            if not user:
                return
            if not data.get("processo_id") or not data.get("descricao"):
                self._json_response({"error": "processo_id e descricao são obrigatórios"}, 400)
                return
            try:
                mid = db.criar_movimentacao(data)
                auth_db.log_action(
                    user["id"], user["username"], "movimentacao_criar", "granola",
                    "movimentacao", mid
                )
                # Auto-notificação de movimentação
                proc = db.get_processo(int(data["processo_id"]))
                proc_label = (proc["numero_cnj"] if proc and proc["numero_cnj"] else proc["titulo"] if proc and proc["titulo"] else f"#{data['processo_id']}")
                db.criar_notificacao(
                    "movimentacao",
                    f"Nova movimentação: {proc_label}",
                    (data.get("descricao") or "")[:200],
                    entity_type="processo", entity_id=int(data["processo_id"]),
                )
                self._json_response({"id": mid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "movimentacao")}, 400)
            return

        # ---- Publicações: Coletar manualmente ----
        if path == "/api/granola/publicacoes/coletar":
            user = self._require_admin()
            if not user:
                return
            import threading
            def _run():
                coletar_publicacoes()
            threading.Thread(target=_run, daemon=True, name="coleta-manual").start()
            auth_db.log_action(
                user["id"], user["username"], "publicacoes_coletar_manual", "granola"
            )
            self._json_response({"status": "iniciada", "msg": "Coleta e-SAJ iniciada em background"})
            return

        # ---- Publicações DataJud: Coletar (caminho padrão do botão) ----
        if path == "/api/granola/publicacoes/coletar-datajud":
            user = self._require_admin()
            if not user:
                return
            import threading
            def _run_datajud():
                coletar_publicacoes_datajud()
            threading.Thread(target=_run_datajud, daemon=True, name="coleta-datajud").start()
            auth_db.log_action(
                user["id"], user["username"], "publicacoes_coletar_datajud", "granola"
            )
            self._json_response({"status": "iniciada", "msg": "Coleta DataJud iniciada em background"})
            return

        # ---- Publicações DJEN: Coletar ----
        if path == "/api/granola/publicacoes/coletar-djen":
            user = self._require_admin()
            if not user:
                return
            import threading
            def _run_djen():
                coletar_publicacoes_djen()
            threading.Thread(target=_run_djen, daemon=True, name="coleta-djen").start()
            auth_db.log_action(
                user["id"], user["username"], "publicacoes_coletar_djen", "granola"
            )
            self._json_response({"status": "iniciada", "msg": "Coleta DJEN iniciada em background"})
            return

        # ---- Publicações combinada: Coletar N métodos em sequência ----
        # Body: {"metodos": ["datajud","djen","tribunal"]} — qualquer combinação.
        # "tribunal" = Selenium e-SAJ + PJe em TODOS os processos (não só faltantes —
        # para isso use o botão "Verificação manual" separado).
        # NOTE: path é "-combinada" pra não colidir com /publicacoes/coletar (legado e-SAJ).
        if path == "/api/granola/publicacoes/coletar-combinada":
            user = self._require_admin()
            if not user:
                return
            metodos_raw = data.get("metodos") or []
            if not isinstance(metodos_raw, list):
                metodos_raw = []
            permitidos = {"datajud", "djen", "tribunal"}
            metodos = [m for m in metodos_raw if m in permitidos]
            if not metodos:
                self._json_response({"error": "metodos vazio ou inválido — use ['datajud','djen','tribunal']"}, status=400)
                return

            import threading
            _coleta_log = logging.getLogger("granola.coleta")

            def _run_combinada():
                # Ordem fixa: DataJud → DJEN → Tribunal (leve → custoso)
                if "datajud" in metodos:
                    try:
                        coletar_publicacoes_datajud()
                    except Exception as e:
                        _coleta_log.exception("Falha coleta DataJud (combinada): %s", e)
                if "djen" in metodos:
                    try:
                        coletar_publicacoes_djen()
                    except Exception as e:
                        _coleta_log.exception("Falha coleta DJEN (combinada): %s", e)
                if "tribunal" in metodos:
                    try:
                        coletar_publicacoes()  # e-SAJ (todos os processos TJSP)
                    except Exception as e:
                        _coleta_log.exception("Falha coleta e-SAJ (combinada): %s", e)
                    try:
                        coletar_publicacoes_pje()  # PJe (todos os processos PJe)
                    except Exception as e:
                        _coleta_log.exception("Falha coleta PJe (combinada): %s", e)

            threading.Thread(target=_run_combinada, daemon=True, name="coleta-combinada").start()
            auth_db.log_action(
                user["id"], user["username"],
                f"publicacoes_coletar_combinada:{','.join(metodos)}", "granola"
            )
            self._json_response({
                "status": "iniciada",
                "metodos": metodos,
                "msg": f"Coleta iniciada em background: {', '.join(metodos)}",
            })
            return

        # ---- Publicações: Verificação manual (fallback Selenium, só nos faltantes do DataJud) ----
        if path == "/api/granola/publicacoes/verificacao-manual":
            user = self._require_admin()
            if not user:
                return
            import threading
            _coleta_log = logging.getLogger("granola.coleta")

            # 1. Lê faltantes da última coleta DataJud
            status_dj = get_status_coleta_datajud()
            resumo = status_dj.get("resumo") if status_dj else None
            faltantes = (resumo or {}).get("nao_encontrados") or []
            if not faltantes:
                self._json_response({
                    "status": "vazio",
                    "msg": "Nenhum faltante do DataJud pra verificar. Rode a coleta DataJud primeiro.",
                })
                return

            # 2. Split por tribunal usando o CNJ (mesma lógica dos filtros padrão)
            esaj_ids: list[int] = []
            pje_ids: list[int] = []
            ignorados: list[dict] = []
            for f in faltantes:
                pid = f.get("processo_id")
                cnj = f.get("numero_cnj") or ""
                if not pid:
                    continue
                if ".8.26." in cnj:
                    esaj_ids.append(pid)
                elif ".5.02." in cnj or ".5.15." in cnj or ".4.03." in cnj:
                    pje_ids.append(pid)
                else:
                    ignorados.append({"processo_id": pid, "numero_cnj": cnj})

            if not esaj_ids and not pje_ids:
                self._json_response({
                    "status": "sem_cobertura",
                    "msg": (
                        f"{len(ignorados)} faltante(s) em tribunais fora da cobertura Selenium "
                        "(e-SAJ: TJSP; PJe: TRT2/TRT15/TRF3)."
                    ),
                    "ignorados": ignorados,
                })
                return

            def _run_fallback():
                # e-SAJ primeiro, depois PJe. Cada módulo gerencia o próprio Chromium.
                if esaj_ids:
                    try:
                        coletar_publicacoes(processo_ids=esaj_ids)
                    except Exception as e:
                        _coleta_log.exception("Falha na coleta e-SAJ (fallback): %s", e)
                if pje_ids:
                    try:
                        coletar_publicacoes_pje(processo_ids=pje_ids)
                    except Exception as e:
                        _coleta_log.exception("Falha na coleta PJe (fallback): %s", e)
            threading.Thread(target=_run_fallback, daemon=True, name="coleta-verificacao-manual").start()
            auth_db.log_action(
                user["id"], user["username"], "publicacoes_verificacao_manual", "granola"
            )
            partes = []
            if esaj_ids:
                partes.append(f"e-SAJ: {len(esaj_ids)}")
            if pje_ids:
                partes.append(f"PJe: {len(pje_ids)}")
            msg_extra = f" ({len(ignorados)} ignorados sem cobertura)" if ignorados else ""
            self._json_response({
                "status": "iniciada",
                "msg": (
                    f"Verificação manual iniciada — {', '.join(partes)}{msg_extra}. "
                    "Faça login nos Chromiums quando abrirem."
                ),
                "esaj_ids": esaj_ids,
                "pje_ids": pje_ids,
                "ignorados": ignorados,
            })
            return

        # ---- Publicações PJe: Coletar manualmente ----
        if path == "/api/granola/publicacoes-pje/coletar":
            user = self._require_admin()
            if not user:
                return
            import threading
            def _run_pje():
                coletar_publicacoes_pje()
            threading.Thread(target=_run_pje, daemon=True, name="coleta-pje-manual").start()
            auth_db.log_action(
                user["id"], user["username"], "publicacoes_pje_coletar_manual", "granola"
            )
            self._json_response({"status": "iniciada", "msg": "Coleta PJe iniciada em background"})
            return

        # ---- Publicações: Coletar todos (só desatualizados) ----
        if path == "/api/granola/publicacoes/coletar-todos":
            user = self._require_auth()
            if not user:
                return
            import threading, time as _time, re as _re
            from datetime import timedelta

            # Buscar processos sem atualização nas últimas 24h
            limite_24h = (datetime.now() - timedelta(hours=24)).isoformat()
            rows = db.conn.execute(
                """SELECT p.id, p.numero_cnj,
                          (SELECT MAX(m.criado_em) FROM granola_movimentacoes m WHERE m.processo_id = p.id) as ultima_mov
                   FROM granola_processos p
                   WHERE p.numero_cnj IS NOT NULL"""
            ).fetchall()

            esaj_ids = []
            pje_ids = []
            for r in rows:
                if r["ultima_mov"] and r["ultima_mov"] >= limite_24h:
                    continue  # Já atualizado
                cnj = r["numero_cnj"]
                if ".8.26." in cnj:
                    esaj_ids.append(r["id"])
                elif _re.search(r"\.[45]\.\d{2}\.", cnj):
                    pje_ids.append(r["id"])

            if not esaj_ids and not pje_ids:
                self._json_response({"status": "ok", "msg": "Todos os processos já estão atualizados."})
                return

            # Informar quais Chromiums serão abertos
            msgs = []
            if esaj_ids and not esaj_chromium_running():
                msgs.append(f"e-SAJ ({len(esaj_ids)} processos)")
            if pje_ids and not pje_chromium_running():
                msgs.append(f"PJe ({len(pje_ids)} processos)")

            def _run_all():
                # 1. Abrir Chromiums necessários
                if esaj_ids and not esaj_chromium_running():
                    esaj_launch_chromium()
                if pje_ids and not pje_chromium_running():
                    pje_ensure_chromium()

                # 2. Coletar (cada módulo detecta login internamente)
                if esaj_ids:
                    coletar_publicacoes(processo_ids=esaj_ids)
                if pje_ids:
                    coletar_publicacoes_pje(processo_ids=pje_ids)

            threading.Thread(target=_run_all, daemon=True, name="coleta-todos").start()
            auth_db.log_action(
                user["id"], user["username"], "publicacoes_coletar_todos", "granola"
            )

            total = len(esaj_ids) + len(pje_ids)
            if msgs:
                msg = f"Coletando {total} processo(s) desatualizado(s). Abrindo: {', '.join(msgs)}. Faça login em 30 segundos."
            else:
                msg = f"Coletando {total} processo(s) desatualizado(s)."
            self._json_response({"status": "iniciada", "msg": msg, "esaj": len(esaj_ids), "pje": len(pje_ids)})
            return

        # ---- Publicações: Pause / Resume ----
        # body: {"source": "esaj" | "pje" | "all"}. Default = "all"
        if path == "/api/granola/publicacoes/pause":
            user = self._require_auth()
            if not user:
                return
            src = (data.get("source") or "all").lower()
            if src in ("esaj", "all"):
                pause_esaj()
            if src in ("pje", "all"):
                pause_pje()
            auth_db.log_action(user["id"], user["username"], f"publicacoes_pause_{src}", "granola")
            self._json_response({
                "status": "ok",
                "paused": {"esaj": is_paused_esaj(), "pje": is_paused_pje()},
            })
            return

        if path == "/api/granola/publicacoes/resume":
            user = self._require_auth()
            if not user:
                return
            src = (data.get("source") or "all").lower()
            if src in ("esaj", "all"):
                resume_esaj()
            if src in ("pje", "all"):
                resume_pje()
            auth_db.log_action(user["id"], user["username"], f"publicacoes_resume_{src}", "granola")
            self._json_response({
                "status": "ok",
                "paused": {"esaj": is_paused_esaj(), "pje": is_paused_pje()},
            })
            return

        # ---- Publicações: Reconsultar um processo específico ----
        # body: {"processo_id": N} OU {"numero_cnj": "..."}
        # Detecta automaticamente se é eSAJ ou PJe pelo CNJ e dispara a coleta
        # em background usando processo_ids=[id]. Bloqueia se já houver coleta
        # do mesmo módulo em andamento.
        if path == "/api/granola/publicacoes/retestar":
            user = self._require_auth()
            if not user:
                return

            processo_id = data.get("processo_id")
            numero_cnj = (data.get("numero_cnj") or "").strip()

            # Resolve numero_cnj → processo_id se veio só o CNJ
            if not processo_id and numero_cnj:
                row = db.conn.execute(
                    "SELECT id, numero_cnj, titulo FROM granola_processos WHERE numero_cnj = ?",
                    (numero_cnj,)
                ).fetchone()
                if not row:
                    self._json_response({"error": f"Processo não encontrado: {numero_cnj}"}, 404)
                    return
                processo_id = row["id"]
                numero_cnj = row["numero_cnj"]

            if not processo_id:
                self._json_response({"error": "Informe processo_id ou numero_cnj"}, 400)
                return

            row = db.conn.execute(
                "SELECT id, numero_cnj, titulo FROM granola_processos WHERE id = ?",
                (processo_id,)
            ).fetchone()
            if not row or not row["numero_cnj"]:
                self._json_response({"error": "Processo não encontrado ou sem CNJ"}, 404)
                return

            cnj = row["numero_cnj"]
            # Classifica: eSAJ TJSP ou PJe (trabalho/federal)
            import re as _re_rt
            is_esaj = ".8.26." in cnj
            is_pje = bool(_re_rt.search(r"\.[45]\.\d{2}\.", cnj))
            if not (is_esaj or is_pje):
                self._json_response({"error": f"CNJ não reconhecido como eSAJ ou PJe: {cnj}"}, 400)
                return

            # Bloqueia se coleta completa do mesmo módulo está rodando
            from granola import publicacoes as _pub_mod
            from granola import publicacoes_pje as _pub_pje_mod
            if is_esaj and _pub_mod._running:
                self._json_response({"error": "Coleta e-SAJ já em andamento"}, 409)
                return
            if is_pje and _pub_pje_mod._running_pje:
                self._json_response({"error": "Coleta PJe já em andamento"}, 409)
                return

            import threading
            def _run_retest():
                if is_esaj:
                    coletar_publicacoes(processo_ids=[processo_id])
                else:
                    coletar_publicacoes_pje(processo_ids=[processo_id])
            threading.Thread(target=_run_retest, daemon=True, name=f"retest-{processo_id}").start()

            auth_db.log_action(
                user["id"], user["username"], "publicacoes_retestar",
                "granola", entity_type="processo", entity_id=processo_id,
                entity_label=cnj,
            )
            self._json_response({
                "status": "iniciada",
                "fonte": "esaj" if is_esaj else "pje",
                "processo_id": processo_id,
                "numero_cnj": cnj,
                "titulo": row["titulo"],
                "msg": f"Reteste iniciado: {cnj} ({'e-SAJ' if is_esaj else 'PJe'})",
            })
            return

        # ---- Publicações: Limpar log da coleta ----
        if path == "/api/granola/publicacoes/log/clear":
            user = self._require_auth()
            if not user:
                return
            clear_coleta_logs()
            self._json_response({"status": "ok"})
            return

        # ---- Chromium: Abrir ----
        if path == "/api/granola/chromium-esaj/abrir":
            user = self._require_auth()
            if not user:
                return
            if esaj_chromium_running():
                self._json_response({"status": "already_running", "port": ESAJ_CDP_PORT})
                return
            ok = esaj_launch_chromium()
            if ok:
                auth_db.log_action(user["id"], user["username"], "chromium_esaj_abrir", "granola")
                self._json_response({"status": "started", "port": ESAJ_CDP_PORT})
            else:
                self._json_response({"status": "error", "msg": "Falha ao abrir Chromium e-SAJ"}, 500)
            return

        if path == "/api/granola/chromium-pje/abrir":
            user = self._require_auth()
            if not user:
                return
            tribunal = data.get("tribunal", "TRT2") if data else "TRT2"
            if pje_chromium_running():
                self._json_response({"status": "already_running", "port": PJE_CDP_PORT})
                return
            ok = pje_ensure_chromium()
            if ok:
                auth_db.log_action(user["id"], user["username"], "chromium_pje_abrir", "granola")
                self._json_response({"status": "started", "port": PJE_CDP_PORT, "tribunal": tribunal})
            else:
                self._json_response({"status": "error", "msg": "Falha ao abrir Chromium PJe"}, 500)
            return

        # ---- Prazo: Upsert ----
        if path == "/api/granola/prazo/upsert":
            user = self._require_auth()
            if not user:
                return
            if not data.get("titulo") or not data.get("data_vencimento"):
                self._json_response({"error": "titulo e data_vencimento são obrigatórios"}, 400)
                return
            try:
                pzid = db.upsert_prazo(data)
                self._json_response({"id": pzid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "prazo_upsert")}, 400)
            return

        # ---- Prazo: Concluir ----
        if path == "/api/granola/prazo/concluir":
            user = self._require_auth()
            if not user:
                return
            pzid = data.get("id")
            if not pzid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            db.concluir_prazo(int(pzid))
            self._json_response({"status": "ok"})
            return

        # ---- Publicação: marcar "Já vista" ----
        if path == "/api/granola/publicacao/marcar-vista":
            user = self._require_auth()
            if not user:
                return
            mov_id = data.get("mov_id")
            if not mov_id:
                self._json_response({"error": "mov_id é obrigatório"}, 400)
                return
            db.marcar_publicacao_tratamento(int(mov_id), "visto", user["username"])
            self._json_response({"status": "ok"})
            return

        # ---- Publicação: voltar a "pendente" ----
        if path == "/api/granola/publicacao/marcar-pendente":
            user = self._require_auth()
            if not user:
                return
            mov_id = data.get("mov_id")
            if not mov_id:
                self._json_response({"error": "mov_id é obrigatório"}, 400)
                return
            db.marcar_publicacao_tratamento(int(mov_id), "pendente", user["username"])
            self._json_response({"status": "ok"})
            return

        # ---- Publicação: criar prazo a cumprir a partir da movimentação ----
        if path == "/api/granola/publicacao/criar-prazo":
            user = self._require_auth()
            if not user:
                return
            mov_id = data.get("mov_id")
            if not mov_id:
                self._json_response({"error": "mov_id é obrigatório"}, 400)
                return
            if not data.get("titulo") or not data.get("data_vencimento"):
                self._json_response({"error": "titulo e data_vencimento são obrigatórios"}, 400)
                return
            mov = db.get_movimentacao(int(mov_id))
            if not mov:
                self._json_response({"error": "Movimentação não encontrada"}, 404)
                return
            try:
                prazo_dados = {
                    "processo_id": mov["processo_id"],
                    "cliente_id": mov.get("cliente_id"),
                    "titulo": data["titulo"],
                    "data_vencimento": data["data_vencimento"],
                    "prioridade": data.get("prioridade", "media"),
                    "tipo": data.get("tipo", "processual"),
                    "descricao": data.get("observacoes") or data.get("descricao", ""),
                    "status": "pendente",
                }
                pzid = db.upsert_prazo(prazo_dados)
                db.marcar_publicacao_tratamento(int(mov_id), "prazo", user["username"], prazo_id=pzid)
                self._json_response({"status": "ok", "prazo_id": pzid})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "publicacao_criar_prazo")}, 400)
            return

        # ---- Financeiro: Upsert ----
        if path == "/api/granola/financeiro/upsert":
            user = self._require_auth()
            if not user:
                return
            # Approval workflow para valor (operadores)
            if user["role"] != "admin" and "valor" in data:
                fin_id = data.get("id")
                if fin_id:
                    old = db._get("granola_financeiro", int(fin_id))
                    old_val = old.get("valor") if old else None
                    if old_val is not None and str(old_val) != str(data["valor"]):
                        db.create_pending_edit(
                            "financeiro", int(fin_id), user["id"],
                            user["username"], "valor", old_val, data["valor"]
                        )
                        db.criar_notificacao(
                            "pending_edit",
                            f"Edição pendente: valor (financeiro #{fin_id})",
                            f"{user['username']} alterou valor: {old_val} → {data['valor']}",
                            entity_type="financeiro", entity_id=int(fin_id),
                        )
                        del data["valor"]
            try:
                fid = db.upsert_financeiro(data)
                auth_db.log_action(
                    user["id"], user["username"], "financeiro_upsert", "granola",
                    "financeiro", fid, data.get("descricao", "")
                )
                self._json_response({"id": fid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "financeiro_upsert")}, 400)
            return

        # ---- Financeiro: Pagar ----
        if path == "/api/granola/financeiro/pagar":
            user = self._require_auth()
            if not user:
                return
            fid = data.get("id")
            if not fid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            db.pagar_financeiro(int(fid), data.get("forma_pagamento"))
            auth_db.log_action(
                user["id"], user["username"], "financeiro_pagar", "granola",
                "financeiro", int(fid)
            )
            self._json_response({"status": "ok"})
            return

        # ---- Financeiro: Despagar ----
        if path == "/api/granola/financeiro/despagar":
            user = self._require_auth()
            if not user:
                return
            fid = data.get("id")
            if not fid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            db._update("granola_financeiro", int(fid), {"status": "pendente", "data_pagamento": None})
            auth_db.log_action(
                user["id"], user["username"], "financeiro_despagar", "granola",
                "financeiro", int(fid)
            )
            self._json_response({"status": "ok"})
            return

        # ---- Financeiro: Delete ----
        if path == "/api/granola/financeiro/delete":
            user = self._require_auth()
            if not user:
                return
            fid = data.get("id")
            if not fid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            db.delete_financeiro(int(fid))
            auth_db.log_action(user["id"], user["username"], "financeiro_delete", "granola", "financeiro", int(fid))
            self._json_response({"status": "ok"})
            return

        # ---- Config: Set ----
        if path == "/api/granola/config/set":
            user = self._require_auth()
            if not user:
                return
            key = data.get("key")
            value = data.get("value")
            if not key:
                self._json_response({"error": "key é obrigatório"}, 400)
                return
            db.set_config(key, str(value))
            self._json_response({"status": "ok"})
            return

        # ---- Gasto: Upload comprovante (image) ----
        if path == "/api/granola/gasto/upload":
            user = self._require_auth()
            if not user:
                return
            img_b64 = data.get("image")
            if not img_b64:
                self._json_response({"error": "image (base64) é obrigatório"}, 400)
                return
            socio = data.get("socio", "")
            descricao = data.get("descricao", "Gasto via comprovante")
            valor = float(data.get("valor", 0))
            data_venc = data.get("data_vencimento")
            cartao = int(data.get("cartao_corporativo", 0))
            try:
                img_bytes = base64.b64decode(img_b64)
                UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
                ext = ".jpg"
                if img_bytes[:4] == b'\x89PNG':
                    ext = ".png"
                safe_name = f"gasto_{secrets.token_hex(6)}{ext}"
                (UPLOAD_DIR / safe_name).write_bytes(img_bytes)
                fid = db.upsert_financeiro({
                    "tipo": "despesa",
                    "categoria": "gasto_socio",
                    "descricao": descricao,
                    "valor": valor,
                    "data_vencimento": data_venc,
                    "status": "pago",
                    "data_pagamento": data_venc or datetime.now().strftime("%Y-%m-%d"),
                    "socio": socio,
                    "cartao_corporativo": cartao,
                    "comprovante_img": safe_name,
                })
                auth_db.log_action(user["id"], user["username"], "gasto_upload", "granola", "financeiro", fid, descricao)
                self._json_response({"id": fid, "status": "ok", "imagem": safe_name})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "gasto_upload")}, 400)
            return

        # ---- Agenda: Upsert ----
        if path == "/api/granola/agenda/upsert":
            user = self._require_auth()
            if not user:
                return
            try:
                aid = db.upsert_agenda(data)
                # Auto-push para Google Calendar
                if gcal_sync.is_authenticated():
                    try:
                        evento = db.get_agenda_by_id(aid)
                        if evento and evento.get("google_event_id"):
                            gcal_sync.update_event(evento["google_event_id"], evento)
                        elif evento:
                            gid = gcal_sync.push_event(evento)
                            if gid:
                                db.set_google_event_id(aid, gid)
                    except Exception as ge:
                        logging.getLogger("granola.gcal").warning(f"Auto-push gcal falhou: {ge}")
                self._json_response({"id": aid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "agenda_upsert")}, 400)
            return

        # ---- Agenda: Status ----
        if path == "/api/granola/agenda/status":
            user = self._require_auth()
            if not user:
                return
            aid = data.get("id")
            status = data.get("status")
            if not aid or not status:
                self._json_response({"error": "id e status são obrigatórios"}, 400)
                return
            db.update_agenda_status(int(aid), status)
            self._json_response({"status": "ok"})
            return

        # ---- Agenda: Delete ----
        if path == "/api/granola/agenda/delete":
            user = self._require_auth()
            if not user:
                return
            aid = data.get("id")
            if not aid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            evento = db.get_agenda_by_id(int(aid))
            if not evento:
                self._json_response({"error": "Evento não encontrado"}, 404)
                return
            # Remover do Google Calendar se sincronizado
            if evento.get("google_event_id") and gcal_sync.is_authenticated():
                try:
                    gcal_sync.delete_event(evento["google_event_id"])
                except Exception as ge:
                    logging.getLogger("granola.gcal").warning(f"Erro ao deletar do Google: {ge}")
            db.delete_agenda(int(aid))
            self._json_response({"status": "ok"})
            return

        # ---- Documento: Upload ----
        if path == "/api/granola/documento/upload":
            user = self._require_auth()
            if not user:
                return
            file_b64 = data.get("file")
            nome = data.get("nome", "documento")
            if not file_b64:
                self._json_response({"error": "file (base64) é obrigatório"}, 400)
                return
            if len(file_b64) > MAX_UPLOAD_BYTES * 4 // 3 + 4:
                self._json_response({"error": "Arquivo excede 10MB"}, 413)
                return
            try:
                file_bytes = base64.b64decode(file_b64)
                UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
                ext = Path(nome).suffix or ".pdf"
                safe_name = secrets.token_hex(8) + ext
                filepath = UPLOAD_DIR / safe_name
                filepath.write_bytes(file_bytes)
                file_hash = hashlib.sha256(file_bytes).hexdigest()
                doc_id = db.criar_documento({
                    "processo_id": data.get("processo_id"),
                    "cliente_id": data.get("cliente_id"),
                    "nome": nome,
                    "tipo": data.get("tipo", "outro"),
                    "caminho": safe_name,
                    "tamanho_bytes": len(file_bytes),
                    "hash_sha256": file_hash,
                    "observacao": data.get("observacao"),
                })
                auth_db.log_action(
                    user["id"], user["username"], "documento_upload", "granola",
                    "documento", doc_id, nome
                )
                self._json_response({"id": doc_id, "status": "ok", "caminho": safe_name})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "documento_upload")}, 400)
            return

        # ---- Documento: Delete ----
        if path == "/api/granola/documento/delete":
            user = self._require_admin()
            if not user:
                return
            did = data.get("id")
            if not did:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            doc = db._get("granola_documentos", int(did))
            if doc and doc.get("caminho"):
                fpath = UPLOAD_DIR / doc["caminho"]
                if fpath.exists():
                    fpath.unlink()
            db.delete_documento(int(did))
            self._json_response({"status": "ok"})
            return

        # ---- Kanban: Coluna ----
        if path == "/api/granola/kanban/coluna":
            user = self._require_admin()
            if not user:
                return
            key = data.get("key")
            label = data.get("label")
            ordem = data.get("ordem")
            if not key or not label or ordem is None:
                self._json_response({"error": "key, label e ordem são obrigatórios"}, 400)
                return
            db.upsert_kanban_coluna(key, label, int(ordem), data.get("cor", "#1a5c45"))
            self._json_response({"status": "ok"})
            return

        # ---- Notificação: Ler ----
        if path == "/api/granola/notificacao/ler":
            user = self._require_auth()
            if not user:
                return
            nid = data.get("id")
            if not nid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            db.marcar_notificacao_lida(int(nid))
            self._json_response({"status": "ok"})
            return

        # ---- Pending: Aprovar ----
        if path == "/api/granola/pending/aprovar":
            user = self._require_admin()
            if not user:
                return
            eid = data.get("id")
            if not eid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            ok = db.approve_pending_edit(int(eid), user["id"])
            auth_db.log_action(user["id"], user["username"], "pending_aprovar", "granola", "pending_edit", int(eid))
            self._json_response({"status": "ok" if ok else "não encontrado"})
            return

        # ---- Pending: Rejeitar ----
        if path == "/api/granola/pending/rejeitar":
            user = self._require_admin()
            if not user:
                return
            eid = data.get("id")
            if not eid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            ok = db.reject_pending_edit(int(eid), user["id"])
            auth_db.log_action(user["id"], user["username"], "pending_rejeitar", "granola", "pending_edit", int(eid))
            self._json_response({"status": "ok" if ok else "não encontrado"})
            return

        # ---- Admin: Create User ----
        if path == "/api/admin/user/criar":
            user = self._require_admin()
            if not user:
                return
            username = data.get("username", "").strip()
            password = data.get("password", "")
            if not username or not password:
                self._json_response({"error": "username e password são obrigatórios"}, 400)
                return
            try:
                uid = auth_db.create_user(
                    username, password,
                    display_name=data.get("display_name"),
                    role=data.get("role", "operador_granola"),
                    ambiente=data.get("ambiente", "granola"),
                )
                self._json_response({"id": uid, "status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "create_user")}, 400)
            return

        # ---- Admin: Update User ----
        if path == "/api/admin/user/atualizar":
            user = self._require_admin()
            if not user:
                return
            uid = data.get("id")
            if not uid:
                self._json_response({"error": "id é obrigatório"}, 400)
                return
            alvo = auth_db.get_user_by_id(int(uid))
            if not alvo:
                self._json_response({"error": "Usuário não encontrado"}, 404)
                return
            # Apenas o próprio admin principal pode editar a conta 'admin'
            if alvo["username"] == "admin" and user.get("username") != "admin":
                self._json_response({"error": "Somente o administrador principal pode editar a conta admin"}, 403)
                return
            # Impede desativar o admin principal ou remover seu papel
            fields = {}
            if "display_name" in data:
                fields["display_name"] = data["display_name"]
            if "ambiente" in data:
                fields["ambiente"] = data["ambiente"]
            if "role" in data:
                if alvo["username"] == "admin" and data["role"] != "admin":
                    self._json_response({"error": "Não é possível alterar o papel da conta admin"}, 400)
                    return
                fields["role"] = data["role"]
            if "ativo" in data:
                if alvo["username"] == "admin" and not data["ativo"]:
                    self._json_response({"error": "Não é possível desativar a conta admin"}, 400)
                    return
                fields["ativo"] = 1 if data["ativo"] else 0
            try:
                if fields:
                    auth_db.update_user(int(uid), fields)
                new_pw = data.get("new_password")
                if new_pw:
                    if len(new_pw) < 6:
                        self._json_response({"error": "Senha deve ter no mínimo 6 caracteres"}, 400)
                        return
                    auth_db.change_password(int(uid), new_pw)
                self._json_response({"status": "ok"})
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "update_user")}, 400)
            return

        # ---- Google Calendar: Sync ----
        if path == "/api/granola/gcal/sync":
            user = self._require_auth()
            if not user:
                return
            try:
                stats = gcal_sync.full_sync(db)
                self._json_response(stats)
            except Exception as e:
                self._json_response({"error": self._safe_error(e, "gcal_sync")}, 500)
            return

        # ---- Google Calendar: Configurar agenda alvo ----
        if path == "/api/granola/gcal/config":
            user = self._require_auth()
            if not user:
                return
            cal_id = data.get("calendar_id")
            if cal_id:
                gcal_sync.set_calendar_id(cal_id)
            self._json_response({"status": "ok", "calendar_id": gcal_sync.get_calendar_id()})
            return

        # ---- Google Calendar: Push evento individual ----
        if path == "/api/granola/gcal/push":
            user = self._require_auth()
            if not user:
                return
            agenda_id = data.get("id")
            if not agenda_id:
                self._json_response({"error": "id obrigatorio"}, 400)
                return
            evento = db.get_agenda_by_id(int(agenda_id))
            if not evento:
                self._json_response({"error": "Evento nao encontrado"}, 404)
                return
            if evento.get("google_event_id"):
                ok = gcal_sync.update_event(evento["google_event_id"], evento)
                self._json_response({"status": "updated" if ok else "error"})
            else:
                gid = gcal_sync.push_event(evento)
                if gid:
                    db.set_google_event_id(int(agenda_id), gid)
                    self._json_response({"status": "pushed", "google_event_id": gid})
                else:
                    self._json_response({"error": "Falha ao enviar para Google"}, 500)
            return

        self._json_response({"error": "Endpoint não encontrado"}, 404)


# ============================================================
#  Main
# ============================================================
def _check_prazo_notifications(db):
    """Cria notificações automáticas para prazos próximos e vencidos."""
    import threading
    def _run():
        from datetime import timedelta
        now = datetime.now()
        hoje = now.strftime("%Y-%m-%d")
        em3d = (now + timedelta(days=3)).strftime("%Y-%m-%d")

        # Prazos vencidos (pendentes com data passada)
        vencidos = db.conn.execute(
            "SELECT id, titulo, data_vencimento, processo_id FROM granola_prazos WHERE status = 'pendente' AND data_vencimento < ?",
            (hoje,)
        ).fetchall()
        for pz in vencidos:
            # Evitar duplicar: checar se já existe notificação recente
            existing = db.conn.execute(
                "SELECT id FROM granola_notificacoes WHERE tipo = 'prazo_vencido' AND entity_type = 'prazo' AND entity_id = ? AND criado_em > ?",
                (pz["id"], (now - timedelta(days=1)).isoformat())
            ).fetchone()
            if not existing:
                db.criar_notificacao(
                    "prazo_vencido",
                    f"Prazo vencido: {pz['titulo']}",
                    f"Venceu em {pz['data_vencimento']}",
                    entity_type="prazo", entity_id=pz["id"],
                )

        # Prazos próximos (3 dias)
        proximos = db.conn.execute(
            "SELECT id, titulo, data_vencimento, processo_id FROM granola_prazos WHERE status = 'pendente' AND data_vencimento >= ? AND data_vencimento <= ?",
            (hoje, em3d)
        ).fetchall()
        for pz in proximos:
            existing = db.conn.execute(
                "SELECT id FROM granola_notificacoes WHERE tipo = 'prazo_proximo' AND entity_type = 'prazo' AND entity_id = ? AND criado_em > ?",
                (pz["id"], (now - timedelta(days=1)).isoformat())
            ).fetchone()
            if not existing:
                dias = (datetime.strptime(pz["data_vencimento"], "%Y-%m-%d") - now).days
                label = "Hoje" if dias <= 0 else f"em {dias} dia(s)"
                db.criar_notificacao(
                    "prazo_proximo",
                    f"Prazo próximo: {pz['titulo']}",
                    f"Vence {label} ({pz['data_vencimento']})",
                    entity_type="prazo", entity_id=pz["id"],
                )

    threading.Thread(target=_run, daemon=True, name="prazo-notifs").start()


def _watch_and_reload():
    """Thread que monitora mudanças em .py e reinicia o servidor automaticamente."""
    import threading, time, subprocess
    watch_dir = Path(__file__).parent
    project_dir = watch_dir.parent
    mtimes = {}
    for f in watch_dir.glob("*.py"):
        try:
            mtimes[str(f)] = f.stat().st_mtime
        except OSError:
            pass

    def checker():
        while True:
            time.sleep(3)
            changed = False
            try:
                for f in watch_dir.glob("*.py"):
                    key = str(f)
                    mtime = f.stat().st_mtime
                    if key not in mtimes:
                        mtimes[key] = mtime
                        changed = True
                    elif mtimes[key] != mtime:
                        mtimes[key] = mtime
                        changed = True
            except OSError:
                continue
            if changed:
                print("\n  [AUTO-RELOAD] Mudanca detectada em .py -> reiniciando...")
                try:
                    subprocess.Popen(
                        [sys.executable, "-X", "utf8", "-m", "granola"],
                        cwd=str(project_dir),
                        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,
                    )
                except Exception as e:
                    print(f"  [AUTO-RELOAD] Erro ao reiniciar: {e}")
                    return
                os._exit(0)

    t = threading.Thread(target=checker, daemon=True)
    t.start()


def main():
    init_db()

    # Criar admin padrão se não existir
    auth_db = AuthDB()
    existing = auth_db.conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
    if not existing:
        auth_db.create_user("admin", "granola2026", display_name="Administrador", role="admin", ambiente="granola")
        print("  Usuario admin criado (admin / granola2026)")

    db = GranolaDB()

    GranolaHandler.db = db
    GranolaHandler.auth_db = auth_db

    # Notificações automáticas de prazos (na inicialização + a cada hora)
    import threading
    _check_prazo_notifications(db)

    def _prazo_timer_loop():
        while True:
            import time
            time.sleep(3600)  # 1 hora
            try:
                _check_prazo_notifications(db)
            except Exception as e:
                print(f"  [prazo-notifs] Erro: {e}")

    threading.Thread(target=_prazo_timer_loop, daemon=True, name="prazo-timer").start()

    # Auto-reload quando .py muda
    _watch_and_reload()

    print(f"\n  Granola CRM Juridico")
    print(f"  http://127.0.0.1:{PORT}")
    print(f"  Banco: {db.conn.execute('PRAGMA database_list').fetchone()[2]}")
    print(f"  Auto-reload: ativo (mudancas em .py reiniciam automaticamente)")
    print(f"  Frontend: sem cache (F5 sempre carrega versao nova)")

    # Coleta automática de publicações: e-SAJ/PJe desativados no startup.
    # Caminho padrão é DataJud (botão "Coletar publicações" na UI).
    # e-SAJ e PJe ficam só como "Verificação manual" sob demanda.
    print(f"  Publicações e-SAJ/PJe: coleta automática DESATIVADA (usar Verificação manual)")
    print(f"  Publicações DataJud: disponível sob demanda (botão 'Coletar publicações')")
    print()

    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), GranolaHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Granola encerrado.")
    finally:
        db.close()
        auth_db.close()
        server.server_close()


if __name__ == "__main__":
    main()
