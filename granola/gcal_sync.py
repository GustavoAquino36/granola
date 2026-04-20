"""
Granola — Google Calendar Sync
Sincronização bidirecional entre granola_agenda e Google Calendar.
OAuth 2.0 web flow integrado ao server existente (porta 3458).
"""
import json
import logging
import threading
from datetime import datetime
from pathlib import Path

try:
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import Flow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    HAS_GOOGLE = True
except ImportError:
    HAS_GOOGLE = False

log = logging.getLogger("granola.gcal")

DATA_DIR = Path(__file__).parent / "data"
TOKEN_FILE = DATA_DIR / "gcal_token.json"
CREDENTIALS_FILE = DATA_DIR / "gcal_credentials.json"
CONFIG_FILE = DATA_DIR / "gcal_config.json"
SCOPES = ["https://www.googleapis.com/auth/calendar"]

# Mapeamento tipo Granola -> colorId Google Calendar
# 1=Lavender 2=Sage 3=Grape 4=Flamingo 5=Banana 6=Tangerine 7=Peacock 8=Graphite 9=Blueberry 10=Basil 11=Tomato
TIPO_TO_COLOR = {
    "audiencia": "3",   # Grape (roxo)
    "reuniao": "9",     # Blueberry (azul)
    "prazo": "6",       # Tangerine (laranja)
    "pericia": "7",     # Peacock (ciano)
    "diligencia": "5",  # Banana (amarelo)
    "lembrete": "1",    # Lavender
}
COLOR_TO_TIPO = {v: k for k, v in TIPO_TO_COLOR.items()}


def _load_config() -> dict:
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    return {}


