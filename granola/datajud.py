"""
Granola — CRM Jurídico | Coletor DataJud (API Pública CNJ)
===========================================================
Caminho padrão do botão "Coleta de Publicações".

Integra-se ao schema existente — não cria tabelas novas:
  - Lê processos de `granola_processos` (numero_cnj NOT NULL)
  - Persiste em `granola_movimentacoes` com fonte='datajud_auto'
  - Dedup por hash_dedup (mesma fórmula que e-SAJ/PJe — cross-fonte)
  - Chave da API em granola_config: key='datajud_api_key'
  - Resumo da última coleta em granola_config: key='ultima_coleta_datajud_resumo'

O fluxo Selenium (e-SAJ + PJe) continua como fallback — botão "Verificação manual".

Limitação conhecida: DataJud tem defasagem de 1–2 dias.
Pra prazo crítico, rodar o fallback Selenium.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

from granola.database import get_connection
from granola.publicacoes import _hash_mov, _normalize_date, _normalize_text, append_log

log = logging.getLogger(__name__)

# ============================================================
#  Config da API
# ============================================================
DATAJUD_BASE_URL = "https://api-publica.datajud.cnj.jus.br"
DEFAULT_TIMEOUT = 30
DEFAULT_PAGE_SIZE = 100
MAX_RETRIES = 3
BACKOFF_BASE = 1.5
FONTE = "datajud_auto"


# ============================================================
#  Parse CNJ + mapa TR → alias do DataJud
# ============================================================
_CNJ_RE = re.compile(
    r"^(?P<num>\d{7})-(?P<dv>\d{2})\.(?P<ano>\d{4})\."
    r"(?P<j>\d)\.(?P<tr>\d{2})\.(?P<orgao>\d{4})$"
)

_TR_JUSTICA_ESTADUAL = {
    "01": "ac", "02": "al", "03": "ap", "04": "am", "05": "ba",
    "06": "ce", "07": "dft", "08": "es", "09": "go", "10": "ma",
    "11": "mt", "12": "ms", "13": "mg", "14": "pa", "15": "pb",
    "16": "pr", "17": "pe", "18": "pi", "19": "rj", "20": "rn",
    "21": "rs", "22": "ro", "23": "rr", "24": "sc", "25": "se",
    "26": "sp", "27": "to",
}
_TR_JUSTICA_MILITAR_ESTADUAL = {"13": "mg", "21": "rs", "26": "sp"}


@dataclass(frozen=True)
class NumeroCNJ:
    numero: str
    dv: str
    ano: int
    segmento: int
    tribunal: str
    orgao_origem: str
    formatado: str

    @property
    def tribunal_alias(self) -> str:
        j, tr = self.segmento, self.tribunal
        if j == 3:
            return "stj"
        if j == 4:
            return f"trf{int(tr)}"
        if j == 5:
            return f"trt{int(tr)}"
        if j == 6:
            uf = _TR_JUSTICA_ESTADUAL.get(tr)
            if not uf:
                raise ValueError(f"TRE desconhecido para TR={tr}")
            return f"tre-{uf}"
        if j == 7:
            return "stm"
        if j == 8:
            uf = _TR_JUSTICA_ESTADUAL.get(tr)
            if not uf:
                raise ValueError(f"TJ desconhecido para TR={tr}")
            return f"tj{uf}"
        if j == 9:
            uf = _TR_JUSTICA_MILITAR_ESTADUAL.get(tr)
            if not uf:
                raise ValueError(f"TJM não existe para TR={tr}")
            return f"tjm-{uf}"
        raise ValueError(f"Segmento CNJ não suportado pela API pública: J={j}")


def parse_cnj(numero: str) -> NumeroCNJ:
    """Valida e normaliza número CNJ. Aceita com ou sem máscara."""
    bruto = re.sub(r"\s+", "", numero or "")
    if re.fullmatch(r"\d{20}", bruto):
        bruto = f"{bruto[0:7]}-{bruto[7:9]}.{bruto[9:13]}.{bruto[13]}.{bruto[14:16]}.{bruto[16:20]}"
    m = _CNJ_RE.match(bruto)
    if not m:
        raise ValueError(f"Número CNJ inválido: {numero!r}")
    return NumeroCNJ(
        numero=m["num"],
        dv=m["dv"],
        ano=int(m["ano"]),
        segmento=int(m["j"]),
        tribunal=m["tr"],
        orgao_origem=m["orgao"],
        formatado=bruto,
    )


# ============================================================
#  Cliente HTTP (urllib stdlib — mantém portabilidade no pendrive)
# ============================================================
class DataJudError(RuntimeError):
    """Erro de comunicação com a API do DataJud."""


class DataJudClient:
    def __init__(self, api_key: str, base_url: str = DATAJUD_BASE_URL, timeout: int = DEFAULT_TIMEOUT):
        if not api_key:
            raise DataJudError(
                "API key do DataJud não configurada (granola_config.datajud_api_key)"
            )
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def buscar_por_numeros(
        self,
        tribunal_alias: str,
        numeros_cnj: Iterable[str],
        size: int = DEFAULT_PAGE_SIZE,
    ) -> list[dict]:
        """Consulta batch — múltiplos CNJs do mesmo tribunal numa request."""
        numeros = list(numeros_cnj)
        if not numeros:
            return []
        # DataJud indexa numeroProcesso SEM pontuação
        numeros_limpos = [re.sub(r"\D", "", n) for n in numeros]
        url = f"{self.base_url}/api_publica_{tribunal_alias}/_search"
        payload = {
            "size": min(size, 10000),
            "query": {"terms": {"numeroProcesso": numeros_limpos}},
            "_source": [
                "numeroProcesso", "classe", "orgaoJulgador",
                "movimentos", "dataAjuizamento", "grau",
            ],
        }
        return self._post_with_retry(url, payload)

    def _post_with_retry(self, url: str, payload: dict) -> list[dict]:
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"APIKey {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Granola/DataJudColetor (Valerius)",
        }
        last_exc: Exception | None = None
        for tentativa in range(1, MAX_RETRIES + 1):
            try:
                req = urllib.request.Request(url, data=body, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    hits = data.get("hits", {}).get("hits", [])
                    return [h["_source"] for h in hits]
            except urllib.error.HTTPError as e:
                last_exc = e
                if (e.code == 429 or e.code >= 500) and tentativa < MAX_RETRIES:
                    espera = BACKOFF_BASE ** tentativa
                    log.warning("HTTP %s tentativa %d — retry em %.1fs", e.code, tentativa, espera)
                    time.sleep(espera)
                    continue
                raise DataJudError(f"HTTP {e.code}: {e.reason}") from e
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                last_exc = e
                if tentativa < MAX_RETRIES:
                    espera = BACKOFF_BASE ** tentativa
                    log.warning("Falha DataJud (%s) — retry em %.1fs", e, espera)
                    time.sleep(espera)
                    continue
                break
        raise DataJudError(f"Esgotadas {MAX_RETRIES} tentativas: {last_exc}")


# ============================================================
#  Persistência (granola_movimentacoes)
# ============================================================
def _salvar_movimentos_datajud(
    conn,
    processo_id: int,
    numero_cnj: str,
    movimentos: list[dict],
) -> list[dict]:
    """
    Persiste movimentos novos. Dedup em 2 camadas (igual e-SAJ):
      1. hash_dedup direto
      2. (data_normalizada, descricao_normalizada) — pega hashes antigos
         gerados antes do fix de normalização.
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
    for mov in movimentos:
        data_iso = mov.get("dataHora") or ""
        if not data_iso:
            continue
        nome = (mov.get("nome") or "").strip()
        codigo = mov.get("codigo")
        compl = mov.get("complementosTabelados") or []
        compl_str = " | ".join(
            f"{c.get('nome','')}: {c.get('descricao','')}".strip(": ")
            for c in compl if c
        )
        titulo = nome or (f"Movimento CNJ {codigo}" if codigo else "Movimento")
        descricao = (nome + (" — " + compl_str if compl_str else "")).strip() or titulo

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
                (processo_id, titulo[:100], descricao, data_iso, FONTE, h, now),
            )
            novas.append({
                "processo_id": processo_id,
                "numero_cnj": numero_cnj,
                "titulo": titulo,
                "data": data_iso,
                "descricao": descricao,
                "codigo": codigo,
            })
            hashes.add(h)
            assinaturas.add(assinatura)
        except Exception as e:
            log.warning("Erro salvando movimento DataJud %s: %s", numero_cnj, e)

    if novas:
        conn.commit()
    return novas


