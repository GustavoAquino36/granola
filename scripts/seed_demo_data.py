"""
Seed de dados demo pro Granola CRM.

Popula um DB recem-criado com:
  - 3 clientes (2 PF + 1 PJ)
  - 5 processos (trabalhista, civel, consumidor, empresarial)
  - 8 movimentacoes (fonte='manual')
  - 4 prazos (mix vencidos, proximos, futuros)
  - 6 lancamentos financeiros (receitas + despesas)
  - 2 eventos de agenda

Idempotente: se ja rodou antes, detecta pelos CPFs conhecidos e sai sem
duplicar. CPFs/CNPJs sao validos em FORMATO (so digitos) mas fictícios,
sem checksum real — nenhum pertence a pessoa real.

Uso:
    cd granola-repo
    .venv\\Scripts\\activate   # (Windows)
    python scripts/seed_demo_data.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

# Permite rodar o script da raiz do repo
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from granola.database import GranolaDB, init_db  # noqa: E402


# ---------- CPFs/CNPJs ficticios (marcadores do seed) ----------
CPF_MARIA = "11122233344"
CPF_JOAO = "55566677788"
CNPJ_TECH = "11222333000155"

# ---------- Helpers de data ----------
NOW = datetime.now()
def iso(dt: datetime) -> str:
    return dt.isoformat()

def days_from_now(n: int) -> str:
    return (NOW + timedelta(days=n)).date().isoformat()


def already_seeded(db: GranolaDB) -> bool:
    row = db.conn.execute(
        "SELECT id FROM granola_clientes WHERE cpf_cnpj = ?", (CPF_MARIA,)
    ).fetchone()
    return row is not None


def seed_clientes(db: GranolaDB) -> dict:
    maria = db.upsert_cliente({
        "tipo": "PF",
        "nome": "Maria Silva de Oliveira",
        "cpf_cnpj": CPF_MARIA,
        "rg": "12.345.678-9",
        "email": "maria.oliveira@exemplo.com",
        "telefone": "(11) 98765-4321",
        "endereco_logradouro": "Rua das Flores",
        "endereco_numero": "123",
        "endereco_bairro": "Pinheiros",
        "endereco_cidade": "Sao Paulo",
        "endereco_uf": "SP",
        "endereco_cep": "05422-000",
        "data_nascimento": "1985-03-14",
        "profissao": "Professora",
        "estado_civil": "casada",
        "nacionalidade": "brasileira",
        "observacao": "Cliente desde 2024. Preferencia de contato por WhatsApp.",
        "ativo": 1,
        "criado_em": iso(NOW - timedelta(days=120)),
    })

    joao = db.upsert_cliente({
        "tipo": "PF",
        "nome": "Joao Pereira Santos",
        "cpf_cnpj": CPF_JOAO,
        "rg": "98.765.432-1",
        "email": "joao.santos@exemplo.com",
        "telefone": "(11) 94444-5555",
        "endereco_logradouro": "Av. Paulista",
        "endereco_numero": "1578",
        "endereco_complemento": "apto 82",
        "endereco_bairro": "Bela Vista",
        "endereco_cidade": "Sao Paulo",
        "endereco_uf": "SP",
        "endereco_cep": "01310-200",
        "data_nascimento": "1978-09-22",
        "profissao": "Engenheiro civil",
        "estado_civil": "divorciado",
        "nacionalidade": "brasileira",
        "ativo": 1,
        "criado_em": iso(NOW - timedelta(days=75)),
    })

    tech = db.upsert_cliente({
        "tipo": "PJ",
        "nome": "Tech Solutions Servicos Ltda",
        "cpf_cnpj": CNPJ_TECH,
        "email": "juridico@techsolutions.exemplo.com",
        "telefone": "(11) 3333-4444",
        "endereco_logradouro": "Rua Funchal",
        "endereco_numero": "500",
        "endereco_complemento": "conjunto 1501",
        "endereco_bairro": "Vila Olimpia",
        "endereco_cidade": "Sao Paulo",
        "endereco_uf": "SP",
        "endereco_cep": "04551-060",
        "observacao": "Contrato de assessoria fechado em jan/2026. Renovacao anual.",
        "ativo": 1,
        "criado_em": iso(NOW - timedelta(days=110)),
    })

    return {"maria": maria, "joao": joao, "tech": tech}


def seed_processos(db: GranolaDB, clientes: dict) -> dict:
    # Maria × Banco — Consumidor, em_andamento
    maria_banco = db.upsert_processo({
        "cliente_id": clientes["maria"],
        "numero_cnj": "1023456-78.2025.8.26.0100",
        "numero_interno": "GR-2025-001",
        "titulo": "Maria Oliveira vs. Banco Fictício S.A.",
        "tipo": "civel",
        "area": "consumidor",
        "rito": "comum",
        "classe": "Procedimento Comum",
        "comarca": "Sao Paulo",
        "vara": "3a Vara Civel Central",
        "tribunal": "TJSP",
        "juiz": "Dra. Helena Campos",
        "valor_causa": 42000.00,
        "polo": "ativo",
        "parte_contraria": "Banco Fictício S.A.",
        "cpf_cnpj_contraria": "00000000000191",
        "status": "em_andamento",
        "fase": "conhecimento",
        "kanban_coluna": "andamento",
        "data_distribuicao": (NOW - timedelta(days=95)).date().isoformat(),
        "observacao": "Cobranca indevida apos encerramento de conta.",
        "criado_em": iso(NOW - timedelta(days=100)),
    })

    # Maria × Vizinho — Civel, com pendencia
    maria_vizinho = db.upsert_processo({
        "cliente_id": clientes["maria"],
        "numero_cnj": "2034567-89.2025.8.26.0003",
        "titulo": "Maria Oliveira vs. Condominio Jardim",
        "tipo": "civel",
        "area": "civel",
        "comarca": "Sao Paulo",
        "vara": "1a Vara Civel",
        "tribunal": "TJSP",
        "valor_causa": 12500.00,
        "polo": "ativo",
        "parte_contraria": "Condominio Jardim das Flores",
        "status": "em_andamento",
        "fase": "conhecimento",
        "kanban_coluna": "prazo",
        "data_distribuicao": (NOW - timedelta(days=40)).date().isoformat(),
        "criado_em": iso(NOW - timedelta(days=45)),
    })

    # Joao × Empregador — Trabalhista
    joao_trabalho = db.upsert_processo({
        "cliente_id": clientes["joao"],
        "numero_cnj": "1001234-56.2025.5.02.0012",
        "titulo": "Joao Santos vs. Construtora Exemplo Ltda",
        "tipo": "trabalhista",
        "area": "trabalhista",
        "rito": "sumarissimo",
        "classe": "Reclamacao Trabalhista",
        "comarca": "Sao Paulo",
        "vara": "12a Vara do Trabalho",
        "tribunal": "TRT2",
        "juiz": "Dr. Ricardo Mendonca",
        "valor_causa": 85000.00,
        "valor_condenacao": 0.0,
        "polo": "ativo",
        "parte_contraria": "Construtora Exemplo Ltda",
        "cpf_cnpj_contraria": "22333444000166",
        "status": "em_andamento",
        "fase": "instrucao",
        "kanban_coluna": "andamento",
        "data_distribuicao": (NOW - timedelta(days=70)).date().isoformat(),
        "observacao": "Horas extras + verbas rescisorias + dano moral.",
        "criado_em": iso(NOW - timedelta(days=72)),
    })

    # Tech × Fornecedor — Empresarial
    tech_fornecedor = db.upsert_processo({
        "cliente_id": clientes["tech"],
        "numero_cnj": "3045678-90.2025.8.26.0100",
        "numero_interno": "GR-2025-014",
        "titulo": "Tech Solutions vs. InfraCo Materiais Ltda",
        "tipo": "civel",
        "area": "empresarial",
        "comarca": "Sao Paulo",
        "vara": "2a Vara Empresarial",
        "tribunal": "TJSP",
        "valor_causa": 180000.00,
        "polo": "ativo",
        "parte_contraria": "InfraCo Materiais Ltda",
        "cpf_cnpj_contraria": "33444555000177",
        "status": "em_andamento",
        "fase": "conhecimento",
        "kanban_coluna": "novo",
        "data_distribuicao": (NOW - timedelta(days=15)).date().isoformat(),
        "observacao": "Descumprimento contratual — entrega fora do prazo.",
        "criado_em": iso(NOW - timedelta(days=18)),
    })

    # Tech × Ex-funcionario — Trabalhista (polo passivo)
    tech_exfunc = db.upsert_processo({
        "cliente_id": clientes["tech"],
        "numero_cnj": "1002345-67.2024.5.02.0034",
        "titulo": "Carlos F. vs. Tech Solutions",
        "tipo": "trabalhista",
        "area": "trabalhista",
        "comarca": "Sao Paulo",
        "vara": "34a Vara do Trabalho",
        "tribunal": "TRT2",
        "valor_causa": 38000.00,
        "polo": "passivo",
        "parte_contraria": "Carlos Fernandes (ex-empregado)",
        "advogado_contrario": "Ana Torres",
        "oab_contrario": "SP/234567",
        "status": "encerrado",
        "fase": "execucao",
        "kanban_coluna": "encerrado",
        "data_distribuicao": (NOW - timedelta(days=320)).date().isoformat(),
        "data_encerramento": (NOW - timedelta(days=20)).date().isoformat(),
        "observacao": "Acordo homologado. Pagamento em 6 parcelas.",
        "criado_em": iso(NOW - timedelta(days=325)),
    })

    return {
        "maria_banco": maria_banco,
        "maria_vizinho": maria_vizinho,
        "joao_trabalho": joao_trabalho,
        "tech_fornecedor": tech_fornecedor,
        "tech_exfunc": tech_exfunc,
    }


def seed_movimentacoes(db: GranolaDB, processos: dict):
    lanc = [
        # Maria × Banco
        (processos["maria_banco"], -95, "Distribuicao",
         "Distribuicao do processo pela 3a Vara Civel Central."),
        (processos["maria_banco"], -60, "Decisao interlocutoria",
         "Deferida a tutela de urgencia para suspender cobrancas. Prazo pra manifestacao: 15 dias.", 1),
        (processos["maria_banco"], -20, "Publicacao",
         "Juntada da contestacao do reu. Prazo de replica: 15 dias.", 1),

        # Maria × Vizinho
        (processos["maria_vizinho"], -40, "Distribuicao",
         "Distribuicao — acao de obrigacao de fazer (reparos em area comum)."),
        (processos["maria_vizinho"], -8, "Despacho",
         "Determinada pericia de engenharia. Indicacao de assistente tecnico em 10 dias.", 1),

        # Joao × Empregador
        (processos["joao_trabalho"], -70, "Distribuicao",
         "Reclamacao trabalhista distribuida pela 12a Vara."),
        (processos["joao_trabalho"], -3, "Audiencia",
         "Audiencia de instrucao designada para 30 dias. Oitiva de 2 testemunhas do autor.", 1),

        # Tech × Fornecedor
        (processos["tech_fornecedor"], -15, "Distribuicao",
         "Acao de rescisao contratual c/c perdas e danos."),
    ]

    for entry in lanc:
        proc_id, delta_days, tipo, desc = entry[:4]
        gera_prazo = entry[4] if len(entry) > 4 else 0
        data_mov = (NOW + timedelta(days=delta_days)).date().isoformat()
        db.criar_movimentacao({
            "processo_id": proc_id,
            "tipo": tipo,
            "descricao": desc,
            "data_movimento": data_mov,
            "fonte": "manual",
            "gera_prazo": gera_prazo,
            "criado_em": iso(NOW + timedelta(days=delta_days)),
        })


def seed_prazos(db: GranolaDB, processos: dict, clientes: dict):
    db.upsert_prazo({
        "processo_id": processos["maria_banco"],
        "cliente_id": clientes["maria"],
        "titulo": "Replica a contestacao",
        "descricao": "Apresentar replica. Focar nas preliminares de ilegitimidade.",
        "data_inicio": days_from_now(-5),
        "data_vencimento": days_from_now(10),
        "tipo": "manifestacao",
        "status": "pendente",
        "prioridade": "alta",
        "alerta_dias": 3,
        "responsavel": "Dr. Claudio",
        "criado_em": iso(NOW - timedelta(days=5)),
    })
    db.upsert_prazo({
        "processo_id": processos["maria_vizinho"],
        "cliente_id": clientes["maria"],
        "titulo": "Indicar assistente tecnico pericial",
        "data_inicio": days_from_now(-2),
        "data_vencimento": days_from_now(8),
        "tipo": "pericia",
        "status": "pendente",
        "prioridade": "media",
        "alerta_dias": 3,
        "responsavel": "Dr. Claudio",
        "criado_em": iso(NOW - timedelta(days=2)),
    })
    db.upsert_prazo({
        "processo_id": processos["joao_trabalho"],
        "cliente_id": clientes["joao"],
        "titulo": "Preparar audiencia de instrucao",
        "descricao": "Reuniao com cliente + alinhamento de testemunhas.",
        "data_inicio": days_from_now(0),
        "data_vencimento": days_from_now(25),
        "tipo": "audiencia",
        "status": "pendente",
        "prioridade": "alta",
        "alerta_dias": 7,
        "responsavel": "Dr. Claudio",
        "criado_em": iso(NOW),
    })
    # Um prazo vencido (realce visual da UI)
    db.upsert_prazo({
        "processo_id": processos["maria_banco"],
        "cliente_id": clientes["maria"],
        "titulo": "Juntada de documentos complementares",
        "data_inicio": days_from_now(-40),
        "data_vencimento": days_from_now(-7),
        "tipo": "documentacao",
        "status": "pendente",
        "prioridade": "media",
        "alerta_dias": 3,
        "responsavel": "Dr. Claudio",
        "criado_em": iso(NOW - timedelta(days=40)),
    })


def seed_financeiro(db: GranolaDB, processos: dict, clientes: dict):
    lanc = [
        # Receitas — honorarios
        {
            "cliente_id": clientes["maria"],
            "processo_id": processos["maria_banco"],
            "tipo": "honorario",
            "categoria": "contratual",
            "descricao": "Honorario contratual — 1a parcela",
            "valor": 2500.00,
            "data_vencimento": days_from_now(-60),
            "data_pagamento": days_from_now(-58),
            "status": "pago",
            "forma_pagamento": "pix",
            "criado_em": iso(NOW - timedelta(days=60)),
        },
        {
            "cliente_id": clientes["joao"],
            "processo_id": processos["joao_trabalho"],
            "tipo": "honorario",
            "categoria": "contratual",
            "descricao": "Honorario contratual — entrada (30%)",
            "valor": 4500.00,
            "data_vencimento": days_from_now(-40),
            "data_pagamento": days_from_now(-39),
            "status": "pago",
            "forma_pagamento": "pix",
            "criado_em": iso(NOW - timedelta(days=40)),
        },
        {
            "cliente_id": clientes["tech"],
            "processo_id": None,
            "tipo": "honorario",
            "categoria": "assessoria",
            "descricao": "Mensalidade assessoria juridica — Abril/2026",
            "valor": 3800.00,
            "data_vencimento": days_from_now(5),
            "status": "pendente",
            "fixo": 1,
            "meses_contrato": 12,
            "criado_em": iso(NOW - timedelta(days=3)),
        },
        # Despesas
        {
            "cliente_id": clientes["maria"],
            "processo_id": processos["maria_banco"],
            "tipo": "custa_judicial",
            "categoria": "custas",
            "descricao": "Custas iniciais — distribuicao",
            "valor": 420.50,
            "data_vencimento": days_from_now(-94),
            "data_pagamento": days_from_now(-94),
            "status": "pago",
            "forma_pagamento": "boleto",
            "criado_em": iso(NOW - timedelta(days=94)),
        },
        {
            "cliente_id": clientes["joao"],
            "processo_id": processos["joao_trabalho"],
            "tipo": "despesa",
            "categoria": "deslocamento",
            "descricao": "Deslocamento para vara trabalhista — audiencia",
            "valor": 65.00,
            "data_vencimento": days_from_now(-10),
            "data_pagamento": days_from_now(-10),
            "status": "pago",
            "forma_pagamento": "cartao",
            "socio": "Dr. Claudio",
            "cartao_corporativo": 1,
            "criado_em": iso(NOW - timedelta(days=10)),
        },
        {
            "cliente_id": clientes["tech"],
            "processo_id": processos["tech_fornecedor"],
            "tipo": "custa_judicial",
            "categoria": "custas",
            "descricao": "Custas — acao empresarial",
            "valor": 1840.00,
            "data_vencimento": days_from_now(-14),
            "data_pagamento": days_from_now(-14),
            "status": "pago",
            "forma_pagamento": "pix",
            "criado_em": iso(NOW - timedelta(days=14)),
        },
    ]
    for entry in lanc:
        db.upsert_financeiro(entry)


def seed_agenda(db: GranolaDB, processos: dict, clientes: dict):
    # Audiencia futura
    db.upsert_agenda({
        "processo_id": processos["joao_trabalho"],
        "cliente_id": clientes["joao"],
        "titulo": "Audiencia de instrucao — Joao vs. Construtora",
        "descricao": "12a Vara do Trabalho. Oitiva de 2 testemunhas do autor. Chegar 20min antes.",
        "data_inicio": (NOW + timedelta(days=25, hours=9)).isoformat(timespec="minutes"),
        "data_fim": (NOW + timedelta(days=25, hours=11)).isoformat(timespec="minutes"),
        "tipo": "audiencia",
        "local": "Forum Trabalhista Zona Sul — Av. Marques de Sao Vicente, 121",
        "status": "confirmado",
        "criado_em": iso(NOW),
    })
    # Reuniao com cliente
    db.upsert_agenda({
        "processo_id": None,
        "cliente_id": clientes["tech"],
        "titulo": "Reuniao trimestral — Tech Solutions",
        "descricao": "Review do andamento dos processos + renovacao do contrato de assessoria.",
        "data_inicio": (NOW + timedelta(days=7, hours=14, minutes=30)).isoformat(timespec="minutes"),
        "data_fim": (NOW + timedelta(days=7, hours=16)).isoformat(timespec="minutes"),
        "tipo": "reuniao",
        "local": "Online — Google Meet",
        "status": "confirmado",
        "criado_em": iso(NOW),
    })


def main():
    init_db()
    db = GranolaDB()

    if already_seeded(db):
        print("[seed_demo_data] Ja tem dados demo (cliente Maria existe). Abortando.")
        return 0

    print("[seed_demo_data] Inserindo clientes...")
    clientes = seed_clientes(db)
    print(f"  -> clientes IDs: {clientes}")

    print("[seed_demo_data] Inserindo processos...")
    processos = seed_processos(db, clientes)
    print(f"  -> processos IDs: {processos}")

    print("[seed_demo_data] Inserindo movimentacoes...")
    seed_movimentacoes(db, processos)

    print("[seed_demo_data] Inserindo prazos...")
    seed_prazos(db, processos, clientes)

    print("[seed_demo_data] Inserindo lancamentos financeiros...")
    seed_financeiro(db, processos, clientes)

    print("[seed_demo_data] Inserindo eventos de agenda...")
    seed_agenda(db, processos, clientes)

    totals = {
        "clientes": db.conn.execute("SELECT COUNT(*) FROM granola_clientes").fetchone()[0],
        "processos": db.conn.execute("SELECT COUNT(*) FROM granola_processos").fetchone()[0],
        "movimentacoes": db.conn.execute("SELECT COUNT(*) FROM granola_movimentacoes").fetchone()[0],
        "prazos": db.conn.execute("SELECT COUNT(*) FROM granola_prazos").fetchone()[0],
        "financeiro": db.conn.execute("SELECT COUNT(*) FROM granola_financeiro").fetchone()[0],
        "agenda": db.conn.execute("SELECT COUNT(*) FROM granola_agenda").fetchone()[0],
    }
    print(f"[seed_demo_data] OK — totais: {totals}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
