"""
Utilitário one-shot para corrigir processos já importados:
  1. Normaliza numero_cnj ao formato canônico 0000000-00.0000.0.00.0000
  2. Cria granola_partes para autor/cliente e parte_contraria se faltarem
Idempotente — pode rodar várias vezes.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from granola.database import GranolaDB, init_db, _format_cnj


def main():
    init_db()
    db = GranolaDB()

    rows = db.conn.execute(
        "SELECT id, numero_cnj, cliente_id, parte_contraria, polo FROM granola_processos"
    ).fetchall()

    cnj_fixes = 0
    partes_adicionadas = 0

    for p in rows:
        pid = p["id"]
        updates = {}

        # 1) Normaliza CNJ
        if p["numero_cnj"]:
            novo = _format_cnj(p["numero_cnj"])
            if novo and novo != p["numero_cnj"]:
                updates["numero_cnj"] = novo
                cnj_fixes += 1

        if updates:
            sets = ", ".join(f"{k} = ?" for k in updates)
            db.conn.execute(
                f"UPDATE granola_processos SET {sets} WHERE id = ?",
                list(updates.values()) + [pid]
            )

        # 2) Verifica se já existem partes; cria as que faltam
        partes_existentes = db.conn.execute(
            "SELECT nome FROM granola_partes WHERE processo_id = ?", (pid,)
        ).fetchall()
        nomes_existentes = {(r["nome"] or "").strip().lower() for r in partes_existentes}

        polo_cliente = (p["polo"] or "ativo").lower()
        polo_contrario = "passivo" if polo_cliente == "ativo" else "ativo"

        # Cliente como parte
        if p["cliente_id"]:
            cli = db.conn.execute(
                "SELECT nome FROM granola_clientes WHERE id = ?", (p["cliente_id"],)
            ).fetchone()
            if cli and cli["nome"] and cli["nome"].strip().lower() not in nomes_existentes:
                db.upsert_parte({
                    "processo_id": pid,
                    "nome": cli["nome"],
                    "tipo": "autor" if polo_cliente == "ativo" else "reu",
                    "polo": polo_cliente,
                })
                partes_adicionadas += 1

        # Parte contrária como parte
        if p["parte_contraria"] and p["parte_contraria"].strip().lower() not in nomes_existentes:
            db.upsert_parte({
                "processo_id": pid,
                "nome": p["parte_contraria"],
                "tipo": "reu" if polo_cliente == "ativo" else "autor",
                "polo": polo_contrario,
            })
            partes_adicionadas += 1

    db.conn.commit()
    print(f"CNJs normalizados: {cnj_fixes}")
    print(f"Partes adicionadas: {partes_adicionadas}")
    print(f"Total de processos verificados: {len(rows)}")


if __name__ == "__main__":
    main()
