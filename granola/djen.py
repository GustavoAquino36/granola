"""
Granola — Coletor DJEN / PCP (API pública CNJ de Comunicações Processuais)
===========================================================================
Terceiro caminho de "Coleta de Publicações" — ao lado de DataJud e Tribunal.

Diferença conceitual:
  - DataJud   → movimentações processuais (despacho/decisão) via índice CNJ
  - DJEN      → INTIMAÇÕES publicadas para o advogado (Diário Eletrônico Nacional)
  - Tribunal  → Selenium no e-SAJ/PJe (fallback quando os dois acima defasam)

Estratégia OAB-first:
  Uma única request por OAB retorna TODAS as comunicações do advogado
  (ex: Enzo 372868/SP → 84 items numa call só).
  OABs vivem em granola_config key='djen_oabs' como JSON:
    [{"numero": "372868", "uf": "SP"}, {"numero": "432128", "uf": "SP"}]

Rate limit: exige ≥2s entre requests (validado 2026-04-20 — 0.15s dispara 429).
"""
from __future__ import annotations

import html
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from typing import Iterable

from granola.database import get_connection
from granola.publicacoes import _hash_mov, _normalize_date, _normalize_text, append_log

log = logging.getLogger(__name__)

# ============================================================
#  Config
# ============================================================
DJEN_BASE_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao"
DEFAULT_TIMEOUT = 30
SLEEP_ENTRE_REQS = 2.5       # ≥2s mandatório — 0.15s já disparou 429 no teste
MAX_RETRIES = 3
BACKOFF_BASE = 15            # segundos — 429 precisa de espera longa
FONTE = "djen_auto"
JANELA_DIAS_PADRAO = 60      # janela de busca quando sem data explícita

CONFIG_KEY_OABS = "djen_oabs"
CONFIG_KEY_ULTIMA = "ultima_coleta_djen"
CONFIG_KEY_RESUMO = "ultima_coleta_djen_resumo"


# ============================================================
#  Cliente HTTP
# ============================================================
class DJENError(RuntimeError):
    """Erro de comunicação com a API do DJEN/PCP."""


