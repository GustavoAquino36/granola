"""
Granola — CRM Jurídico | Database Layer
Banco SQLite com WAL, parameterized queries e whitelist de colunas.
"""
import sqlite3
import hashlib
import secrets
import re
from datetime import datetime, timedelta
from pathlib import Path

DB_DIR = Path(__file__).parent / "data"
DB_PATH = DB_DIR / "granola.db"


def _format_cnj(raw) -> str | None:
    """Normaliza qualquer entrada de CNJ para o formato canônico
    NNNNNNN-DD.YYYY.J.TT.OOOO (20 dígitos). Retorna None se inválido."""
    if raw is None:
        return None
    digits = re.sub(r'\D', '', str(raw))
    if not digits:
        return None
    # Aceita 20 dígitos exatos; caso venha com sufixos/prefixos estranhos
    # tenta extrair os primeiros 20.
    if len(digits) < 20:
        return digits  # fallback: devolve o que foi digitado (não formata)
    d = digits[:20]
    return f"{d[0:7]}-{d[7:9]}.{d[9:13]}.{d[13:14]}.{d[14:16]}.{d[16:20]}"



# ============================================================
#  Whitelist de colunas (contra SQL injection)
# ============================================================
_VALID_COLUMNS = {
    "granola_clientes": {
        "id", "tipo", "nome", "cpf_cnpj", "rg", "email", "telefone", "telefone2",
        "endereco_cep", "endereco_logradouro", "endereco_numero", "endereco_complemento",
        "endereco_bairro", "endereco_cidade", "endereco_uf",
        "data_nascimento", "profissao", "estado_civil", "nacionalidade",
        "observacao", "ativo", "criado_em", "atualizado_em",
    },
    "granola_processos": {
        "id", "cliente_id", "numero_cnj", "numero_interno", "titulo", "tipo", "area",
        "rito", "classe", "comarca", "vara", "tribunal", "juiz",
        "valor_causa", "valor_condenacao", "polo", "parte_contraria",
        "cpf_cnpj_contraria", "advogado_contrario", "oab_contrario",
        "status", "fase", "kanban_coluna", "data_distribuicao", "data_encerramento",
        "observacao", "dados_extra", "link_autos", "criado_em", "atualizado_em",
    },
    "granola_partes": {
        "id", "processo_id", "nome", "cpf_cnpj", "tipo", "polo",
        "advogado", "oab", "observacao",
    },
    "granola_movimentacoes": {
        "id", "processo_id", "tipo", "descricao", "data_movimento",
        "fonte", "hash_dedup", "gera_prazo", "criado_em",
    },
    "granola_prazos": {
        "id", "processo_id", "cliente_id", "movimentacao_id", "titulo", "descricao",
        "data_inicio", "data_vencimento", "data_conclusao", "tipo", "status",
        "prioridade", "alerta_dias", "responsavel", "criado_em", "atualizado_em",
    },
    "granola_financeiro": {
        "id", "processo_id", "cliente_id", "tipo", "categoria", "descricao",
        "valor", "data_vencimento", "data_pagamento", "status",
        "forma_pagamento", "comprovante", "observacao", "criado_em", "atualizado_em",
        "socio", "cartao_corporativo", "comprovante_img",
        "fixo", "parcelas", "parcela_atual", "pago_por_cartao",
        "meses_contrato", "data_inicio_contrato",
    },
    "granola_config": {"key", "value", "atualizado_em"},
    "granola_agenda": {
        "id", "processo_id", "cliente_id", "prazo_id", "titulo", "descricao",
        "data_inicio", "data_fim", "tipo", "local", "status",
        "google_event_id",
        "criado_em", "atualizado_em",
    },
    "granola_documentos": {
        "id", "processo_id", "cliente_id", "nome", "tipo", "caminho",
        "tamanho_bytes", "hash_sha256", "observacao", "criado_em",
    },
    "granola_kanban_colunas": {
        "key", "label", "ordem", "cor",
    },
    "granola_pending_edits": {
        "id", "entity_type", "entity_id", "user_id", "username", "field",
        "old_value", "new_value", "status", "criado_em", "revisado_em", "revisado_por",
    },
    "granola_notificacoes": {
        "id", "user_id", "tipo", "titulo", "mensagem",
        "entity_type", "entity_id", "lida", "criado_em",
    },
    "users": {
        "id", "username", "password_hash", "salt", "display_name", "role",
        "ambiente", "ativo", "criado_em", "ultimo_login", "must_change_password",
    },
}


def _validate_columns(table: str, columns: list[str]):
    valid = _VALID_COLUMNS.get(table)
    if not valid:
        return
    bad = [c for c in columns if c not in valid]
    if bad:
        raise ValueError(f"Colunas inválidas para {table}: {bad}")


