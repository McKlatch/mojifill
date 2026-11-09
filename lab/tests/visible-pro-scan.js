// 1.3.4: evaluated in the page — visits every tab, opens every visible help, returns visible text/attrs that still say Pro / unlock / 解除 (all features are free).
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const RE = /\bPRO\b|\bPro\b|(?<!ッ)プロ(?!フィール|グラマー|ダクト|ジェクト)|[Uu]nlock|解除|買い切り|buy\.stripe|¥1,480|refund|返金/;
  const hits = new Set();
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const scan = (where) => {
    const t = document.body.innerText.split('\n');
    t.forEach(l => { if (RE.test(l)) hits.add(where + ' | ' + l.trim().slice(0, 160)); });
    document.querySelectorAll('[title],[aria-label],[placeholder],[alt]').forEach(el => {
      if (!vis(el)) return;
      ['title','aria-label','placeholder','alt'].forEach(a => { const v = el.getAttribute(a); if (v && RE.test(v)) hits.add(where + ' | @' + a + ' ' + v.slice(0, 160)); });
    });
  };
  const tabs = ['fix','names','furigana','dates','phone','work','address','meishi','marks','about'];
  for (const tab of tabs) {
    const b = document.querySelector('[data-tab="' + tab + '"]'); if (b) b.click(); await sleep(300);
    // expand details
    document.querySelectorAll('details').forEach(d => d.open = true); await sleep(100);
    scan(tab);
    const helps = [...document.querySelectorAll('[data-help]')].filter(vis);
    for (const h of helps) {
      h.click(); await sleep(120);
      const m = document.getElementById('helpModal');
      if (m && !m.hidden) { m.innerText.split('\n').forEach(l => { if (RE.test(l)) hits.add(tab + ' help:' + h.dataset.help + ' | ' + l.trim().slice(0, 160)); }); }
      const c = m && m.querySelector('button'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); if (m && !m.hidden && c) c.click(); if (m) m.hidden = true; await sleep(60);
    }
  }
  // document title / meta
  if (RE.test(document.title)) hits.add('title | ' + document.title);
  const hidden = (document.body.textContent.match(new RegExp(RE.source, 'g')) || []).length;
  return { lang: document.documentElement.lang, hits: [...hits], hiddenTextMatches: hidden };
})()
