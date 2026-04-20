(() => {
  const NAMES = [
    'Hiroshi','Lucas','Enzo','Val[eé]rio','Munhoz','Luquita',
    'Laura Bellaguarda(?: de Castro)?','Associa[cç][aã]o dos Propriet[aá]rios(?: e adquirentes)?',
    'Souza Afonso(?: Neg[oó]cios Imobili[aá]rios LTDA)?',
    'LOURIVAL MANOEL DE BRITO JUNIOR','Lourival(?: Jr)?',
    'Eshter(?: Vieira Gomes)?','Esther(?:\\s*\\(ana\\))?',
    'Carlos Augusto(?: Cabeceiro Junior)?','Carlos-Cristina',
    'Teresinha','Galdeano','Oliveira Freitas',
    'Roxana(?: Daniela Sahda)?','Maurino(?: Rodrigues da Rocha)?',
    'Nilson(?: Gonzaga(?: da Silva)?)?','Helena(?: Pinto Val[eé]rio)?',
    'Condom[ií]nio Reserva Europa','Avantti(?: Combust[ií]veis Ltda)?',
    'AOL Construtora(?: Engenharia e Administra[cç][aã]o LTDA)?',
    'LEGRAZ','Mineiro','Embracon','Bruna(?: Domingues)?',
    'Jos[eé] Antonio(?: Nepomuceno)?','Cabeceiro',
    'Luiz Antonio(?: Ferreira)?','AgroVencedor','Assertiva',
    'Barbara','Isabelle','Telefone\\s+\\w+','Cau[cç][aã]o',
    'Dispara A[ií]','Computador'
  ];
  const RE_NAMES = new RegExp('(?<![\\w█])(' + NAMES.join('|') + ')(?![\\w█])', 'gi');
  const RE_CNJ   = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
  const RE_UPPER_NAMES = /\b[A-ZÀ-Ú]{3,}(?:\s+(?:DE|DA|DO|DOS|DAS|E))?\s+[A-ZÀ-Ú]{3,}(?:\s+[A-ZÀ-Ú]{2,}){0,4}\b/g;
  const BLK = '████████';
  const BLK_CNJ = '████████-██.████.█.██.████';

  function redactText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        const p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT','STYLE','NOSCRIPT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while (n = walker.nextNode()) nodes.push(n);
    nodes.forEach(n => {
      const orig = n.textContent;
      if (!orig || orig.length < 3) return;
      const fixed = orig
        .replace(RE_CNJ, BLK_CNJ)
        .replace(RE_UPPER_NAMES, BLK)
        .replace(RE_NAMES, BLK);
      if (fixed !== orig) n.textContent = fixed;
    });
  }

  function blurCols() {
    document.querySelectorAll('table').forEach(t => {
      const hdrs = Array.from(t.querySelectorAll('th, [role="columnheader"]'));
      hdrs.forEach((h, i) => {
        const lbl = (h.textContent || '').trim().toUpperCase();
        if (/CLIENTE|USU[AÁ]RIO|NOME|ORIGEM/.test(lbl)) {
          t.querySelectorAll('tbody tr').forEach(tr => {
            const c = tr.children[i];
            if (c && c.dataset.red !== '1') {
              c.style.filter = 'blur(5px)';
              c.style.userSelect = 'none';
              c.dataset.red = '1';
            }
          });
        }
      });
    });
    document.querySelectorAll('.kanban-card, [class*="kanban"] > div').forEach(card => {
      const kids = Array.from(card.children);
      kids.forEach((kid, idx) => {
        if (idx === 0) return;
        const hasBadge = kid.querySelector('.tag, [class*="badge"], [class*="tag"]');
        if (hasBadge) return;
        const txt = (kid.textContent || '').trim();
        if (txt && txt.length >= 4 && kid.dataset.red !== '1') {
          kid.style.filter = 'blur(5px)';
          kid.style.userSelect = 'none';
          kid.dataset.red = '1';
        }
      });
    });
    document.querySelectorAll('#financeiro-custos tbody tr td:first-child, [class*="custos"] tbody tr td:first-child').forEach(td => {
      if (td.dataset.red !== '1') { td.style.filter = 'blur(5px)'; td.dataset.red = '1'; }
    });
  }

  function hideBanners() {
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length > 0) return;
      const txt = el.textContent || '';
      if (/contas vencidas/i.test(txt) && txt.includes('—')) {
        const parts = txt.split('—');
        el.textContent = parts[0] + '— ████████';
      }
    });
  }

  function tick() {
    try { redactText(); blurCols(); hideBanners(); } catch(e) {}
  }
  tick();
  setInterval(tick, 250);
  new MutationObserver(() => setTimeout(tick, 50))
    .observe(document.body, { childList: true, subtree: true });
})();