# ============================================================
#  Coleta principal — ponto de entrada do handler do botão
# ============================================================
def _api_key_from_config(conn) -> str:
    row = conn.execute(
        "SELECT value FROM granola_config WHERE key = 'datajud_api_key'"
    ).fetchone()
    return (row["value"] if row else "") or ""


def coletar_publicacoes_datajud(callback=None, processo_ids: list[int] | None = None) -> dict:
    """
    Caminho padrão da "Coleta de Publicações".

    processo_ids: IDs específicos a consultar. Se None, pega todos os
                  processos de granola_processos com numero_cnj não-nulo.

    Retorna dict compatível com o formato do e-SAJ/PJe, pro frontend
    reusar os mesmos componentes de exibição de resultado.
    """
    inicio = datetime.now().isoformat()
    append_log("datajud", "info", "Coleta DataJud iniciada")

    resultado = {
        "total": 0,
        "elegiveis": 0,
        "tribunais": 0,
        "consultados": 0,
        "com_novidade": 0,
        "novas_movimentacoes": [],
        "nao_encontrados": [],  # [{processo_id, numero_cnj, titulo, tribunal_alias}]
        "erros": [],
        "inicio": inicio,
        "fim": None,
    }

    conn = get_connection()
    try:
        api_key = _api_key_from_config(conn)
        if not api_key:
            msg = ("API key do DataJud não configurada. "
                   "Defina granola_config.datajud_api_key (Admin > Integrações).")
            resultado["erros"].append(msg)
            append_log("datajud", "error", msg)
            return resultado

        # 1. Processos a consultar
        if processo_ids:
            placeholders = ",".join("?" for _ in processo_ids)
            rows = conn.execute(
                f"SELECT id, numero_cnj, titulo FROM granola_processos "
                f"WHERE id IN ({placeholders})",
                processo_ids,
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, numero_cnj, titulo FROM granola_processos "
                "WHERE numero_cnj IS NOT NULL AND TRIM(numero_cnj) != ''"
            ).fetchall()

        resultado["total"] = len(rows)
        if not rows:
            return resultado

        # 2. Agrupa por tribunal (descarta os não suportados pela API pública)
        por_tribunal: dict[str, list[tuple[int, str, str]]] = {}
        for r in rows:
            try:
                cnj = parse_cnj(r["numero_cnj"])
                alias = cnj.tribunal_alias
            except ValueError as e:
                resultado["erros"].append(
                    f"Processo {r['id']} ({r['numero_cnj']}): {e}"
                )
                continue
            por_tribunal.setdefault(alias, []).append(
                (r["id"], cnj.formatado, (r["titulo"] or "").strip() or "(sem título)")
            )

        resultado["elegiveis"] = sum(len(v) for v in por_tribunal.values())
        resultado["tribunais"] = len(por_tribunal)
        append_log(
            "datajud", "info",
            f"{resultado['elegiveis']}/{resultado['total']} elegíveis em "
            f"{resultado['tribunais']} tribunal(is): "
            f"{', '.join(sorted(por_tribunal.keys()))}"
        )

        # 3. Consulta batch por tribunal
        client = DataJudClient(api_key=api_key)
        for alias, items in por_tribunal.items():
            numeros_fmt = [cnj for _, cnj, _ in items]
            numero_to_meta = {cnj: (pid, titulo) for pid, cnj, titulo in items}

            try:
                fontes = client.buscar_por_numeros(alias, numeros_fmt)
            except DataJudError as e:
                msg = f"Tribunal {alias}: {e}"
                resultado["erros"].append(msg)
                append_log("datajud", "error", msg)
                continue

            encontrados_cnjs: set[str] = set()
            for fonte in fontes:
                try:
                    numero_fmt = parse_cnj(fonte.get("numeroProcesso") or "").formatado
                except ValueError:
                    continue
                meta = numero_to_meta.get(numero_fmt)
                if not meta:
                    continue
                pid, _titulo = meta
                encontrados_cnjs.add(numero_fmt)
                resultado["consultados"] += 1
                movimentos = fonte.get("movimentos") or []
                novas = _salvar_movimentos_datajud(conn, pid, numero_fmt, movimentos)
                if novas:
                    resultado["com_novidade"] += 1
                    resultado["novas_movimentacoes"].extend(novas)
                    append_log(
                        "datajud", "info",
                        f"{numero_fmt}: {len(novas)} movimento(s) novo(s)",
                        processo=numero_fmt,
                    )

            # Lista faltantes com título — ajuda a decidir quando rodar o fallback Selenium
            faltantes = [
                (pid, cnj, titulo)
                for pid, cnj, titulo in items
                if cnj not in encontrados_cnjs
            ]
            if faltantes:
                append_log(
                    "datajud", "warn",
                    f"Tribunal {alias}: {len(faltantes)} processo(s) sem retorno "
                    f"(defasagem, segredo de justiça ou CNJ não indexado):"
                )
                for pid, cnj, titulo in faltantes:
                    resultado["nao_encontrados"].append({
                        "processo_id": pid,
                        "numero_cnj": cnj,
                        "titulo": titulo,
                        "tribunal_alias": alias,
                    })
                    append_log(
                        "datajud", "warn",
                        f"  faltante: {cnj} — {titulo[:80]}",
                        processo=cnj,
                    )

        # 4. Resumo em granola_config pra UI consumir
        resumo = {
            "inicio": inicio,
            "fim": datetime.now().isoformat(),
            "total": resultado["total"],
            "elegiveis": resultado["elegiveis"],
            "consultados": resultado["consultados"],
            "com_novidade": resultado["com_novidade"],
            "novas": len(resultado["novas_movimentacoes"]),
            "nao_encontrados": resultado["nao_encontrados"],
            "erros": len(resultado["erros"]),
        }
        agora = datetime.now().isoformat()
        conn.execute(
            "INSERT OR REPLACE INTO granola_config (key, value, atualizado_em) "
            "VALUES ('ultima_coleta_datajud', ?, ?)",
            (agora, agora),
        )
        conn.execute(
            "INSERT OR REPLACE INTO granola_config (key, value, atualizado_em) "
            "VALUES ('ultima_coleta_datajud_resumo', ?, ?)",
            (json.dumps(resumo), agora),
        )
        conn.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass

    resultado["fim"] = datetime.now().isoformat()
    append_log(
        "datajud", "info",
        f"DataJud finalizado: {resultado['com_novidade']} processo(s) c/ novidade, "
        f"{len(resultado['novas_movimentacoes'])} mov. nova(s), "
        f"{len(resultado['nao_encontrados'])} sem retorno, "
        f"{len(resultado['erros'])} erro(s)"
    )
    return resultado