def get_connection():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    c = conn.cursor()

    c.executescript("""
    -- ============================================================
    --  AUTH — Usuarios e sessoes
    -- ============================================================
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        display_name TEXT,
        role TEXT DEFAULT 'operador_granola',
        ambiente TEXT DEFAULT 'granola',
        ativo INTEGER DEFAULT 1,
        criado_em TEXT NOT NULL,
        ultimo_login TEXT,
        must_change_password INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        criado_em TEXT NOT NULL,
        expira_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        module TEXT DEFAULT 'granola',
        entity_type TEXT,
        entity_id INTEGER,
        entity_label TEXT,
        details TEXT,
        criado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module);

    -- ============================================================
    --  GRANOLA — Clientes
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT DEFAULT 'PF',
        nome TEXT NOT NULL,
        cpf_cnpj TEXT UNIQUE,
        rg TEXT,
        email TEXT,
        telefone TEXT,
        telefone2 TEXT,
        endereco_cep TEXT,
        endereco_logradouro TEXT,
        endereco_numero TEXT,
        endereco_complemento TEXT,
        endereco_bairro TEXT,
        endereco_cidade TEXT,
        endereco_uf TEXT,
        data_nascimento TEXT,
        profissao TEXT,
        estado_civil TEXT,
        nacionalidade TEXT DEFAULT 'Brasileira',
        observacao TEXT,
        ativo INTEGER DEFAULT 1,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bres_clientes_cpf ON granola_clientes(cpf_cnpj);
    CREATE INDEX IF NOT EXISTS idx_bres_clientes_nome ON granola_clientes(nome);
    CREATE INDEX IF NOT EXISTS idx_bres_clientes_ativo ON granola_clientes(ativo);

    -- ============================================================
    --  GRANOLA — Processos
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_processos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER REFERENCES granola_clientes(id),
        numero_cnj TEXT,
        numero_interno TEXT,
        titulo TEXT,
        tipo TEXT DEFAULT 'judicial',
        area TEXT DEFAULT 'trabalhista',
        rito TEXT,
        classe TEXT,
        comarca TEXT,
        vara TEXT,
        tribunal TEXT,
        juiz TEXT,
        valor_causa REAL DEFAULT 0,
        valor_condenacao REAL DEFAULT 0,
        polo TEXT,
        parte_contraria TEXT,
        cpf_cnpj_contraria TEXT,
        advogado_contrario TEXT,
        oab_contrario TEXT,
        status TEXT DEFAULT 'ativo',
        fase TEXT DEFAULT 'conhecimento',
        kanban_coluna TEXT DEFAULT 'novo',
        data_distribuicao TEXT,
        data_encerramento TEXT,
        observacao TEXT,
        dados_extra TEXT,
        link_autos TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bres_proc_cliente ON granola_processos(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_bres_proc_cnj ON granola_processos(numero_cnj);
    CREATE INDEX IF NOT EXISTS idx_bres_proc_status ON granola_processos(status);
    CREATE INDEX IF NOT EXISTS idx_bres_proc_kanban ON granola_processos(kanban_coluna);

    -- ============================================================
    --  GRANOLA — Partes do Processo
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_partes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        processo_id INTEGER NOT NULL REFERENCES granola_processos(id),
        nome TEXT NOT NULL,
        cpf_cnpj TEXT,
        tipo TEXT DEFAULT 'autor',
        polo TEXT,
        advogado TEXT,
        oab TEXT,
        observacao TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bres_partes_proc ON granola_partes(processo_id);

    -- ============================================================
    --  GRANOLA — Movimentações
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_movimentacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        processo_id INTEGER NOT NULL REFERENCES granola_processos(id),
        tipo TEXT,
        descricao TEXT NOT NULL,
        data_movimento TEXT NOT NULL,
        fonte TEXT DEFAULT 'manual',
        hash_dedup TEXT,
        gera_prazo INTEGER DEFAULT 0,
        criado_em TEXT NOT NULL,
        UNIQUE(processo_id, hash_dedup)
    );
    CREATE INDEX IF NOT EXISTS idx_bres_mov_proc ON granola_movimentacoes(processo_id);

    -- ============================================================
    --  GRANOLA — Prazos
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_prazos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        processo_id INTEGER REFERENCES granola_processos(id),
        cliente_id INTEGER REFERENCES granola_clientes(id),
        movimentacao_id INTEGER REFERENCES granola_movimentacoes(id),
        titulo TEXT NOT NULL,
        descricao TEXT,
        data_inicio TEXT,
        data_vencimento TEXT NOT NULL,
        data_conclusao TEXT,
        tipo TEXT DEFAULT 'prazo',
        status TEXT DEFAULT 'pendente',
        prioridade TEXT DEFAULT 'normal',
        alerta_dias INTEGER DEFAULT 3,
        responsavel TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bres_prazos_venc ON granola_prazos(data_vencimento);
    CREATE INDEX IF NOT EXISTS idx_bres_prazos_status ON granola_prazos(status);
    CREATE INDEX IF NOT EXISTS idx_bres_prazos_proc ON granola_prazos(processo_id);

    -- ============================================================
    --  GRANOLA — Financeiro
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_financeiro (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        processo_id INTEGER REFERENCES granola_processos(id),
        cliente_id INTEGER REFERENCES granola_clientes(id),
        tipo TEXT NOT NULL,
        categoria TEXT,
        descricao TEXT NOT NULL,
        valor REAL NOT NULL,
        data_vencimento TEXT,
        data_pagamento TEXT,
        status TEXT DEFAULT 'pendente',
        forma_pagamento TEXT,
        comprovante TEXT,
        observacao TEXT,
        socio TEXT,
        cartao_corporativo INTEGER DEFAULT 0,
        comprovante_img TEXT,
        fixo INTEGER DEFAULT 1,
        parcelas INTEGER DEFAULT 0,
        parcela_atual INTEGER DEFAULT 1,
        pago_por_cartao TEXT,
        meses_contrato INTEGER DEFAULT 0,
        data_inicio_contrato TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bres_fin_proc ON granola_financeiro(processo_id);
    CREATE INDEX IF NOT EXISTS idx_bres_fin_cliente ON granola_financeiro(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_bres_fin_status ON granola_financeiro(status);

    -- ============================================================
    --  GRANOLA — Agenda
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_agenda (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        processo_id INTEGER REFERENCES granola_processos(id),
        cliente_id INTEGER REFERENCES granola_clientes(id),
        prazo_id INTEGER REFERENCES granola_prazos(id),
        titulo TEXT NOT NULL,
        descricao TEXT,
        data_inicio TEXT NOT NULL,
        data_fim TEXT,
        tipo TEXT DEFAULT 'lembrete',
        local TEXT,
        status TEXT DEFAULT 'agendado',
        google_event_id TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bres_agenda_data ON granola_agenda(data_inicio);

    -- ============================================================
    --  GRANOLA — Documentos
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_documentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        processo_id INTEGER REFERENCES granola_processos(id),
        cliente_id INTEGER REFERENCES granola_clientes(id),
        nome TEXT NOT NULL,
        tipo TEXT,
        caminho TEXT NOT NULL,
        tamanho_bytes INTEGER,
        hash_sha256 TEXT,
        observacao TEXT,
        criado_em TEXT NOT NULL
    );

    -- ============================================================
    --  GRANOLA — Kanban Colunas
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_kanban_colunas (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        ordem INTEGER NOT NULL,
        cor TEXT DEFAULT '#1a5c45'
    );
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('novo','Novo',1,'#6b7280');
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('andamento','Em Andamento',2,'#3b82f6');
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('prazo','Aguardando Prazo',3,'#f59e0b');
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('audiencia','Audiência Marcada',4,'#8b5cf6');
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('sentenca','Sentença',5,'#ec4899');
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('recurso','Recurso',6,'#f97316');
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('execucao','Execução',7,'#1a5c45');
    INSERT OR IGNORE INTO granola_kanban_colunas VALUES ('encerrado','Encerrado',8,'#6b7280');

    -- ============================================================
    --  GRANOLA — Pending Edits (Approval Workflow)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_pending_edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        user_id INTEGER,
        username TEXT,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        status TEXT DEFAULT 'pendente',
        criado_em TEXT NOT NULL,
        revisado_em TEXT,
        revisado_por INTEGER
    );

    -- ============================================================
    --  GRANOLA — Notificações
    -- ============================================================
    CREATE TABLE IF NOT EXISTS granola_notificacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        tipo TEXT NOT NULL,
        titulo TEXT NOT NULL,
        mensagem TEXT,
        entity_type TEXT,
        entity_id INTEGER,
        lida INTEGER DEFAULT 0,
        criado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bres_notif_user ON granola_notificacoes(user_id, lida);
    """)

    conn.commit()

    # Migrations — colunas adicionadas após criação inicial
    try:
        c = conn.cursor()
        c.execute("SELECT link_autos FROM granola_processos LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE granola_processos ADD COLUMN link_autos TEXT")
        conn.commit()

    # Migration: colunas financeiro (gastos sócio, parcelas, cartão)
    _fin_migrations = {
        "socio": "ALTER TABLE granola_financeiro ADD COLUMN socio TEXT",
        "cartao_corporativo": "ALTER TABLE granola_financeiro ADD COLUMN cartao_corporativo INTEGER DEFAULT 0",
        "comprovante_img": "ALTER TABLE granola_financeiro ADD COLUMN comprovante_img TEXT",
        "fixo": "ALTER TABLE granola_financeiro ADD COLUMN fixo INTEGER DEFAULT 1",
        "parcelas": "ALTER TABLE granola_financeiro ADD COLUMN parcelas INTEGER DEFAULT 0",
        "parcela_atual": "ALTER TABLE granola_financeiro ADD COLUMN parcela_atual INTEGER DEFAULT 1",
        "pago_por_cartao": "ALTER TABLE granola_financeiro ADD COLUMN pago_por_cartao TEXT",
        "meses_contrato": "ALTER TABLE granola_financeiro ADD COLUMN meses_contrato INTEGER DEFAULT 0",
        "data_inicio_contrato": "ALTER TABLE granola_financeiro ADD COLUMN data_inicio_contrato TEXT",
    }
    for col, sql in _fin_migrations.items():
        try:
            conn.execute(f"SELECT {col} FROM granola_financeiro LIMIT 1")
        except Exception:
            conn.execute(sql)
    conn.commit()

    # Migration: google_event_id para integração Google Calendar
    try:
        conn.execute("SELECT google_event_id FROM granola_agenda LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE granola_agenda ADD COLUMN google_event_id TEXT")
        conn.commit()

    # Migration: ttl_hours em sessions (para "Lembrar de mim")
    # Sessões normais: 8h. Sessões "Lembrar de mim": 720h (30 dias).
    # O valor é usado pelo rolling refresh em validate_session().
    try:
        conn.execute("SELECT ttl_hours FROM sessions LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE sessions ADD COLUMN ttl_hours INTEGER DEFAULT 8")
        conn.commit()

    # Migration: tratamento de publicações automáticas
    # Estados: 'pendente' (padrão, recém coletada), 'visto' (admin confirmou leitura),
    #          'prazo' (admin criou um prazo a partir dela), 'ignorado' (sem ação)
    try:
        conn.execute("SELECT tratamento FROM granola_movimentacoes LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE granola_movimentacoes ADD COLUMN tratamento TEXT DEFAULT 'pendente'")
    try:
        conn.execute("SELECT tratamento_por FROM granola_movimentacoes LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE granola_movimentacoes ADD COLUMN tratamento_por TEXT")
    try:
        conn.execute("SELECT tratamento_em FROM granola_movimentacoes LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE granola_movimentacoes ADD COLUMN tratamento_em TEXT")
    try:
        conn.execute("SELECT prazo_id FROM granola_movimentacoes LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE granola_movimentacoes ADD COLUMN prazo_id INTEGER REFERENCES granola_prazos(id)")
    conn.commit()

    conn.close()