class DJENClient:
    def __init__(self, base_url: str = DJEN_BASE_URL, timeout: int = DEFAULT_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout

    def consultar(self, **params) -> dict:
        """Retorna dict {count, items[]} para qualquer combinação de filtros aceitos."""
        qs = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
        url = f"{self.base_url}?{qs}"
        headers = {
            "Accept": "application/json",
            "User-Agent": "Granola/DJENColetor (Valerius)",
        }
        last_exc: Exception | None = None
        for tentativa in range(1, MAX_RETRIES + 1):
            try:
                req = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8", "replace"))
                    return {
                        "count": int(data.get("count") or 0),
                        "items": data.get("items") or [],
                    }
            except urllib.error.HTTPError as e:
                last_exc = e
                if e.code == 429 and tentativa < MAX_RETRIES:
                    espera = BACKOFF_BASE * tentativa
                    log.warning("DJEN 429 tentativa %d — retry em %ds", tentativa, espera)
                    time.sleep(espera)
                    continue
                if e.code >= 500 and tentativa < MAX_RETRIES:
                    time.sleep(BACKOFF_BASE)
                    continue
                raise DJENError(f"HTTP {e.code}: {e.reason}") from e
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                last_exc = e
                if tentativa < MAX_RETRIES:
                    time.sleep(BACKOFF_BASE / 3)
                    continue
                break
        raise DJENError(f"Esgotadas {MAX_RETRIES} tentativas: {last_exc}")


# ============================================================
#  Normalização de CNJ (casar com granola_processos)
# ============================================================
_CNJ_SEM_MASCARA = re.compile(r"^\d{20}$")


def _formatar_cnj(bruto: str) -> str:
    """Converte 00007712620238260663 → 0000771-26.2023.8.26.0663. Idempotente."""
    s = re.sub(r"\s+", "", bruto or "")
    if _CNJ_SEM_MASCARA.match(s):
        return f"{s[0:7]}-{s[7:9]}.{s[9:13]}.{s[13]}.{s[14:16]}.{s[16:20]}"
    return s


# ============================================================
#  Sanitização do texto HTML da intimação
# ============================================================
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _texto_limpo(html_bruto: str, limite: int = 600) -> str:
    """Remove HTML/tags/entidades e colapsa whitespace. Truncado em `limite`."""
    if not html_bruto:
        return ""
    sem_tags = _TAG_RE.sub(" ", html_bruto)
    desentidade = html.unescape(sem_tags)
    limpo = _WS_RE.sub(" ", desentidade).strip()
    if len(limpo) > limite:
        limpo = limpo[:limite].rstrip() + "…"
    return limpo


# ============================================================
#  Persistência — reusa granola_movimentacoes
# ============================================================
def _salvar_comunicacoes_djen(
    conn,
    processo_id: int,
    numero_cnj: str,
    items: list[dict],
) -> list[dict]:
    """
    Persiste comunicações novas em granola_movimentacoes.
    Dedup em 2 camadas (igual datajud/esaj): hash_dedup + (data, texto_normalizado).

    Hash usa (numero_cnj, data_disponibilizacao, descricao) — mesma fórmula,
    então dedup é cross-fonte: se o DataJud já gravou o mesmo "dia x texto",
    a entrada DJEN é suprimida. Na prática, DJEN e DataJud cobrem facetas
    diferentes — DataJud traz "Ato Ordinatório Praticado", DJEN traz a
    intimação textual — mas se o tribunal duplicar, a gente não duplica.
    """
    now = datetime.now().isoformat()
    existentes = conn.execute(
        "SELECT data_movimento, descricao, hash_dedup "
        "FROM granola_movimentacoes WHERE processo_id = ?",
        (processo_id,),
    ).fetchall()
    assinaturas = {
        (_normalize_date(e["data_movimento"]), _normalize_text(e["descricao"]))
        for e in existentes
    }
    hashes = {e["hash_dedup"] for e in existentes if e["hash_dedup"]}

    novas: list[dict] = []
    for it in items:
        data_iso = (it.get("data_disponibilizacao") or "").strip()
        if not data_iso:
            continue
        tipo_comunicacao = (it.get("tipoComunicacao") or "Intimação").strip()
        tipo_documento = (it.get("tipoDocumento") or "").strip()
        sigla = (it.get("siglaTribunal") or "").strip()
        orgao = (it.get("nomeOrgao") or "").strip()
        texto = _texto_limpo(it.get("texto") or "")

        # Título exibido no card de movimentação
        titulo_partes = [tipo_comunicacao]
        if tipo_documento:
            titulo_partes.append(tipo_documento)
        if sigla:
            titulo_partes.append(sigla)
        titulo = " — ".join(titulo_partes)[:100]

        # Descrição persistida — contexto + texto da intimação
        descricao_partes = []
        if orgao:
            descricao_partes.append(orgao)
        if texto:
            descricao_partes.append(texto)
        descricao = " | ".join(descricao_partes) or titulo

        h = _hash_mov(numero_cnj, data_iso, descricao)
        if h in hashes:
            continue
        assinatura = (_normalize_date(data_iso), _normalize_text(descricao))
        if assinatura in assinaturas:
            continue

        try:
            conn.execute(
                "INSERT INTO granola_movimentacoes "
                "(processo_id, tipo, descricao, data_movimento, fonte, hash_dedup, criado_em) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (processo_id, titulo, descricao, data_iso, FONTE, h, now),
            )
            novas.append({
                "processo_id": processo_id,
                "numero_cnj": numero_cnj,
                "titulo": titulo,
                "data": data_iso,
                "descricao": descricao[:200],
                "hash_djen": it.get("hash"),
                "link": it.get("link"),
            })
            hashes.add(h)
            assinaturas.add(assinatura)
        except Exception as e:
            log.warning("Erro salvando comunicação DJEN %s: %s", numero_cnj, e)

    if novas:
        conn.commit()
    return novas


# ============================================================
#  Config: lê OABs do granola_config
# ============================================================
def _oabs_from_config(conn) -> list[dict]:
    row = conn.execute(
        "SELECT value FROM granola_config WHERE key = ?", (CONFIG_KEY_OABS,)
    ).fetchone()
    if not row or not row["value"]:
        return []
    try:
        data = json.loads(row["value"])
        if isinstance(data, list):
            return [
                {"numero": str(o.get("numero", "")).strip(),
                 "uf": str(o.get("uf", "")).strip().upper()}
                for o in data
                if o.get("numero") and o.get("uf")
            ]
    except json.JSONDecodeError:
        log.warning("granola_config.djen_oabs não é JSON válido")
    return []


def _processos_map(conn) -> dict[str, tuple[int, str]]:
    """Map numero_cnj (com máscara) → (processo_id, titulo)."""
    rows = conn.execute(
        "SELECT id, numero_cnj, titulo FROM granola_processos "
        "WHERE numero_cnj IS NOT NULL AND TRIM(numero_cnj) != ''"
    ).fetchall()
    out: dict[str, tuple[int, str]] = {}
    for r in rows:
        cnj = _formatar_cnj(r["numero_cnj"])
        out[cnj] = (r["id"], (r["titulo"] or "").strip() or "(sem título)")
    return out


# ============================================================
#  Coleta principal
# ============================================================
def coletar_publicacoes_djen(
    callback=None,
    processo_ids: list[int] | None = None,
    dias_janela: int = JANELA_DIAS_PADRAO,
) -> dict:
    """
    Coleta DJEN — ponto de entrada do botão (método "DJEN").

    Modo OAB-first (default): se há OABs configuradas em granola_config.djen_oabs,
    consulta por cada OAB e cruza com granola_processos. Em 1 call por OAB.

    Fallback: se não há OABs configuradas, itera CNJ a CNJ (como no probe).

    processo_ids: restringe a mapa de processos — só casa comunicações cujo
                  numero_processo corresponda a esses IDs.
    """
    inicio = datetime.now().isoformat()
    append_log("djen", "info", "Coleta DJEN iniciada")

    resultado = {
        "total": 0,
        "elegiveis": 0,
        "oabs_consultadas": 0,
        "consultados": 0,
        "com_novidade": 0,
        "novas_movimentacoes": [],
        "nao_encontrados": [],
        "erros": [],
        "inicio": inicio,
        "fim": None,
        "modo": None,
    }

    conn = get_connection()
    try:
        processos_map = _processos_map(conn)
        if processo_ids:
            allow = set(processo_ids)
            processos_map = {cnj: (pid, t) for cnj, (pid, t) in processos_map.items() if pid in allow}

        resultado["total"] = len(processos_map)
        if not processos_map:
            msg = "Nenhum processo com CNJ válido em granola_processos"
            resultado["erros"].append(msg)
            append_log("djen", "warn", msg)
            return resultado
        resultado["elegiveis"] = len(processos_map)

        client = DJENClient()
        oabs = _oabs_from_config(conn)
        hoje = date.today()
        ini = (hoje - timedelta(days=dias_janela)).isoformat()
        fim = hoje.isoformat()

        comunicacoes_por_cnj: dict[str, list[dict]] = {}

        if oabs:
            resultado["modo"] = "oab"
            resultado["oabs_consultadas"] = len(oabs)
            append_log(
                "djen", "info",
                f"Modo OAB-first: {len(oabs)} OAB(s), janela {ini}..{fim}"
            )
            for i, oab in enumerate(oabs):
                if i > 0:
                    time.sleep(SLEEP_ENTRE_REQS)
                try:
                    data = client.consultar(
                        numeroOab=oab["numero"],
                        ufOab=oab["uf"],
                        dataDisponibilizacaoInicio=ini,
                        dataDisponibilizacaoFim=fim,
                    )
                except DJENError as e:
                    msg = f"OAB {oab['numero']}/{oab['uf']}: {e}"
                    resultado["erros"].append(msg)
                    append_log("djen", "error", msg)
                    continue
                append_log(
                    "djen", "info",
                    f"OAB {oab['numero']}/{oab['uf']}: {data['count']} comunicação(ões)"
                )
                for it in data["items"]:
                    cnj_fmt = _formatar_cnj(it.get("numeroprocessocommascara") or it.get("numero_processo") or "")
                    if cnj_fmt in processos_map:
                        comunicacoes_por_cnj.setdefault(cnj_fmt, []).append(it)
        else:
            # Fallback: sem OABs configuradas, varre CNJ a CNJ
            resultado["modo"] = "cnj"
            append_log(
                "djen", "warn",
                "Sem OABs em granola_config.djen_oabs — usando fallback CNJ a CNJ "
                f"({len(processos_map)} consultas com {SLEEP_ENTRE_REQS}s entre cada)"
            )
            for i, (cnj, (_pid, _t)) in enumerate(processos_map.items(), 1):
                if i > 1:
                    time.sleep(SLEEP_ENTRE_REQS)
                try:
                    data = client.consultar(numeroProcesso=cnj)
                except DJENError as e:
                    resultado["erros"].append(f"{cnj}: {e}")
                    append_log("djen", "error", f"{cnj}: {e}", processo=cnj)
                    continue
                if data["items"]:
                    comunicacoes_por_cnj[cnj] = data["items"]

        # Persistir
        for cnj, items in comunicacoes_por_cnj.items():
            pid, titulo = processos_map[cnj]
            resultado["consultados"] += 1
            novas = _salvar_comunicacoes_djen(conn, pid, cnj, items)
            if novas:
                resultado["com_novidade"] += 1
                resultado["novas_movimentacoes"].extend(novas)
                append_log(
                    "djen", "info",
                    f"{cnj}: {len(novas)}/{len(items)} comunicação(ões) nova(s)",
                    processo=cnj,
                )

        # Faltantes = processos do escritório que não apareceram no retorno
        for cnj, (pid, titulo) in processos_map.items():
            if cnj not in comunicacoes_por_cnj:
                resultado["nao_encontrados"].append({
                    "processo_id": pid,
                    "numero_cnj": cnj,
                    "titulo": titulo,
                })

        # Resumo em granola_config
        resumo = {
            "inicio": inicio,
            "fim": datetime.now().isoformat(),
            "total": resultado["total"],
            "elegiveis": resultado["elegiveis"],
            "oabs_consultadas": resultado["oabs_consultadas"],
            "consultados": resultado["consultados"],
            "com_novidade": resultado["com_novidade"],
            "novas": len(resultado["novas_movimentacoes"]),
            "nao_encontrados": len(resultado["nao_encontrados"]),
            "erros": len(resultado["erros"]),
            "modo": resultado["modo"],
        }
        agora = datetime.now().isoformat()
        conn.execute(
            "INSERT OR REPLACE INTO granola_config (key, value, atualizado_em) VALUES (?, ?, ?)",
            (CONFIG_KEY_ULTIMA, agora, agora),
        )
        conn.execute(
            "INSERT OR REPLACE INTO granola_config (key, value, atualizado_em) VALUES (?, ?, ?)",
            (CONFIG_KEY_RESUMO, json.dumps(resumo), agora),
        )
        conn.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass

    resultado["fim"] = datetime.now().isoformat()
    append_log(
        "djen", "info",
        f"DJEN finalizado: {resultado['com_novidade']} processo(s) c/ novidade, "
        f"{len(resultado['novas_movimentacoes'])} comunicação(ões) nova(s), "
        f"{len(resultado['erros'])} erro(s)"
    )
    return resultado


def get_status_coleta_djen() -> dict:
    """Retorna resumo da última coleta DJEN pro frontend."""
    conn = get_connection()
    try:
        row_data = conn.execute(
            "SELECT value FROM granola_config WHERE key = ?", (CONFIG_KEY_ULTIMA,)
        ).fetchone()
        row_resumo = conn.execute(
            "SELECT value FROM granola_config WHERE key = ?", (CONFIG_KEY_RESUMO,)
        ).fetchone()
        ultima = row_data["value"] if row_data else None
        resumo = None
        if row_resumo and row_resumo["value"]:
            try:
                resumo = json.loads(row_resumo["value"])
            except json.JSONDecodeError:
                resumo = None
        return {"ultima_coleta": ultima, "resumo": resumo}
    finally:
        conn.close()


# ============================================================
#  Util admin — listar/configurar OABs
# ============================================================
def set_oabs(oabs: list[dict]) -> None:
    """Sobrescreve granola_config.djen_oabs. Formato: [{numero,uf}, ...]"""
    limpos = [
        {"numero": str(o.get("numero", "")).strip(),
         "uf": str(o.get("uf", "")).strip().upper()}
        for o in oabs
        if o.get("numero") and o.get("uf")
    ]
    agora = datetime.now().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO granola_config (key, value, atualizado_em) VALUES (?, ?, ?)",
            (CONFIG_KEY_OABS, json.dumps(limpos), agora),
        )
        conn.commit()
    finally:
        conn.close()


def get_oabs() -> list[dict]:
    conn = get_connection()
    try:
        return _oabs_from_config(conn)
    finally:
        conn.close()