def get_status_coleta_datajud() -> dict:
    """Retorna resumo da última coleta DataJud pro frontend."""
    conn = get_connection()
    try:
        row_data = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_datajud'"
        ).fetchone()
        row_resumo = conn.execute(
            "SELECT value FROM granola_config WHERE key = 'ultima_coleta_datajud_resumo'"
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


_last_run_date_datajud: date | None = None
_datajud_auto_lock = threading.Lock()


def verificar_coleta_diaria_datajud() -> bool:
    """
    Dispara coleta DataJud em background se ainda não rodou hoje.
    Chamado após login bem-sucedido (primeiro login do dia).
    Retorna True se agendou coleta, False se já rodou hoje.
    """
    global _last_run_date_datajud

    hoje = date.today()

    with _datajud_auto_lock:
        if _last_run_date_datajud == hoje:
            return False

        try:
            conn = get_connection()
            row = conn.execute(
                "SELECT value FROM granola_config WHERE key = 'ultima_coleta_datajud'"
            ).fetchone()
            conn.close()
            if row and row["value"]:
                try:
                    if datetime.fromisoformat(row["value"]).date() == hoje:
                        _last_run_date_datajud = hoje
                        return False
                except ValueError:
                    pass
        except Exception as e:
            log.warning("verificar_coleta_diaria_datajud: erro lendo config: %s", e)

        _last_run_date_datajud = hoje

    def _run():
        time.sleep(3)
        try:
            log.info("Coleta DataJud automática (primeiro login do dia) iniciada")
            coletar_publicacoes_datajud()
        except Exception as e:
            log.exception("Coleta DataJud automática falhou: %s", e)
            global _last_run_date_datajud
            with _datajud_auto_lock:
                if _last_run_date_datajud == hoje:
                    _last_run_date_datajud = None

    threading.Thread(target=_run, daemon=True, name="datajud-autologin").start()
    return True
