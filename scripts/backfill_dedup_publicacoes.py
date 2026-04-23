"""
Backfill one-shot para limpar duplicatas de granola_movimentacoes.

Contexto: o hash_dedup antigo usava descricao crua ([:200]), o que fazia a
mesma publicacao com whitespace diferente (espacos vs \\n) gerar hashes
diferentes e escapar do UNIQUE. O fix em publicacoes.py normaliza o texto
e a data antes do hash, mas os registros antigos continuam com hashes
stale. Este script:

  1. Recalcula o hash normalizado de cada granola_movimentacoes
  2. Agrupa por (processo_id, assinatura_normalizada)
  3. Para cada grupo com >1 registros, mantem o MELHOR e deleta o resto.
     Melhor = tratamento mais "resolvido" (prazo > visto > ignorado > pendente)
     em caso de empate, o mais antigo (id menor) vence — preserva o tratamento
     original que o usuario ja deu
  4. Atualiza hash_dedup de todos os remanescentes para o formato novo
  5. Transfere prazos/prazo_id do registro deletado para o mantido

Idempotente — pode rodar varias vezes sem problema.
Faz backup do banco antes de mexer.
"""
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from granola.database import get_connection
from granola.publicacoes import _hash_mov, _normalize_text, _normalize_date


# Prioridade para desempatar qual registro manter em caso de duplicata
TRATAMENTO_RANK = {"prazo": 4, "visto": 3, "ignorado": 2, "pendente": 1, None: 0}


def _rank(row) -> tuple:
    """Maior rank = melhor candidato a ficar. Desempate por id menor (mais antigo)."""
    trat = row["tratamento"] or "pendente"
    return (TRATAMENTO_RANK.get(trat, 0), -row["id"])


def main():
    conn = get_connection()
    db_path = Path(conn.execute("PRAGMA database_list").fetchone()["file"])

    # Backup antes de mexer
    backup_path = db_path.with_suffix(f".db.bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    shutil.copy2(db_path, backup_path)
    print(f"Backup criado: {backup_path}")

    rows = conn.execute(
        """SELECT m.id, m.processo_id, m.data_movimento, m.descricao,
                  m.hash_dedup, m.tratamento, m.prazo_id,
                  p.numero_cnj
             FROM granola_movimentacoes m
             LEFT JOIN granola_processos p ON p.id = m.processo_id
         ORDER BY m.processo_id, m.id"""
    ).fetchall()

    print(f"Total de movimentacoes no banco: {len(rows)}")

    # Agrupa por (processo_id, assinatura normalizada)
    grupos: dict[tuple, list] = {}
    for r in rows:
        key = (
            r["processo_id"],
            _normalize_date(r["data_movimento"]),
            _normalize_text(r["descricao"]),
        )
        grupos.setdefault(key, []).append(r)

    duplicatas_grupos = [g for g in grupos.values() if len(g) > 1]
    print(f"Grupos com duplicatas: {len(duplicatas_grupos)}")
    total_a_remover = sum(len(g) - 1 for g in duplicatas_grupos)
    print(f"Registros duplicados a remover: {total_a_remover}")

    removidos = 0
    hashes_atualizados = 0
    prazos_transferidos = 0

    try:
        conn.execute("BEGIN")

        # 1. Resolve duplicatas: mantem o melhor, deleta o resto
        for grupo in duplicatas_grupos:
            grupo_ord = sorted(grupo, key=_rank, reverse=True)
            manter = grupo_ord[0]
            deletar = grupo_ord[1:]

            for d in deletar:
                # Se o registro a deletar tem prazo_id e o que fica nao, transfere
                if d["prazo_id"] and not manter["prazo_id"]:
                    conn.execute(
                        "UPDATE granola_movimentacoes SET prazo_id = ? WHERE id = ?",
                        (d["prazo_id"], manter["id"])
                    )
                    # Re-link na tabela de prazos tambem
                    conn.execute(
                        "UPDATE granola_prazos SET movimentacao_id = ? WHERE movimentacao_id = ?",
                        (manter["id"], d["id"])
                    )
                    prazos_transferidos += 1
                else:
                    # Solta qualquer FK que aponte para a mov a deletar
                    conn.execute(
                        "UPDATE granola_prazos SET movimentacao_id = NULL WHERE movimentacao_id = ?",
                        (d["id"],)
                    )

                conn.execute(
                    "DELETE FROM granola_movimentacoes WHERE id = ?",
                    (d["id"],)
                )
                removidos += 1

        # 2. Recalcula hash_dedup de TODOS os remanescentes com a formula nova
        rows_remanescentes = conn.execute(
            """SELECT m.id, m.processo_id, m.data_movimento, m.descricao, m.hash_dedup,
                      p.numero_cnj
                 FROM granola_movimentacoes m
                 LEFT JOIN granola_processos p ON p.id = m.processo_id"""
        ).fetchall()

        for r in rows_remanescentes:
            cnj = r["numero_cnj"] or str(r["processo_id"])
            novo_hash = _hash_mov(cnj, r["data_movimento"] or "", r["descricao"] or "")
            if novo_hash != r["hash_dedup"]:
                conn.execute(
                    "UPDATE granola_movimentacoes SET hash_dedup = ? WHERE id = ?",
                    (novo_hash, r["id"])
                )
                hashes_atualizados += 1

        conn.execute("COMMIT")
    except Exception as e:
        conn.execute("ROLLBACK")
        print(f"ERRO - rollback: {e}")
        raise

    print()
    print(f"Duplicatas removidas: {removidos}")
    print(f"Prazos transferidos: {prazos_transferidos}")
    print(f"Hashes atualizados: {hashes_atualizados}")
    print()

    # Verifica integridade final
    restantes = conn.execute("SELECT COUNT(*) as c FROM granola_movimentacoes").fetchone()["c"]
    print(f"Total apos backfill: {restantes}")

    # Checa duplicatas residuais
    resid = conn.execute(
        """SELECT processo_id, hash_dedup, COUNT(*) as c
             FROM granola_movimentacoes
             WHERE hash_dedup IS NOT NULL
         GROUP BY processo_id, hash_dedup
           HAVING c > 1"""
    ).fetchall()
    if resid:
        print(f"AVISO: {len(resid)} grupos ainda com hash duplicado (nao deveria)")
    else:
        print("OK - nenhuma duplicata de hash restante")

    conn.close()


if __name__ == "__main__":
    main()