def _save_config(cfg: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def get_calendar_id() -> str:
    cfg = _load_config()
    return cfg.get("calendar_id", "primary")


def set_calendar_id(cal_id: str):
    cfg = _load_config()
    cfg["calendar_id"] = cal_id
    _save_config(cfg)


# ============================================================
#  Autenticação
# ============================================================
def _get_credentials():
    """Carrega credenciais OAuth do token salvo."""
    if not HAS_GOOGLE:
        return None
    if not TOKEN_FILE.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
        except Exception as e:
            log.warning(f"Falha ao renovar token: {e}")
            return None
    if creds and creds.valid:
        return creds
    return None


def is_authenticated() -> bool:
    return _get_credentials() is not None


def get_service():
    """Retorna o serviço Google Calendar API autenticado."""
    creds = _get_credentials()
    if not creds:
        return None
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


_pending_flows: dict[str, object] = {}  # state -> Flow (persiste entre auth e callback)


def create_auth_flow(redirect_uri: str) -> tuple[str, str]:
    """Cria o fluxo OAuth e retorna (auth_url, state)."""
    if not HAS_GOOGLE:
        raise ImportError("google-api-python-client nao instalado. Rode: pip install google-api-python-client google-auth-oauthlib")
    if not CREDENTIALS_FILE.exists():
        raise FileNotFoundError(
            "gcal_credentials.json nao encontrado em granola/data/. "
            "Baixe as credenciais OAuth do Google Cloud Console."
        )
    flow = Flow.from_client_secrets_file(
        str(CREDENTIALS_FILE),
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    _pending_flows[state] = flow  # Guardar flow com code_verifier
    return auth_url, state


def complete_auth_flow(authorization_response: str, redirect_uri: str, state: str):
    """Completa o fluxo OAuth e salva o token."""
    flow = _pending_flows.pop(state, None)
    if not flow:
        # Fallback: criar novo flow (sem PKCE)
        flow = Flow.from_client_secrets_file(
            str(CREDENTIALS_FILE),
            scopes=SCOPES,
            redirect_uri=redirect_uri,
            state=state,
        )
    flow.fetch_token(authorization_response=authorization_response)
    creds = flow.credentials
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    log.info("Google Calendar autenticado com sucesso.")


def list_calendars() -> list[dict]:
    """Lista agendas disponíveis."""
    service = get_service()
    if not service:
        return []
    result = service.calendarList().list().execute()
    cals = []
    for c in result.get("items", []):
        cals.append({
            "id": c["id"],
            "summary": c.get("summary", c["id"]),
            "primary": c.get("primary", False),
            "accessRole": c.get("accessRole", ""),
        })
    return cals


# ============================================================
#  Conversão Granola <-> Google
# ============================================================
def _ensure_seconds(dt_str: str) -> str:
    """Garante formato com segundos (HH:MM:SS) para Google API."""
    if "T" in dt_str:
        date_part, time_part = dt_str.split("T", 1)
        # Remove microseconds if present
        time_part = time_part.split(".")[0]
        # Add :00 seconds if missing (e.g. "09:00" -> "09:00:00")
        if time_part.count(":") == 1:
            time_part += ":00"
        return f"{date_part}T{time_part}"
    return dt_str


def _granola_to_google(evento: dict) -> dict:
    """Converte evento Granola para formato Google Calendar."""
    body = {
        "summary": evento["titulo"],
        "description": evento.get("descricao") or "",
        "location": evento.get("local") or "",
    }

    # Start
    start = _ensure_seconds(evento["data_inicio"])
    if "T" in start:
        body["start"] = {"dateTime": start, "timeZone": "America/Sao_Paulo"}
    else:
        body["start"] = {"date": start}

    # End — se fim < inicio, usar inicio + 1h como fallback
    end = evento.get("data_fim") or start
    end = _ensure_seconds(end)
    if "T" in end and "T" in start and end < start:
        # End before start: add 1 hour to start
        try:
            from datetime import timedelta
            dt = datetime.fromisoformat(start)
            end = (dt + timedelta(hours=1)).isoformat()
        except Exception:
            end = start
    if "T" in end:
        body["end"] = {"dateTime": end, "timeZone": "America/Sao_Paulo"}
    else:
        body["end"] = {"date": end}

    # Color by tipo
    tipo = evento.get("tipo", "lembrete")
    if tipo in TIPO_TO_COLOR:
        body["colorId"] = TIPO_TO_COLOR[tipo]

    # Metadata no extendedProperties
    body["extendedProperties"] = {
        "private": {
            "granola_id": str(evento.get("id", "")),
            "granola_tipo": tipo,
            "granola_status": evento.get("status", "agendado"),
        }
    }

    return body


def _google_to_granola(g_event: dict) -> dict:
    """Converte evento Google Calendar para formato Granola."""
    start = g_event["start"].get("dateTime") or g_event["start"].get("date", "")
    end = g_event["end"].get("dateTime") or g_event["end"].get("date", "")

    # Detectar tipo pelo colorId ou extendedProperties
    ext = g_event.get("extendedProperties", {}).get("private", {})
    tipo = ext.get("granola_tipo")
    if not tipo:
        color_id = g_event.get("colorId", "")
        tipo = COLOR_TO_TIPO.get(color_id, "reuniao")

    return {
        "titulo": g_event.get("summary", "Sem Titulo"),
        "descricao": g_event.get("description") or None,
        "data_inicio": start,
        "data_fim": end if end != start else None,
        "tipo": tipo,
        "local": g_event.get("location") or None,
        "status": ext.get("granola_status", "agendado"),
        "google_event_id": g_event["id"],
    }


# ============================================================
#  CRUD Google Calendar
# ============================================================
def push_event(evento: dict) -> str | None:
    """Cria evento no Google Calendar. Retorna google_event_id."""
    service = get_service()
    if not service:
        log.warning("Google Calendar nao autenticado, evento nao enviado.")
        return None
    body = _granola_to_google(evento)
    cal_id = get_calendar_id()
    try:
        result = service.events().insert(calendarId=cal_id, body=body).execute()
        log.info(f"Evento criado no Google: {result['id']}")
        return result["id"]
    except HttpError as e:
        log.error(f"Erro ao criar evento no Google: {e}")
        return None


def update_event(google_event_id: str, evento: dict) -> bool:
    """Atualiza evento no Google Calendar."""
    service = get_service()
    if not service:
        return False
    body = _granola_to_google(evento)
    cal_id = get_calendar_id()
    try:
        service.events().update(
            calendarId=cal_id, eventId=google_event_id, body=body
        ).execute()
        log.info(f"Evento atualizado no Google: {google_event_id}")
        return True
    except HttpError as e:
        log.error(f"Erro ao atualizar evento no Google: {e}")
        return False


def delete_event(google_event_id: str) -> bool:
    """Remove evento do Google Calendar."""
    service = get_service()
    if not service:
        return False
    cal_id = get_calendar_id()
    try:
        service.events().delete(calendarId=cal_id, eventId=google_event_id).execute()
        log.info(f"Evento removido do Google: {google_event_id}")
        return True
    except HttpError as e:
        log.error(f"Erro ao remover evento no Google: {e}")
        return False


def pull_events(time_min: str = None, time_max: str = None) -> list[dict]:
    """Busca eventos do Google Calendar no periodo."""
    service = get_service()
    if not service:
        return []
    cal_id = get_calendar_id()
    kwargs = {
        "calendarId": cal_id,
        "singleEvents": True,
        "orderBy": "startTime",
        "maxResults": 2500,
    }
    if time_min:
        if not time_min.endswith("Z") and "+" not in time_min:
            time_min += "T00:00:00-03:00"
        kwargs["timeMin"] = time_min
    if time_max:
        if not time_max.endswith("Z") and "+" not in time_max:
            time_max += "T23:59:59-03:00"
        kwargs["timeMax"] = time_max

    events = []
    page_token = None
    try:
        while True:
            if page_token:
                kwargs["pageToken"] = page_token
            result = service.events().list(**kwargs).execute()
            events.extend(result.get("items", []))
            page_token = result.get("nextPageToken")
            if not page_token:
                break
    except HttpError as e:
        log.error(f"Erro ao buscar eventos do Google: {e}")
    return events


# ============================================================
#  Sync bidirecional
# ============================================================
_sync_lock = threading.Lock()


def _parse_timestamp(ts: str) -> datetime:
    """Converte timestamp (Google RFC3339 ou local ISO) para datetime comparável."""
    if not ts:
        return datetime.min
    # Remove 'Z' e converte para local (Google usa UTC)
    ts = ts.replace("Z", "+00:00")
    try:
        from datetime import timezone
        dt = datetime.fromisoformat(ts)
        # Se tem timezone, converter para local
        if dt.tzinfo:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return datetime.min


def full_sync(db) -> dict:
    """
    Sync bidirecional entre granola_agenda e Google Calendar.
    Retorna {pushed, pulled, updated, errors}.
    """
    if not _sync_lock.acquire(blocking=False):
        return {"error": "Sync ja em andamento"}

    try:
        stats = {"pushed": 0, "pulled": 0, "updated": 0, "deleted": 0, "errors": 0, "skipped": 0}

        if not is_authenticated():
            return {"error": "Google Calendar nao autenticado"}

        # --- PUSH: Granola -> Google (somente eventos novos sem google_event_id) ---
        local_events = db.listar_agenda_all()
        for ev in local_events:
            if ev.get("google_event_id"):
                stats["skipped"] += 1
                continue
            try:
                gid = push_event(ev)
                if gid:
                    db.set_google_event_id(ev["id"], gid)
                    stats["pushed"] += 1
                else:
                    stats["errors"] += 1
            except Exception as e:
                log.error(f"Erro sync push evento {ev.get('id')}: {e}")
                stats["errors"] += 1

        # --- PULL: Google -> Granola ---
        from datetime import timedelta
        now = datetime.now()
        time_min = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        time_max = (now + timedelta(days=365)).strftime("%Y-%m-%d")

        google_events = pull_events(time_min, time_max)

        # Index local events by google_event_id para lookup rápido
        local_by_gid = {}
        for ev in db.listar_agenda_all():
            if ev.get("google_event_id"):
                local_by_gid[ev["google_event_id"]] = ev

        # Set de IDs ativos no Google para detectar deletados
        google_active_ids = set()

        for g_event in google_events:
            gid = g_event["id"]

            if g_event.get("status") == "cancelled":
                # Evento cancelado no Google — remover do Granola se existir
                existing = local_by_gid.get(gid)
                if existing:
                    db.delete_agenda(existing["id"])
                    stats["deleted"] += 1
                    log.info(f"Evento removido do Granola (cancelado no Google): {existing.get('titulo')}")
                continue

            google_active_ids.add(gid)
            existing = local_by_gid.get(gid)

            if existing:
                # Ja mapeado — comparar timestamps com parsing correto
                g_updated = _parse_timestamp(g_event.get("updated", ""))
                local_updated = _parse_timestamp(
                    existing.get("atualizado_em") or existing.get("criado_em") or ""
                )
                if g_updated > local_updated:
                    granola_data = _google_to_granola(g_event)
                    granola_data["id"] = existing["id"]
                    granola_data["processo_id"] = existing.get("processo_id")
                    granola_data["cliente_id"] = existing.get("cliente_id")
                    granola_data["prazo_id"] = existing.get("prazo_id")
                    db.upsert_agenda(granola_data)
                    stats["updated"] += 1
                else:
                    stats["skipped"] += 1
            else:
                # Verificar se é evento criado pelo Granola (by extendedProperties)
                ext = g_event.get("extendedProperties", {}).get("private", {})
                granola_id = ext.get("granola_id")
                if granola_id:
                    local_by_id = db.get_agenda_by_id(int(granola_id)) if granola_id.isdigit() else None
                    if local_by_id and not local_by_id.get("google_event_id"):
                        db.set_google_event_id(int(granola_id), gid)
                        stats["updated"] += 1
                    continue

                # Evento novo do Google, importar para Granola
                granola_data = _google_to_granola(g_event)
                try:
                    new_id = db.upsert_agenda(granola_data)
                    stats["pulled"] += 1
                except Exception as e:
                    log.error(f"Erro ao importar evento Google {gid}: {e}")
                    stats["errors"] += 1

        # --- DELETE: Eventos locais com google_event_id que não existem mais no Google ---
        for gid, local_ev in local_by_gid.items():
            if gid not in google_active_ids:
                # Verificar se o evento local está dentro do range buscado
                ev_start = local_ev.get("data_inicio", "")
                if ev_start >= time_min and ev_start <= time_max:
                    db.delete_agenda(local_ev["id"])
                    stats["deleted"] += 1
                    log.info(f"Evento removido do Granola (deletado no Google): {local_ev.get('titulo')}")

        return stats
    finally:
        _sync_lock.release()