# ============================================================
#  Auth DB
# ============================================================
class AuthDB:
    def __init__(self):
        init_db()
        self.conn = get_connection()

    def close(self):
        self.conn.close()

    @staticmethod
    def _hash_password(password: str, salt: str) -> str:
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()

    def create_user(self, username: str, password: str, display_name: str = None,
                    role: str = "operador_granola", ambiente: str = "granola") -> int:
        salt = secrets.token_hex(16)
        pw_hash = self._hash_password(password, salt)
        now = datetime.now().isoformat()
        cur = self.conn.execute(
            """INSERT INTO users (username, password_hash, salt, display_name, role, ambiente, criado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (username, pw_hash, salt, display_name or username, role, ambiente, now)
        )
        self.conn.commit()
        return cur.lastrowid

    def login(self, username: str, password: str) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM users WHERE username = ? AND ativo = 1", (username,)
        ).fetchone()
        if not row:
            return None
        expected = self._hash_password(password, row["salt"])
        if expected != row["password_hash"]:
            return None
        self.conn.execute(
            "UPDATE users SET ultimo_login = ? WHERE id = ?",
            (datetime.now().isoformat(), row["id"])
        )
        self.conn.commit()
        return dict(row)

    def create_session(self, user_id: int, remember: bool = False) -> str:
        token = secrets.token_urlsafe(32)
        now = datetime.now()
        ttl_hours = 720 if remember else 8  # 30 dias vs 8 horas
        expira = now + timedelta(hours=ttl_hours)
        self.conn.execute(
            "INSERT INTO sessions (token, user_id, criado_em, expira_em, ttl_hours) VALUES (?, ?, ?, ?, ?)",
            (token, user_id, now.isoformat(), expira.isoformat(), ttl_hours)
        )
        self.conn.execute("DELETE FROM sessions WHERE expira_em < ?", (now.isoformat(),))
        self.conn.commit()
        return token

    def validate_session(self, token: str) -> dict | None:
        now = datetime.now()
        row = self.conn.execute(
            """SELECT u.*, s.expira_em as _session_expira, s.ttl_hours as _session_ttl FROM sessions s
               JOIN users u ON s.user_id = u.id
               WHERE s.token = ? AND s.expira_em > ? AND u.ativo = 1""",
            (token, now.isoformat())
        ).fetchone()
        if not row:
            return None
        expira = datetime.fromisoformat(row["_session_expira"])
        ttl_hours = row["_session_ttl"] or 8
        # Renova quando restar menos de 25% do TTL (rolling refresh respeita o TTL original)
        refresh_threshold = (ttl_hours * 3600) * 0.25
        if (expira - now).total_seconds() < refresh_threshold:
            nova_expira = now + timedelta(hours=ttl_hours)
            self.conn.execute(
                "UPDATE sessions SET expira_em = ? WHERE token = ?",
                (nova_expira.isoformat(), token)
            )
            self.conn.commit()
        result = dict(row)
        result.pop("_session_expira", None)
        result.pop("_session_ttl", None)
        result.pop("password_hash", None)
        result.pop("salt", None)
        return result

    def logout(self, token: str):
        self.conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self.conn.commit()

    def log_action(self, user_id: int, username: str, action: str,
                   module: str = "granola", entity_type: str = None,
                   entity_id: int = None, entity_label: str = None,
                   details: str = None):
        self.conn.execute(
            """INSERT INTO audit_log
               (user_id, username, action, module, entity_type, entity_id, entity_label, details, criado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, username, action, module, entity_type, entity_id,
             entity_label, details, datetime.now().isoformat())
        )
        self.conn.commit()

    def list_users(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, username, display_name, role, ambiente, ativo, criado_em, ultimo_login FROM users ORDER BY username"
        ).fetchall()
        return [dict(r) for r in rows]

    def change_password(self, user_id: int, new_password: str):
        salt = secrets.token_hex(16)
        pw_hash = self._hash_password(new_password, salt)
        self.conn.execute(
            "UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?",
            (pw_hash, salt, user_id)
        )
        self.conn.commit()

    def update_user(self, user_id: int, fields: dict) -> bool:
        """Atualiza campos editáveis de um usuário (display_name, role, ambiente, ativo)."""
        allowed = {"display_name", "role", "ambiente", "ativo"}
        data = {k: v for k, v in fields.items() if k in allowed}
        if not data:
            return False
        sets = ", ".join(f"{k} = ?" for k in data)
        params = list(data.values()) + [user_id]
        self.conn.execute(f"UPDATE users SET {sets} WHERE id = ?", params)
        self.conn.commit()
        return True

    def get_user_by_id(self, user_id: int) -> dict | None:
        row = self.conn.execute(
            "SELECT id, username, display_name, role, ambiente, ativo FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
        return dict(row) if row else None


# ============================================================
#  Granola CRM DB
# ============================================================
class GranolaDB:
    """Interface para operações do CRM Jurídico Granola."""

    def __init__(self):
        init_db()
        self.conn = get_connection()

    def close(self):
        self.conn.close()

    # ---- helpers ----

    def _now(self) -> str:
        return datetime.now().isoformat()

    def _upsert(self, table: str, dados: dict, key_col: str, key_val) -> int:
        """Upsert genérico: se existe key_col=key_val, UPDATE; senão INSERT."""
        now = self._now()
        existente = self.conn.execute(
            f"SELECT id FROM {table} WHERE {key_col} = ?", (key_val,)
        ).fetchone()

        if existente:
            campos = {k: v for k, v in dados.items() if k != key_col and v is not None}
            if "atualizado_em" in _VALID_COLUMNS.get(table, set()):
                campos["atualizado_em"] = now
            if campos:
                _validate_columns(table, list(campos.keys()))
                sets = ", ".join(f"{k} = ?" for k in campos)
                vals = list(campos.values()) + [existente["id"]]
                self.conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", vals)
                self.conn.commit()
            return existente["id"]
        else:
            if "criado_em" in _VALID_COLUMNS.get(table, set()):
                dados["criado_em"] = now
            if "atualizado_em" in _VALID_COLUMNS.get(table, set()):
                dados["atualizado_em"] = now
            _validate_columns(table, list(dados.keys()))
            cols = ", ".join(dados.keys())
            phs = ", ".join("?" for _ in dados)
            cur = self.conn.execute(
                f"INSERT INTO {table} ({cols}) VALUES ({phs})", list(dados.values())
            )
            self.conn.commit()
            return cur.lastrowid

    def _insert(self, table: str, dados: dict) -> int:
        """INSERT simples."""
        now = self._now()
        if "criado_em" in _VALID_COLUMNS.get(table, set()):
            dados["criado_em"] = now
        if "atualizado_em" in _VALID_COLUMNS.get(table, set()) and "atualizado_em" not in dados:
            dados["atualizado_em"] = now
        _validate_columns(table, list(dados.keys()))
        cols = ", ".join(dados.keys())
        phs = ", ".join("?" for _ in dados)
        cur = self.conn.execute(
            f"INSERT INTO {table} ({cols}) VALUES ({phs})", list(dados.values())
        )
        self.conn.commit()
        return cur.lastrowid

    def _update(self, table: str, record_id: int, dados: dict):
        """UPDATE por id."""
        now = self._now()
        if "atualizado_em" in _VALID_COLUMNS.get(table, set()):
            dados["atualizado_em"] = now
        _validate_columns(table, list(dados.keys()))
        sets = ", ".join(f"{k} = ?" for k in dados)
        vals = list(dados.values()) + [record_id]
        self.conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", vals)
        self.conn.commit()

    def _get(self, table: str, record_id: int) -> dict | None:
        row = self.conn.execute(f"SELECT * FROM {table} WHERE id = ?", (record_id,)).fetchone()
        return dict(row) if row else None

    def _delete(self, table: str, record_id: int):
        self.conn.execute(f"DELETE FROM {table} WHERE id = ?", (record_id,))
        self.conn.commit()

    # ============================================================
    #  CLIENTES
    # ============================================================

    def upsert_cliente(self, dados: dict) -> int:
        cpf = dados.get("cpf_cnpj")
        if cpf:
            cpf = re.sub(r'[^\d]', '', cpf)
            dados["cpf_cnpj"] = cpf
        cliente_id = dados.pop("id", None)

        if cliente_id:
            self._update("granola_clientes", cliente_id, dados)
            return cliente_id

        if cpf:
            existente = self.conn.execute(
                "SELECT id FROM granola_clientes WHERE cpf_cnpj = ?", (cpf,)
            ).fetchone()
            if existente:
                self._update("granola_clientes", existente["id"], dados)
                return existente["id"]

        return self._insert("granola_clientes", dados)

    def get_cliente(self, cliente_id: int) -> dict | None:
        return self._get("granola_clientes", cliente_id)

    def get_cliente_detail(self, cliente_id: int) -> dict | None:
        cliente = self.get_cliente(cliente_id)
        if not cliente:
            return None
        processos = self.conn.execute(
            "SELECT id, numero_cnj, titulo, area, status, fase, valor_causa FROM granola_processos WHERE cliente_id = ? ORDER BY criado_em DESC",
            (cliente_id,)
        ).fetchall()
        cliente["processos"] = [dict(r) for r in processos]
        cliente["total_processos"] = len(processos)

        fin = self.conn.execute(
            """SELECT
                COALESCE(SUM(CASE WHEN tipo IN ('honorario','receita','reembolso') THEN valor ELSE 0 END), 0) as receitas,
                COALESCE(SUM(CASE WHEN tipo IN ('custa_judicial','custa_extrajudicial','despesa') THEN valor ELSE 0 END), 0) as despesas,
                COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) as pendentes
            FROM granola_financeiro WHERE cliente_id = ?""",
            (cliente_id,)
        ).fetchone()
        cliente["financeiro_resumo"] = dict(fin) if fin else {"receitas": 0, "despesas": 0, "pendentes": 0}
        return cliente

    def listar_clientes(self, busca: str = None, tipo: str = None, ativo: int = 1, limite: int = 200) -> list[dict]:
        query = """SELECT c.*, COUNT(p.id) as total_processos
                   FROM granola_clientes c
                   LEFT JOIN granola_processos p ON p.cliente_id = c.id"""
        wheres = []
        params = []

        if ativo is not None:
            wheres.append("c.ativo = ?")
            params.append(ativo)
        if tipo:
            wheres.append("c.tipo = ?")
            params.append(tipo)
        if busca:
            wheres.append("(c.nome LIKE ? OR c.cpf_cnpj LIKE ? OR c.email LIKE ?)")
            b = f"%{busca}%"
            params.extend([b, b, b])

        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " GROUP BY c.id ORDER BY c.nome LIMIT ?"
        params.append(limite)

        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def soft_delete_cliente(self, cliente_id: int):
        self.conn.execute(
            "UPDATE granola_clientes SET ativo = 0, atualizado_em = ? WHERE id = ?",
            (self._now(), cliente_id)
        )
        self.conn.commit()

    def hard_delete_cliente(self, cliente_id: int) -> dict:
        """Remove definitivamente um cliente do banco.
        - Se houver processos vinculados, apenas desvincula (cliente_id = NULL) preservando os processos.
        - Remove também entradas em granola_partes que referenciem esse cliente por nome.
        Retorna resumo da operação.
        """
        row = self.conn.execute(
            "SELECT id, nome FROM granola_clientes WHERE id = ?", (cliente_id,)
        ).fetchone()
        if not row:
            return {"deleted": False, "reason": "not_found"}
        nome = row["nome"]
        # Desvincula processos
        cur = self.conn.execute(
            "UPDATE granola_processos SET cliente_id = NULL WHERE cliente_id = ?",
            (cliente_id,)
        )
        processos_desvinculados = cur.rowcount or 0
        # Remove o cliente
        self.conn.execute("DELETE FROM granola_clientes WHERE id = ?", (cliente_id,))
        self.conn.commit()
        return {
            "deleted": True,
            "nome": nome,
            "processos_desvinculados": processos_desvinculados,
        }

    # ============================================================
    #  PROCESSOS
    # ============================================================

    def upsert_processo(self, dados: dict) -> int:
        # Normaliza CNJ para formato canônico (0000000-00.0000.0.00.0000)
        if "numero_cnj" in dados and dados.get("numero_cnj"):
            dados["numero_cnj"] = _format_cnj(dados["numero_cnj"])

        processo_id = dados.pop("id", None)
        if processo_id:
            self._update("granola_processos", processo_id, dados)
            return processo_id

        cnj = dados.get("numero_cnj")
        if cnj:
            # Busca considerando também formatos apenas com dígitos (legado)
            raw_digits = re.sub(r'\D', '', cnj)
            existente = self.conn.execute(
                """SELECT id FROM granola_processos
                   WHERE numero_cnj = ?
                      OR REPLACE(REPLACE(REPLACE(numero_cnj,'.',''),'-',''),'/','') = ?""",
                (cnj, raw_digits)
            ).fetchone()
            if existente:
                self._update("granola_processos", existente["id"], dados)
                return existente["id"]

        return self._insert("granola_processos", dados)

    def swap_cliente_parte_contraria(self, processo_id: int) -> bool:
        """Inverte cliente ↔ parte contrária de um processo e ajusta o polo."""
        proc = self.get_processo(processo_id)
        if not proc:
            return False
        cliente_atual_id = proc.get("cliente_id")
        cliente_atual = None
        if cliente_atual_id:
            cliente_atual = self._get("granola_clientes", cliente_atual_id)
        parte_contraria_nome = proc.get("parte_contraria")
        cpf_contraria = proc.get("cpf_cnpj_contraria")
        # Cria novo cliente a partir da parte contrária (se houver nome)
        novo_cliente_id = None
        if parte_contraria_nome:
            # Tenta localizar cliente existente por nome
            row = self.conn.execute(
                "SELECT id FROM granola_clientes WHERE LOWER(nome) = LOWER(?) AND (ativo IS NULL OR ativo = 1) LIMIT 1",
                (parte_contraria_nome.strip(),)
            ).fetchone()
            if row:
                novo_cliente_id = row["id"]
            else:
                novo_cliente_id = self.upsert_cliente({
                    "nome": parte_contraria_nome.strip(),
                    "cpf_cnpj": cpf_contraria,
                    "tipo": "PF",
                })
        # Atualiza processo
        novo_polo = "ativo" if (proc.get("polo") or "").lower() == "passivo" else "passivo"
        self._update("granola_processos", processo_id, {
            "cliente_id": novo_cliente_id,
            "parte_contraria": cliente_atual["nome"] if cliente_atual else None,
            "cpf_cnpj_contraria": cliente_atual.get("cpf_cnpj") if cliente_atual else None,
            "polo": novo_polo,
        })
        # Remove definitivamente o cliente antigo (que na verdade era parte contrária)
        # — apenas se não estiver vinculado a outros processos.
        if cliente_atual_id:
            outros = self.conn.execute(
                "SELECT COUNT(*) AS n FROM granola_processos WHERE cliente_id = ? AND id != ?",
                (cliente_atual_id, processo_id)
            ).fetchone()
            if not outros or outros["n"] == 0:
                self.conn.execute(
                    "DELETE FROM granola_partes WHERE processo_id = ? AND LOWER(nome) = LOWER(?)",
                    (processo_id, cliente_atual["nome"] if cliente_atual else "")
                )
                self.conn.execute(
                    "DELETE FROM granola_clientes WHERE id = ?",
                    (cliente_atual_id,)
                )
        self.conn.commit()
        return True

    def get_processo(self, processo_id: int) -> dict | None:
        return self._get("granola_processos", processo_id)

    def get_processo_detail(self, processo_id: int) -> dict | None:
        proc = self.get_processo(processo_id)
        if not proc:
            return None

        # Cliente
        if proc.get("cliente_id"):
            cliente = self.conn.execute(
                "SELECT id, nome, cpf_cnpj FROM granola_clientes WHERE id = ?",
                (proc["cliente_id"],)
            ).fetchone()
            proc["cliente"] = dict(cliente) if cliente else None
        else:
            proc["cliente"] = None

        # Partes
        partes = self.conn.execute(
            "SELECT * FROM granola_partes WHERE processo_id = ? ORDER BY tipo, nome",
            (processo_id,)
        ).fetchall()
        proc["partes"] = [dict(r) for r in partes]

        # Movimentações
        movs = self.conn.execute(
            "SELECT * FROM granola_movimentacoes WHERE processo_id = ? ORDER BY data_movimento DESC",
            (processo_id,)
        ).fetchall()
        proc["movimentacoes"] = [dict(r) for r in movs]

        # Prazos
        prazos = self.conn.execute(
            "SELECT * FROM granola_prazos WHERE processo_id = ? ORDER BY data_vencimento",
            (processo_id,)
        ).fetchall()
        proc["prazos"] = [dict(r) for r in prazos]

        # Financeiro
        fins = self.conn.execute(
            "SELECT * FROM granola_financeiro WHERE processo_id = ? ORDER BY data_vencimento DESC",
            (processo_id,)
        ).fetchall()
        proc["financeiro"] = [dict(r) for r in fins]

        # Documentos
        docs = self.conn.execute(
            "SELECT * FROM granola_documentos WHERE processo_id = ? ORDER BY criado_em DESC",
            (processo_id,)
        ).fetchall()
        proc["documentos"] = [dict(r) for r in docs]

        return proc

    def listar_processos(self, cliente_id: int = None, status: str = None,
                         area: str = None, busca: str = None, limite: int = 500) -> list[dict]:
        query = """SELECT p.*, c.nome as cliente_nome
                   FROM granola_processos p
                   LEFT JOIN granola_clientes c ON c.id = p.cliente_id"""
        wheres = []
        params = []

        if cliente_id:
            wheres.append("p.cliente_id = ?")
            params.append(cliente_id)
        if status:
            wheres.append("p.status = ?")
            params.append(status)
        else:
            wheres.append("p.status != 'excluido'")
        if area:
            wheres.append("p.area = ?")
            params.append(area)
        if busca:
            wheres.append("(p.numero_cnj LIKE ? OR p.titulo LIKE ? OR c.nome LIKE ?)")
            b = f"%{busca}%"
            params.extend([b, b, b])

        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " ORDER BY p.atualizado_em DESC LIMIT ?"
        params.append(limite)

        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def update_processo_status(self, processo_id: int, status: str):
        self._update("granola_processos", processo_id, {"status": status})

    def delete_processo(self, processo_id: int):
        self._update("granola_processos", processo_id, {"status": "excluido"})

    def update_processo_kanban(self, processo_id: int, coluna: str):
        self._update("granola_processos", processo_id, {"kanban_coluna": coluna})

    # ============================================================
    #  PARTES
    # ============================================================

    def upsert_parte(self, dados: dict) -> int:
        parte_id = dados.pop("id", None)
        if parte_id:
            self._update("granola_partes", parte_id, dados)
            return parte_id
        return self._insert("granola_partes", dados)

    def delete_parte(self, parte_id: int):
        self._delete("granola_partes", parte_id)

    def listar_partes(self, processo_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM granola_partes WHERE processo_id = ? ORDER BY tipo, nome",
            (processo_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ============================================================
    #  MOVIMENTAÇÕES
    # ============================================================

    def criar_movimentacao(self, dados: dict) -> int:
        desc = dados.get("descricao", "")
        proc_id = dados.get("processo_id")
        data_mov = dados.get("data_movimento", "")
        if desc and proc_id:
            # Lazy import: publicacoes.py importa database.py no topo, circular se global
            from granola.publicacoes import _hash_mov, _normalize_text, _normalize_date
            # Hash normalizado (unificado com coleta e-SAJ/PJe para casar duplicatas)
            numero_cnj = self.conn.execute(
                "SELECT numero_cnj FROM granola_processos WHERE id = ?",
                (proc_id,)
            ).fetchone()
            cnj_str = numero_cnj["numero_cnj"] if numero_cnj else str(proc_id)
            dados["hash_dedup"] = _hash_mov(cnj_str, data_mov, desc)
            # Fallback: se já existe mov com mesma assinatura normalizada, retorna id
            assinatura_nova = (_normalize_date(data_mov), _normalize_text(desc))
            existentes = self.conn.execute(
                "SELECT id, data_movimento, descricao FROM granola_movimentacoes WHERE processo_id = ?",
                (proc_id,)
            ).fetchall()
            for e in existentes:
                if (_normalize_date(e["data_movimento"]), _normalize_text(e["descricao"])) == assinatura_nova:
                    return e["id"]
        try:
            return self._insert("granola_movimentacoes", dados)
        except sqlite3.IntegrityError:
            # Duplicata — retorna id existente
            row = self.conn.execute(
                "SELECT id FROM granola_movimentacoes WHERE processo_id = ? AND hash_dedup = ?",
                (proc_id, dados.get("hash_dedup"))
            ).fetchone()
            return row["id"] if row else 0

    def listar_movimentacoes(self, processo_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM granola_movimentacoes WHERE processo_id = ? ORDER BY data_movimento DESC",
            (processo_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ============================================================
    #  PRAZOS
    # ============================================================

    def upsert_prazo(self, dados: dict) -> int:
        prazo_id = dados.pop("id", None)
        if prazo_id:
            self._update("granola_prazos", prazo_id, dados)
            return prazo_id
        return self._insert("granola_prazos", dados)

    def concluir_prazo(self, prazo_id: int):
        self._update("granola_prazos", prazo_id, {
            "status": "concluido",
            "data_conclusao": self._now()
        })

    # ============================================================
    #  PUBLICAÇÕES — TRATAMENTO
    # ============================================================

    def listar_publicacoes_tratamento(self, tratamento: str = None, limite: int = 200) -> list[dict]:
        """
        Lista movimentações coletadas automaticamente (esaj_auto/pje_auto) com
        o status de tratamento (pendente, visto, prazo, ignorado).
        Ordena pela data da MOVIMENTAÇÃO, não pela coleta.
        """
        query = """
            SELECT m.*, p.numero_cnj, p.titulo as processo_titulo,
                   cl.id as cliente_id, cl.nome as cliente_nome,
                   pz.titulo as prazo_titulo, pz.data_vencimento as prazo_vencimento,
                   pz.status as prazo_status,
                   CASE
                     WHEN m.data_movimento LIKE '__/__/____'
                       THEN substr(m.data_movimento,7,4)||'-'||substr(m.data_movimento,4,2)||'-'||substr(m.data_movimento,1,2)
                     WHEN length(m.data_movimento) >= 10 AND substr(m.data_movimento,5,1) = '-'
                       THEN substr(m.data_movimento,1,10)
                     ELSE substr(m.criado_em,1,10)
                   END AS data_sort
            FROM granola_movimentacoes m
            JOIN granola_processos p ON p.id = m.processo_id
            LEFT JOIN granola_clientes cl ON cl.id = p.cliente_id
            LEFT JOIN granola_prazos pz ON pz.id = m.prazo_id
            WHERE m.fonte IN ('esaj_auto', 'pje_auto')
        """
        params = []
        if tratamento:
            query += " AND COALESCE(m.tratamento, 'pendente') = ?"
            params.append(tratamento)
        query += " ORDER BY data_sort DESC, m.criado_em DESC LIMIT ?"
        params.append(limite)
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def contar_publicacoes_pendentes(self) -> int:
        row = self.conn.execute(
            """SELECT COUNT(*) as n FROM granola_movimentacoes
               WHERE fonte IN ('esaj_auto','pje_auto')
                 AND COALESCE(tratamento,'pendente') = 'pendente'"""
        ).fetchone()
        return row["n"] if row else 0

    def marcar_publicacao_tratamento(self, mov_id: int, tratamento: str,
                                      username: str, prazo_id: int = None) -> bool:
        """Atualiza o tratamento de uma movimentação (visto/pendente/prazo/ignorado)."""
        now = self._now() if hasattr(self, "_now") else datetime.now().isoformat()
        fields = {
            "tratamento": tratamento,
            "tratamento_por": username,
            "tratamento_em": now,
        }
        if tratamento == "prazo" and prazo_id:
            fields["prazo_id"] = prazo_id
        elif tratamento != "prazo":
            fields["prazo_id"] = None
        sets = ", ".join(f"{k} = ?" for k in fields)
        params = list(fields.values()) + [mov_id]
        self.conn.execute(
            f"UPDATE granola_movimentacoes SET {sets} WHERE id = ?", params
        )
        self.conn.commit()
        return True

    def get_movimentacao(self, mov_id: int) -> dict | None:
        row = self.conn.execute(
            """SELECT m.*, p.numero_cnj, p.titulo as processo_titulo, p.cliente_id
               FROM granola_movimentacoes m
               JOIN granola_processos p ON p.id = m.processo_id
               WHERE m.id = ?""",
            (mov_id,)
        ).fetchone()
        return dict(row) if row else None

    def listar_prazos(self, processo_id: int = None, dias: int = None,
                      prioridade: str = None, status: str = "pendente") -> list[dict]:
        query = """SELECT pz.*, p.numero_cnj, p.titulo as processo_titulo, c.nome as cliente_nome
                   FROM granola_prazos pz
                   LEFT JOIN granola_processos p ON p.id = pz.processo_id
                   LEFT JOIN granola_clientes c ON c.id = pz.cliente_id"""
        wheres = []
        params = []

        if status:
            wheres.append("pz.status = ?")
            params.append(status)
        if processo_id:
            wheres.append("pz.processo_id = ?")
            params.append(processo_id)
        if prioridade:
            wheres.append("pz.prioridade = ?")
            params.append(prioridade)
        if dias is not None:
            limite_data = (datetime.now() + timedelta(days=dias)).strftime("%Y-%m-%d")
            wheres.append("pz.data_vencimento <= ?")
            params.append(limite_data)

        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " ORDER BY pz.data_vencimento ASC"

        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    # ============================================================
    #  FINANCEIRO
    # ============================================================

    def upsert_financeiro(self, dados: dict) -> int:
        fin_id = dados.pop("id", None)
        if fin_id:
            self._update("granola_financeiro", fin_id, dados)
            return fin_id
        return self._insert("granola_financeiro", dados)

    def pagar_financeiro(self, fin_id: int, forma_pagamento: str = None):
        update = {"status": "pago", "data_pagamento": self._now()}
        if forma_pagamento:
            update["forma_pagamento"] = forma_pagamento
        self._update("granola_financeiro", fin_id, update)

    def delete_financeiro(self, fin_id: int):
        self.conn.execute("DELETE FROM granola_financeiro WHERE id = ?", (fin_id,))
        self.conn.commit()

    def listar_financeiro(self, cliente_id: int = None, processo_id: int = None,
                          tipo: str = None, status: str = None,
                          periodo_inicio: str = None, periodo_fim: str = None,
                          limite: int = 500) -> list[dict]:
        query = """SELECT f.*, p.numero_cnj, p.titulo as processo_titulo, c.nome as cliente_nome
                   FROM granola_financeiro f
                   LEFT JOIN granola_processos p ON p.id = f.processo_id
                   LEFT JOIN granola_clientes c ON c.id = f.cliente_id"""
        wheres = []
        params = []

        if cliente_id:
            wheres.append("f.cliente_id = ?")
            params.append(cliente_id)
        if processo_id:
            wheres.append("f.processo_id = ?")
            params.append(processo_id)
        if tipo:
            wheres.append("f.tipo = ?")
            params.append(tipo)
        if status:
            wheres.append("f.status = ?")
            params.append(status)
        if periodo_inicio:
            wheres.append("f.data_vencimento >= ?")
            params.append(periodo_inicio)
        if periodo_fim:
            wheres.append("f.data_vencimento <= ?")
            params.append(periodo_fim)

        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " ORDER BY f.data_vencimento DESC LIMIT ?"
        params.append(limite)

        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def resumo_financeiro(self, cliente_id: int = None, processo_id: int = None,
                          periodo_inicio: str = None, periodo_fim: str = None) -> dict:
        query = "SELECT tipo, status, SUM(valor) as total FROM granola_financeiro"
        wheres = []
        params = []
        if cliente_id:
            wheres.append("cliente_id = ?")
            params.append(cliente_id)
        if processo_id:
            wheres.append("processo_id = ?")
            params.append(processo_id)
        if periodo_inicio:
            wheres.append("data_vencimento >= ?")
            params.append(periodo_inicio)
        if periodo_fim:
            wheres.append("data_vencimento <= ?")
            params.append(periodo_fim)
        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " GROUP BY tipo, status"

        rows = self.conn.execute(query, params).fetchall()
        receitas = 0.0
        despesas = 0.0
        pendentes = 0.0
        rec_pendentes = 0.0
        cust_pendentes = 0.0
        _TIPOS_REC = ("honorario", "receita", "reembolso", "receita_fixa", "receita_variavel")
        _TIPOS_CUSTO = ("custa_judicial", "custa_extrajudicial", "despesa", "custo_operacional", "custo_variavel")
        for r in rows:
            val = r["total"] or 0
            is_rec = r["tipo"] in _TIPOS_REC
            is_custo = r["tipo"] in _TIPOS_CUSTO
            if is_rec:
                receitas += val
            elif is_custo:
                despesas += val
            if r["status"] == "pendente":
                pendentes += val
                if is_rec:
                    rec_pendentes += val
                elif is_custo:
                    cust_pendentes += val

        return {
            "receitas": round(receitas, 2),
            "despesas": round(despesas, 2),
            "saldo": round(receitas - despesas, 2),
            "pendentes": round(pendentes, 2),
            "rec_pendentes": round(rec_pendentes, 2),
            "cust_pendentes": round(cust_pendentes, 2),
        }

    # ---- Config ----
    def get_config(self, key: str, default: str = "") -> str:
        row = self.conn.execute("SELECT value FROM granola_config WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def set_config(self, key: str, value: str):
        self.conn.execute(
            "INSERT OR REPLACE INTO granola_config (key, value, atualizado_em) VALUES (?, ?, ?)",
            (key, value, self._now())
        )
        self.conn.commit()

    # ---- Gastos por sócio ----
    def listar_gastos_socios(self) -> dict:
        rows = self.conn.execute(
            """SELECT f.*, p.numero_cnj, c.nome as cliente_nome
               FROM granola_financeiro f
               LEFT JOIN granola_processos p ON p.id = f.processo_id
               LEFT JOIN granola_clientes c ON c.id = f.cliente_id
               WHERE f.socio IS NOT NULL
               ORDER BY f.criado_em DESC"""
        ).fetchall()
        result = {"enzo": [], "lucas": [], "hiroshi": [], "compartilhado": []}
        for r in rows:
            d = dict(r)
            key = d["socio"] if d["socio"] in result else "compartilhado"
            if d.get("cartao_corporativo"):
                d["_compartilhado"] = False
            else:
                d["_compartilhado"] = True
            result[key].append(d)
        return result

    def listar_reembolsos(self) -> dict:
        """Custos operacionais/variáveis pagos nos cartões PF (Enzo/Lucas) que devem ser reembolsados."""
        rows = self.conn.execute(
            """SELECT id, descricao, valor, data_vencimento, status, pago_por_cartao
               FROM granola_financeiro
               WHERE pago_por_cartao IS NOT NULL AND pago_por_cartao != ''
               ORDER BY data_vencimento DESC"""
        ).fetchall()
        result = {"enzo": [], "lucas": []}
        for r in rows:
            d = dict(r)
            key = d["pago_por_cartao"]
            if key in result:
                result[key].append(d)
        return result

    # ============================================================
    #  AGENDA
    # ============================================================

    def upsert_agenda(self, dados: dict) -> int:
        agenda_id = dados.pop("id", None)
        if agenda_id:
            self._update("granola_agenda", agenda_id, dados)
            return agenda_id
        return self._insert("granola_agenda", dados)

    def update_agenda_status(self, agenda_id: int, status: str):
        self._update("granola_agenda", agenda_id, {"status": status})

    def delete_agenda(self, agenda_id: int):
        self._delete("granola_agenda", agenda_id)

    def get_agenda_by_id(self, agenda_id: int) -> dict | None:
        row = self.conn.execute("SELECT * FROM granola_agenda WHERE id = ?", (agenda_id,)).fetchone()
        return dict(row) if row else None

    def get_agenda_by_google_id(self, google_event_id: str) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM granola_agenda WHERE google_event_id = ?", (google_event_id,)
        ).fetchone()
        return dict(row) if row else None

    def set_google_event_id(self, agenda_id: int, google_event_id: str):
        self._update("granola_agenda", agenda_id, {"google_event_id": google_event_id})

    def listar_agenda_all(self) -> list[dict]:
        """Lista todos os eventos da agenda (para sync)."""
        rows = self.conn.execute("SELECT * FROM granola_agenda ORDER BY data_inicio").fetchall()
        return [dict(r) for r in rows]

    def listar_agenda(self, mes: str = None, tipo: str = None) -> list[dict]:
        query = """SELECT a.*, p.numero_cnj, p.titulo as processo_titulo, c.nome as cliente_nome
                   FROM granola_agenda a
                   LEFT JOIN granola_processos p ON p.id = a.processo_id
                   LEFT JOIN granola_clientes c ON c.id = a.cliente_id"""
        wheres = []
        params = []
        if mes:
            wheres.append("a.data_inicio LIKE ?")
            params.append(f"{mes}%")
        if tipo:
            wheres.append("a.tipo = ?")
            params.append(tipo)
        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " ORDER BY a.data_inicio"

        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    # ============================================================
    #  DOCUMENTOS
    # ============================================================

    def criar_documento(self, dados: dict) -> int:
        return self._insert("granola_documentos", dados)

    def listar_documentos(self, processo_id: int = None, cliente_id: int = None) -> list[dict]:
        query = "SELECT * FROM granola_documentos"
        wheres = []
        params = []
        if processo_id:
            wheres.append("processo_id = ?")
            params.append(processo_id)
        if cliente_id:
            wheres.append("cliente_id = ?")
            params.append(cliente_id)
        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " ORDER BY criado_em DESC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def delete_documento(self, doc_id: int):
        self._delete("granola_documentos", doc_id)

    # ============================================================
    #  KANBAN
    # ============================================================

    def listar_kanban_colunas(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM granola_kanban_colunas ORDER BY ordem"
        ).fetchall()
        return [dict(r) for r in rows]

    def upsert_kanban_coluna(self, key: str, label: str, ordem: int, cor: str = "#10b981"):
        self.conn.execute(
            "INSERT OR REPLACE INTO granola_kanban_colunas (key, label, ordem, cor) VALUES (?, ?, ?, ?)",
            (key, label, ordem, cor)
        )
        self.conn.commit()

    def get_kanban(self) -> dict:
        colunas = self.listar_kanban_colunas()
        result = []
        for col in colunas:
            procs = self.conn.execute(
                """SELECT p.id, p.numero_cnj, p.titulo, p.area, p.fase, p.kanban_coluna,
                          p.criado_em, c.nome as cliente_nome
                   FROM granola_processos p
                   LEFT JOIN granola_clientes c ON c.id = p.cliente_id
                   WHERE p.kanban_coluna = ? AND p.status = 'ativo'
                   ORDER BY p.atualizado_em DESC""",
                (col["key"],)
            ).fetchall()
            result.append({
                "key": col["key"],
                "label": col["label"],
                "ordem": col["ordem"],
                "cor": col["cor"],
                "cards": [dict(r) for r in procs],
            })
        return {"colunas": result}

    # ============================================================
    #  PENDING EDITS (Approval Workflow)
    # ============================================================

    def create_pending_edit(self, entity_type: str, entity_id: int, user_id: int,
                            username: str, field: str, old_value, new_value) -> int:
        return self._insert("granola_pending_edits", {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "user_id": user_id,
            "username": username,
            "field": field,
            "old_value": str(old_value) if old_value is not None else "",
            "new_value": str(new_value),
            "status": "pendente",
        })

    def approve_pending_edit(self, edit_id: int, admin_id: int) -> bool:
        edit = self.conn.execute(
            "SELECT * FROM granola_pending_edits WHERE id = ? AND status = 'pendente'",
            (edit_id,)
        ).fetchone()
        if not edit:
            return False
        entity_type = edit["entity_type"]
        entity_id = edit["entity_id"]
        field = edit["field"]
        new_value = edit["new_value"]

        table_map = {
            "processo": "granola_processos",
            "cliente": "granola_clientes",
            "financeiro": "granola_financeiro",
        }
        table = table_map.get(entity_type)
        if table:
            _validate_columns(table, [field])
            self.conn.execute(
                f"UPDATE {table} SET {field} = ?, atualizado_em = ? WHERE id = ?",
                (new_value, self._now(), entity_id)
            )
        self.conn.execute(
            "UPDATE granola_pending_edits SET status = 'aprovado', revisado_em = ?, revisado_por = ? WHERE id = ?",
            (self._now(), admin_id, edit_id)
        )
        self.conn.commit()
        return True

    def reject_pending_edit(self, edit_id: int, admin_id: int) -> bool:
        self.conn.execute(
            "UPDATE granola_pending_edits SET status = 'rejeitado', revisado_em = ?, revisado_por = ? WHERE id = ?",
            (self._now(), admin_id, edit_id)
        )
        self.conn.commit()
        return True

    def listar_pending_edits(self, status: str = "pendente") -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM granola_pending_edits WHERE status = ? ORDER BY criado_em DESC",
            (status,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ============================================================
    #  NOTIFICAÇÕES
    # ============================================================

    def criar_notificacao(self, tipo: str, titulo: str, mensagem: str = None,
                          user_id: int = None, entity_type: str = None,
                          entity_id: int = None) -> int:
        return self._insert("granola_notificacoes", {
            "user_id": user_id,
            "tipo": tipo,
            "titulo": titulo,
            "mensagem": mensagem,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "lida": 0,
        })

    def listar_notificacoes(self, user_id: int, lidas: bool = None) -> list[dict]:
        query = "SELECT * FROM granola_notificacoes WHERE (user_id = ? OR user_id IS NULL)"
        params = [user_id]
        if lidas is not None:
            query += " AND lida = ?"
            params.append(1 if lidas else 0)
        query += " ORDER BY criado_em DESC LIMIT 50"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def marcar_notificacao_lida(self, notif_id: int):
        self.conn.execute(
            "UPDATE granola_notificacoes SET lida = 1 WHERE id = ?", (notif_id,)
        )
        self.conn.commit()

    def contar_notificacoes_nao_lidas(self, user_id: int) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) as n FROM granola_notificacoes WHERE (user_id = ? OR user_id IS NULL) AND lida = 0",
            (user_id,)
        ).fetchone()
        return row["n"] if row else 0

    # ============================================================
    #  STATS (Dashboard)
    # ============================================================

    def stats(self) -> dict:
        c = self.conn
        total_clientes = c.execute(
            "SELECT COUNT(*) as n FROM granola_clientes WHERE ativo = 1"
        ).fetchone()["n"]

        total_processos = c.execute(
            "SELECT COUNT(*) as n FROM granola_processos WHERE status = 'ativo'"
        ).fetchone()["n"]

        # Prazos urgentes (próximos 7 dias, pendentes)
        limite_7d = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        hoje = datetime.now().strftime("%Y-%m-%d")
        prazos_urgentes = c.execute(
            "SELECT COUNT(*) as n FROM granola_prazos WHERE status = 'pendente' AND data_vencimento <= ? AND data_vencimento >= ?",
            (limite_7d, hoje)
        ).fetchone()["n"]

        prazos_vencidos = c.execute(
            "SELECT COUNT(*) as n FROM granola_prazos WHERE status = 'pendente' AND data_vencimento < ?",
            (hoje,)
        ).fetchone()["n"]

        # Financeiro
        fin = self.resumo_financeiro()

        # Processos por status
        por_status = {}
        for row in c.execute("SELECT status, COUNT(*) as n FROM granola_processos GROUP BY status"):
            por_status[row["status"]] = row["n"]

        # Processos por área
        por_area = {}
        for row in c.execute("SELECT area, COUNT(*) as n FROM granola_processos WHERE status = 'ativo' GROUP BY area"):
            por_area[row["area"]] = row["n"]

        # Movimentações recentes — ordena pela data da MOVIMENTAÇÃO (não pela coleta).
        # Usa um campo computado `data_sort` que prefere data_movimento (DD/MM/YYYY ou
        # YYYY-MM-DD) e cai para criado_em quando a movimentação não trouxe data.
        movs_recentes = c.execute(
            """SELECT m.*, p.numero_cnj, p.titulo as processo_titulo, cl.nome as cliente_nome,
                      CASE
                        WHEN m.data_movimento LIKE '__/__/____'
                          THEN substr(m.data_movimento,7,4)||'-'||substr(m.data_movimento,4,2)||'-'||substr(m.data_movimento,1,2)
                        WHEN length(m.data_movimento) >= 10 AND substr(m.data_movimento,5,1) = '-'
                          THEN substr(m.data_movimento,1,10)
                        ELSE substr(m.criado_em,1,10)
                      END AS data_sort
               FROM granola_movimentacoes m
               LEFT JOIN granola_processos p ON p.id = m.processo_id
               LEFT JOIN granola_clientes cl ON cl.id = p.cliente_id
               ORDER BY data_sort DESC, m.criado_em DESC LIMIT 10"""
        ).fetchall()

        # Prazos próximos
        prazos_proximos = self.listar_prazos(dias=7, status="pendente")

        return {
            "total_clientes": total_clientes,
            "total_processos": total_processos,
            "prazos_urgentes": prazos_urgentes,
            "prazos_vencidos": prazos_vencidos,
            "financeiro": fin,
            "por_status": por_status,
            "por_area": por_area,
            "movimentacoes_recentes": [dict(r) for r in movs_recentes],
            "prazos_proximos": prazos_proximos,
        }
