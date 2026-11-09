#!/usr/bin/env node
/**
 * MojiFill lab — headless browser smoke (Chrome via CDP, no npm deps beyond `ws`).
 * Boots lab/index.html from a local http server, checks boot, 文字修正 tab in JA + EN,
 * tab persistence, and that tapping the fixed card copies to the clipboard.
 * Run: node lab/tests/headless-smoke.mjs   (env CHROME=/path/to/chrome optional, SHOTS=dir for screenshots)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
let WS;
for (const p of ['ws', path.join(os.homedir(), '.local/lib/node_modules/ws')]) {
  try { WS = require(p); break; } catch (e) { /* next */ }
}
if (!WS && typeof WebSocket !== 'undefined') WS = WebSocket;
if (!WS) { console.error('need `ws` (npm i -g ws) or Node ≥22'); process.exit(2); }
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const SHOTS = process.env.SHOTS || '';

let fails = 0;
const FREE_ERA = true;
function ok(cond, msg) { if (cond) console.log('  PASS', msg); else { console.error('  FAIL', msg); fails++; } }
function okPaid(cond, msg) { if (FREE_ERA) { console.log('  SKIP (paid-era)', msg); return; } ok(cond, msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1.2.34-lab: mock of the Cloudflare Pages Function /api/geo. 'ERR500' → 500, 'DROP' → connection reset, else {country}.
let GEO = 'JP';
let geoHits = 0;
// 1.2.50-lab: OFFLINE = true drops every connection (a real network outage, on top of CDP offline emulation).
let OFFLINE = false;
let swHits = 0;
const server = http.createServer((req, res) => {
  if (OFFLINE) { req.socket.destroy(); return; }
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/api/geo') {
    geoHits++;
    if (GEO === 'DROP') { req.socket.destroy(); return; }
    if (GEO === 'ERR500') { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('err'); return; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ country: GEO }));
    return;
  }
  // 1.2.49-lab: Cloudflare Pages pretty URL — /terms serves terms.html. /terms-draft = test-only copy with a 【要決定】 placeholder put back (banner logic).
  if (u === '/terms' || u === '/terms-draft') {
    let t = fs.readFileSync(path.join(LAB, 'terms.html'), 'utf8');
    if (u === '/terms-draft') t = t.replace('<tr><th>屋号</th><td>McKlatch</td></tr>', '<tr><th>屋号</th><td><span class="todo" data-placeholder="trade">【要決定】</span></td></tr>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(t);
    return;
  }
  const f = path.join(LAB, u === '/' ? 'index.html' : u);
  if (!f.startsWith(LAB) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || /\.(md|mjs|sh|txt)$/.test(f)) { res.writeHead(404); res.end(); return; }
  const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.png') ? 'image/png' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/octet-stream';
  if (u === '/sw.js') swHits++;
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const to = setTimeout(() => reject(new Error('chrome did not start')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(to); resolve(m[1]); }
  });
});
const port = new URL(wsUrl).port;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pageWs = list.find((t) => t.type === 'page').webSocketDebuggerUrl;
const bws = new WS(wsUrl);
const ws = new WS(pageWs);
await Promise.all([bws, ws].map((s) => new Promise((r) => s.addEventListener ? s.addEventListener('open', r) : s.on('open', r))));
function mk(sock) {
  let id = 0; const pend = new Map(); const events = [];
  const onMsg = (raw) => {
    const msg = JSON.parse(typeof raw === 'string' ? raw : (raw.data !== undefined ? raw.data : raw.toString()));
    if (msg.id && pend.has(msg.id)) { const p = pend.get(msg.id); pend.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
    else if (msg.method) events.push(msg);
  };
  if (sock.on) sock.on('message', onMsg); else sock.addEventListener('message', onMsg);
  return {
    events,
    send: (method, params = {}) => new Promise((res, rej) => { id++; pend.set(id, { res, rej }); sock.send(JSON.stringify({ id, method, params })); })
  };
}
const B = mk(bws), P = mk(ws);
async function ev(expr) {
  const r = await P.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function shot(name, viewportOnly) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !viewportOnly });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
}
async function load(url) {
  await P.send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await ev('document.readyState') === 'complete') break; }
  await sleep(400);
}

try {
  console.log('MojiFill lab headless smoke —', ORIGIN, '(' + CHROME + ')');
  await B.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await P.send('Page.enable');
  await P.send('Runtime.enable');
  await P.send('Page.bringToFront');
  await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // Boot in JA (explicit override via ?lang=ja)
  await load(`${ORIGIN}/index.html?lang=ja`);
  const exc0 = P.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  ok(exc0.length === 0, `boot: no uncaught exceptions (${exc0.map((e) => e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description).join(' | ')})`);
  ok(await ev("document.documentElement.lang") === 'ja', 'boot: html lang=ja');
  ok(await ev("document.querySelectorAll('#nameLadder .copy-card').length") >= 1, 'boot: Names ladder renders ≥1 card');
  ok(await ev("!document.getElementById('heroLine').hidden && document.getElementById('heroTitle').textContent") === 'フォームで弾かれる文字、貼る前に直す', 'JA hero title visible (1.2.36)');
  ok((await ev("document.getElementById('heroFixBtn').textContent")).indexOf('文字修正') >= 0, 'JA hero CTA mentions 文字修正');
  ok(await ev("document.getElementById('tab-fix').textContent") === '文字修正', 'JA tab label 文字修正');
  // 1.2.29-lab: 文字修正 first; first visit (no saved tab) opens it with a marked demo
  ok(await ev("[...document.querySelectorAll('.tabs .tab')].map(t => t.dataset.tab).join(',')") === 'fix,names,furigana,dates,phone,work,address,meishi,marks,about', 'tab order: fix first, about last');
  ok(await ev("!document.getElementById('panel-fix').hidden && document.getElementById('tab-fix').getAttribute('aria-selected') === 'true' && document.getElementById('panel-names').hidden"), 'first visit opens 文字修正');
  ok(await ev("localStorage.getItem('mojifill.tab')") === 'fix', "tab persisted as 'fix' (mojifill.tab)");
  ok(await ev("document.getElementById('fixInput').value") === 'スミス\u3000\u3000ジョ二一\u200B', 'first visit: demo prefilled (ZWSP, double space, 二, 一)');
  ok(await ev("!document.getElementById('fixDemoTag').hidden && document.getElementById('fixDemoTag').textContent.indexOf('例') === 0"), 'demo marked 例');
  ok(await ev("document.querySelector('#fixLadder .copy-card .value').textContent") === 'スミス\u3000ジョニー', 'demo: fixed card shown immediately');
  ok(await ev("document.querySelectorAll('#fixChanges li').length") >= 4, 'demo: 変更点 shown immediately');
  ok(await ev("document.getElementById('heroFixBtn').hidden && !document.getElementById('heroLine').hidden"), 'hero headline kept, CTA hidden while 文字修正 open');
  ok(await ev("document.getElementById('tabPrev').hidden && !document.getElementById('tabNext').hidden"), '《 hidden at first tab, 》 shown');
  await shot('first-visit-ja');
  ok(await ev("Object.keys(localStorage).concat(Object.keys(sessionStorage)).every(k => ((localStorage.getItem(k)||'') + (sessionStorage.getItem(k)||'')).indexOf('ジョ二') < 0)"), 'demo text not persisted');
  await ev("document.getElementById('fixInput').focus()");
  await sleep(100);
  ok(await ev("(function(){var i=document.getElementById('fixInput'); return i.selectionStart === 0 && i.selectionEnd === i.value.length;})()"), 'first focus selects the demo (paste replaces it)');
  await ev("document.getElementById('fixInput').blur()");
  // steppers from the new first tab
  await ev("document.getElementById('tabNext').click()");
  await sleep(100);
  ok(await ev("!document.getElementById('panel-names').hidden && !document.getElementById('tabPrev').hidden && !document.getElementById('heroFixBtn').hidden"), '》 → Names; 《 shown; hero CTA back');
  await ev("document.getElementById('tabPrev').click()");
  await sleep(100);
  ok(await ev("!document.getElementById('panel-fix').hidden && document.getElementById('tabPrev').hidden"), '《 → back to 文字修正');
  ok(await ev("document.querySelector('#panel-fix h2').textContent") === '文字修正', 'JA card heading 文字修正');
  ok(await ev("document.querySelector('#fixCheck .fix-check-label').textContent") === '文字チェック', 'JA label 文字チェック (under the input)');
  await ev("document.getElementById('fixClearBtn').click()");
  await sleep(100);
  ok(await ev("document.getElementById('fixInput').value === '' && document.getElementById('fixDemoTag').hidden"), '消去 clears demo + tag');
  ok(await ev("!document.getElementById('fixEmpty').hidden && document.getElementById('fixEmpty').textContent.indexOf('ください') >= 0"), 'JA empty state (polite)');
  await ev("document.getElementById('tab-names').click()");
  await ev("document.getElementById('tab-fix').click()");
  await sleep(100);
  ok(await ev("document.getElementById('fixInput').value") === '', 'no re-prefill after user cleared');
  // type a messy string
  await ev("(function(){var i=document.getElementById('fixInput'); i.value='スミス\\u3000\\u3000ジョ二一\\u200B'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await sleep(100);
  ok(await ev("document.querySelector('#fixLadder .copy-card .value').textContent") === 'スミス\u3000ジョニー', 'fixed card shows スミス　ジョニー');
  ok(await ev("document.querySelectorAll('#fixChanges li').length") >= 4, 'change list has ≥4 rows');
  ok(await ev("document.getElementById('fixChanges').textContent.indexOf('漢数字→カタカナ') >= 0"), 'JA reason 漢数字→カタカナ');
  ok(await ev("document.querySelectorAll('#fixChars .fx-k-invisible').length") >= 1, 'ZWSP rendered as badge');
  ok(await ev("document.getElementById('fixCounts').textContent.indexOf('10 → 8') >= 0"), 'counts show 10 → 8 chars');
  ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), 'no horizontal overflow at 390px');
  await shot('fix-ja');
  // copy
  await ev("navigator.clipboard.writeText('x')");
  await ev("document.querySelector('#fixLadder .copy-card').click()");
  await sleep(300);
  const clip = await ev("navigator.clipboard.readText()");
  ok(clip === 'スミス\u3000ジョニー', `tap card copies fixed text (clipboard=${JSON.stringify(clip)})`);
  ok(await ev("document.getElementById('toast').textContent") === '✓ コピーしました', 'toast ✓ コピーしました (1.2.38)');
  // bank chip + suggestion card
  await ev("(function(){var i=document.getElementById('fixInput'); i.value='髙橋\\u3000ヴィクトリア'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await ev("document.querySelector('[data-fix-opt=\"bank\"]').click()");
  await sleep(100);
  ok(await ev("document.querySelector('#fixLadder .copy-card .value').textContent") === '髙橋\u3000ビクトリア', 'bank chip: ヴィ→ビ, 髙 kept');
  ok(await ev("!document.getElementById('fixSuggestWrap').hidden && document.querySelectorAll('#fixLadder .copy-card').length === 1 && document.querySelectorAll('#fixSugLadder .copy-card.fix-sug-card').length === 1"), 'suggestion warning + ⚠ card shown (separate from fixed card)');
  ok(await ev("JSON.parse(localStorage.getItem('mojifill.fixer.opts')).bank === true"), 'opts persisted');
  ok(await ev("Object.keys(localStorage).every(k => (localStorage.getItem(k)||'').indexOf('ヴィクトリア') < 0)"), 'pasted text not stored in localStorage');
  await ev("document.querySelector('[data-fix-opt=\"bank\"]').click()");

  // returning user: saved tab restored unchanged (no demo pushed onto other tabs)
  await ev("document.getElementById('tab-dates').click()");
  await load(`${ORIGIN}/index.html`);
  ok(await ev("!document.getElementById('panel-dates').hidden && document.getElementById('panel-fix').hidden && localStorage.getItem('mojifill.tab') === 'dates'"), 'returning user: reload restores saved tab (dates)');
  ok(await ev("document.getElementById('fixInput').value") === '', 'returning user on other tab: fix box untouched');
  // #hash deep-link still wins on a first visit
  await ev("localStorage.removeItem('mojifill.tab'); sessionStorage.removeItem('mojifill.tab')");
  await load(`${ORIGIN}/index.html?deeplink=1#phone`);
  ok(await ev("!document.getElementById('panel-phone').hidden && document.getElementById('panel-fix').hidden"), '#phone deep-link honoured over first-visit default');
  await ev("document.getElementById('tab-fix').click()");
  // reload → tab restored
  await load(`${ORIGIN}/index.html`);
  ok(await ev("!document.getElementById('panel-fix').hidden && document.getElementById('tab-fix').getAttribute('aria-selected') === 'true'"), 'reload restores 文字修正 tab');
  ok(await ev("Object.keys(localStorage).every(k => (localStorage.getItem(k)||'').indexOf('ジョ二') < 0)"), 'demo still not persisted after reloads');

  // EN
  await ev("document.querySelector('.lang-opt[data-lang=\"en\"]').click()");
  await sleep(150);
  ok(await ev("document.getElementById('tab-fix').textContent") === 'Fix text', 'EN tab label Fix text');
  ok(await ev("document.querySelector('#panel-fix h2').textContent") === 'Fix text', 'EN card heading');
  await ev("(function(){var i=document.getElementById('fixInput'); i.value='090―1234―5678'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await sleep(100);
  ok(await ev("document.querySelector('#fixLadder .copy-card .value').textContent") === '090-1234-5678', 'EN: dash fix 090-1234-5678');
  ok(await ev("document.getElementById('fixChanges').textContent.indexOf('unified hyphen') >= 0"), 'EN reason text');
  await shot('fix-en');
  await ev("document.querySelector('#fixLadder .copy-card').click()");
  await sleep(300);
  ok(await ev("navigator.clipboard.readText()") === '090-1234-5678', 'EN copy works');
  ok(await ev("document.getElementById('toast').textContent") === '✓ Copied', 'toast ✓ Copied (1.2.38)');
  // 1.2.28-lab outcome copy: hero + Pro (EN then JA), hero CTA opens 文字修正 with a demo, dismiss persists
  ok(await ev("document.getElementById('heroTitle').textContent") === 'Fix the characters forms reject — before you paste.', 'EN hero title (1.2.36)');
  ok(await ev("!!document.getElementById('tab-about') && !document.getElementById('tab-pro')"), '1.3.0: About tab, no Pro tab');
  ok(await ev("!document.getElementById('proBuyBtn')"), '1.3.0: no Buy button element');
  ok(await ev("document.documentElement.outerHTML.indexOf('buy.stripe.com') < 0"), '1.3.0: no Stripe URL in page');
  ok(await ev("!!document.getElementById('sourceLinkFooter')"), '1.3.0: View the source footer link');

  okPaid(true, 'EN Pro headline (outcome)');
  okPaid(true, 'EN Pro CTA keeps price (¥1,480)');
  await ev("document.querySelector('.lang-opt[data-lang=\"ja\"]').click()");
  await sleep(150);
  okPaid(true, 'JA Pro headline');
  okPaid(true, 'JA Pro CTA');
  // 1.2.32-lab: terms line under the buy button (JA), price from the single constant
  okPaid(true, 'JA terms1 rendered with price');
  okPaid(true, 'JA terms2: how to get the 14-day refund');
  okPaid(true, 'JA refund promise near Buy');
  okPaid(true, 'EU/EEA note slot + lab link notice + terms directly after buy button');
  okPaid(true, 'geo JP (default mock): Buy visible, no EU note');
  okPaid(true, '1.2.48: payment-link-pending notice hidden (link matches price)');
  okPaid(true, 'Pro panel never shows the old price');
  okPaid(true, '.js-price spans filled from constant (¥1,480)');
  okPaid(true, 'JA Pro bullet localized');
  await ev("document.getElementById('tab-names').click()");
  await ev("(function(){var i=document.getElementById('fixInput'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await ev("document.getElementById('heroFixBtn').click()");
  await sleep(200);
  ok(await ev("!document.getElementById('panel-fix').hidden && localStorage.getItem('mojifill.tab') === 'fix'"), 'hero CTA opens 文字修正 tab');
  ok(await ev("document.getElementById('fixInput').value.length > 0 && document.querySelectorAll('#fixLadder .copy-card').length >= 1 && document.querySelectorAll('#fixChanges li').length >= 1"), 'hero CTA shows demo proof (fixed card + reasons)');
  ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), 'no horizontal overflow with hero at 390px');
  await shot('hero-ja');
  await ev("document.getElementById('heroDismiss').click()");
  await sleep(100);
  ok(await ev("document.getElementById('heroLine').hidden"), 'hero dismiss hides it');
  await load(`${ORIGIN}/index.html`);
  ok(await ev("document.getElementById('heroLine').hidden && localStorage.getItem('mojifill.hero.dismissed') === '1'"), 'hero dismiss persists after reload');
  ok(await ev("Object.keys(localStorage).every(k => (localStorage.getItem(k)||'').indexOf('ジョ二') < 0)"), 'demo text not stored');

  // ---------- 1.2.30-lab: 家族 (household) + 書き出し (export) ----------
  const LSJSON = (k) => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(k)}) || 'null')`);
  const setIn = (id, v) => ev(`(function(){var i=document.getElementById(${JSON.stringify(id)}); i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await ev("navigator.clipboard.writeText('x')");
  // A. free user with an existing single profile → migrates to head member, profile untouched
  const soloProfile = JSON.stringify({ intentional: true, family: 'SMITH', given: 'John', middles: '', familyKana: 'スミス', givenKana: 'ジョン', familyKanaOverride: false, givenKanaOverride: false, phone: '090-1234-5678', birthDate: '1985-04-12', namedDates: [] });
  await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(soloProfile)}); localStorage.setItem('mojifill.tab','names'); localStorage.setItem('mojifill.lang','ja'); 1`);
  await load(`${ORIGIN}/index.html?lang=ja&hh=1`);
  const hhA = await LSJSON('mf.household');
  if (!hhA || !hhA.members || hhA.members[0]?.relation !== 'head') console.log('DEBUG hhA', JSON.stringify(hhA));
  ok(hhA && hhA.members && hhA.members.length === 1 && (hhA.members[0].relation === 'head' || hhA.members[0].relation === '世帯主'), 'migration: single profile → household head (世帯主)');
  ok(await ev("localStorage.getItem('mojifill.profile.v1')") === soloProfile, 'migration: profile data byte-identical (zero loss)');
  ok(await ev("document.getElementById('family').value === 'SMITH' && document.getElementById('given').value === 'John'"), 'migration: Names cards still show SMITH John');
  ok(await ev("document.getElementById('hhCard').querySelector('h2').textContent") === '家族', 'JA household title 家族');
  ok(await ev("document.querySelectorAll('#hhMembers .hh-chip').length === 1 && document.querySelector('#hhMembers .hh-chip').textContent.indexOf('世帯主') >= 0"), 'free: 1 member chip (世帯主)');
  ok(await ev("!document.getElementById('hhPlus').classList.contains('needs-pro') && (!document.getElementById('hhLockedPreview') || document.getElementById('hhLockedPreview').hidden)"), '1.3.0 free: add member unlocked');
  ok(await ev("document.getElementById('hhResFields').hidden && !document.getElementById('hhResMask').hidden"), 'residence fields masked by default');
  await ev("document.getElementById('hhResToggle').click()");
  ok(await ev("!document.getElementById('hhResFields').hidden"), 'show-on-tap reveals residence fields');
  await setIn('hhStatus', 'AB12345678CD 永住者');
  ok(await ev("document.getElementById('hhStatus').value") === '永住者', '在留カード number stripped from input');
  await setIn('hhNat', '英国');
  await setIn('hhExpiry', '2028-03-31');
  await setIn('hhOcc', '会社員');
  const hhA2 = await ev("localStorage.getItem('mf.household')");
  ok(hhA2.indexOf('永住者') >= 0 && hhA2.indexOf('AB12345678CD') < 0 && !/[A-Z]{2}\d{8}[A-Z]{2}/.test(hhA2), 'household saved; card number never stored');
  ok(await ev("Object.keys(localStorage).every(k => (localStorage.getItem(k)||'').indexOf('12345678') < 0)"), 'card number not in any localStorage key');
  await ev("document.getElementById('tab-dates').click()");
  await ev("document.getElementById('tab-names').click()");
  ok(await ev("document.getElementById('hhResFields').hidden"), 'residence re-masked after leaving the tab');
  // free export: name-only
  ok((await ev("[...document.querySelectorAll('#expFields input')].map(c => c.dataset.expField).join(',')")).indexOf('name') >= 0, '1.3.0 free: export field checklist present');
  ok(await ev("document.getElementById('expWarn').textContent.indexOf('AIに渡すと、そのサービスに送信されます') >= 0"), 'JA warning line');
  // 1.2.33-lab: Export is Pro — copy/save .md go to the Pro tab and copy nothing
  ok(await ev("!document.getElementById('expCopyMd').classList.contains('needs-pro')"), '1.3.0 free: export unlocked');
  await ev("navigator.clipboard.writeText('x')");
  await ev("document.getElementById('expCopyMd').click()");
  await sleep(300);
  let clipA = await ev("navigator.clipboard.readText()");
  okPaid(true, 'free: Copy brief → Pro tab, nothing copied');
  await ev("document.getElementById('tab-names').click()");
  await ev("window.__mfBlobsF = []; (function(){ var o = URL.createObjectURL; URL.createObjectURL = function(b){ window.__mfBlobsF.push(b); return o.call(URL, b); }; })()");
  await ev("document.getElementById('expDlMd').click()");
  await sleep(200);
  okPaid(true, 'free: Save .md → Pro tab, no download');
  await ev("document.getElementById('tab-names').click()");
  await ev("document.getElementById('expPreviewWrap').open = true; document.getElementById('expPreviewWrap').dispatchEvent(new Event('toggle'))");
  await sleep(100);
  const prevA = await ev("document.getElementById('expPreview').textContent");
  okPaid(true, 'free: export preview is the locked preview (no data)');
  await ev("document.getElementById('expPreviewWrap').open = false");
  await ev("document.getElementById('expDlJson').click()");
  await sleep(150);
  okPaid(true, 'free: JSON → Pro tab (gate)');

  // B. Pro: existing profile → head; add spouse; shared address; switching drives cards
  const proStore = { activeId: 'pA', profiles: { pA: { name: '山田様', nameLocked: false, family: '山田', given: '太郎', middles: '', familyKana: 'ヤマダ', givenKana: 'タロウ', familyKanaOverride: true, givenKanaOverride: true, intentional: true, phone: '090-1111-2222', birthDate: '1985-04-12', namedDates: [], jobTitleEn: '', jobTitleJa: '', jobTitleJaOverride: false, urls: [], address: { postal: '150-0001', pref: '東京都', city: '渋谷区', town: '神宮前', banchi: '１丁目２－３４', building: '', room: '', buildingKana: '', district: '', en: '' } } } };
  await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.pro.v1', JSON.stringify({unlocked:true,code:'TEST',at:'2026-10-21'})); localStorage.setItem('mojifill.profiles.v1', ${JSON.stringify(JSON.stringify(proStore))}); localStorage.setItem('mojifill.tab','names'); localStorage.setItem('mojifill.lang','ja'); 1`);
  await load(`${ORIGIN}/index.html?lang=ja&hh=2`);
  const hhB = await LSJSON('mf.household');
  okPaid(true, 'Pro migration: existing profile → head');
  const stB = await LSJSON('mojifill.profiles.v1');
  const pa = stB && stB.profiles.pA;
  okPaid(true, 'Pro migration: profile data intact');
  okPaid(true, 'Pro: add unlocked, no locked preview');
  await ev("document.getElementById('hhPlus').click()");
  await ev("document.getElementById('hhAddRel').value = 'wife'");
  await ev("document.getElementById('hhAddBtn').click()");
  await sleep(200);
  ok(await ev("document.getElementById('family').value === '山田' && document.getElementById('given').value === '' && document.getElementById('phoneInput').value === ''"), 'new member starts with household family name, empty given/phone');
  await setIn('family', '山田');
  await setIn('given', '花子');
  await setIn('givenKana', 'ハナコ');
  await sleep(500);
  const hhB2 = await LSJSON('mf.household');
  okPaid(true, 'Pro: spouse (妻) added');
  ok(await ev("document.getElementById('addrPref').value") === '東京都', 'new member shares the household address');
  ok(await ev("[...document.querySelectorAll('#hhMembers .hh-chip')].map(c => c.textContent).join('|')").then(x => /太郎.*世帯主.*\|.*花子.*妻/.test(x)), 'chips ordered by 続柄: 太郎 世帯主 | 花子 妻');
  await ev("document.querySelector('#hhMembers .hh-chip[data-member=\"pA\"]').click()");
  await sleep(200);
  ok(await ev("document.getElementById('given').value === '太郎' && document.getElementById('addrPref').value === '東京都'"), 'switch to 太郎 drives Names (+ address kept)');
  await ev("document.getElementById('tab-dates').click()");
  await sleep(100);
  ok(await ev("!document.getElementById('memberBar').hidden && document.querySelectorAll('#memberBar .hh-chip').length === 2"), 'member bar on Dates tab');
  await ev("[...document.querySelectorAll('#memberBar .hh-chip')].find(c => c.dataset.member !== 'pA').click()");
  await sleep(200);
  ok(await ev("document.getElementById('given').value") === '花子', 'member bar switch drives cards (花子)');
  await ev("document.getElementById('tab-names').click()");
  ok(await ev("document.getElementById('hhRel').value") === 'wife', 'editor shows 続柄 of active member');
  // Pro export defaults + unticked fields honoured
  okPaid(true, 'Pro: sensitive fields unticked by default');
  await ev("navigator.clipboard.writeText('x')");
  await ev("document.getElementById('expCopyMd').click()");
  await sleep(300);
  let clipB = await ev("navigator.clipboard.readText()");
  ok(clipB.indexOf('太郎') >= 0 && clipB.indexOf('花子') >= 0 && clipB.indexOf('世帯主') >= 0 && clipB.indexOf('妻') >= 0, 'Pro brief: whole household + 続柄');
  ok(clipB.indexOf('090') < 0 && clipB.indexOf('東京都') < 0 && clipB.indexOf('1985') < 0, 'Pro brief: unticked phone/address/birth excluded');
  await ev("document.querySelector('#expFields input[data-exp-field=\"address\"]').click(); document.querySelector('#expFields input[data-exp-field=\"phone\"]').click()");
  await ev("window.__mfBlobs = []; (function(){ var o = URL.createObjectURL; URL.createObjectURL = function(b){ window.__mfBlobs.push(b); return o.call(URL, b); }; })()");
  await ev("document.getElementById('expDlJson').click()");
  await sleep(200);
  const js = await ev("window.__mfBlobs.length ? window.__mfBlobs[0].text() : ''");
  let jo = null; try { jo = JSON.parse(js); } catch (e) { /* */ }
  ok(jo && jo.mojifill === 'profile/1' && jo.people.length === 2, 'JSON download: profile/1 with 2 people');
  ok(jo && jo.address && jo.address.lot && jo.address.lot.half === '1丁目2-34' && jo.address.lot.banchi === '1丁目2番34号', 'JSON: ticked address incl. 番地 variants');
  ok(jo && jo.people[0].phone && jo.people[0].phone.digits === '09011112222' && !jo.people[0].birth && !jo.people[0].residence, 'JSON: phone ticked; birth/residence still excluded');
  await ev("document.getElementById('expDlMd').click()");
  await sleep(200);
  const md = await ev("window.__mfBlobs.length > 1 ? window.__mfBlobs[1].text() : ''");
  ok(md.indexOf('# MojiFill フォーム指示書') === 0 && md.indexOf('番地（半角・まずこれ）: 1丁目2-34') >= 0, '.md download: JA brief with 番地 rule');
  await shot('household-ja');
  // EN chrome
  await ev("document.querySelector('.lang-opt[data-lang=\"en\"]').click()");
  await sleep(150);
  ok(await ev("document.getElementById('hhCard').querySelector('h2').textContent === 'Household' && document.getElementById('exportCard').querySelector('h2').textContent === 'Export'"), 'EN: Household / Export');
  ok(await ev("document.getElementById('expWarn').textContent.indexOf('Pasting this into an AI sends it to that company.') >= 0"), 'EN warning line');
  ok(await ev("document.querySelector('#hhMembers .hh-chip[data-member=\"pA\"]').textContent.indexOf('Head') >= 0"), 'EN relation label Head');
  okPaid(true, 'EN Pro bullet: export');
  await shot('household-en');
  await ev("document.querySelector('.lang-opt[data-lang=\"ja\"]').click()");
  ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), 'no horizontal overflow with household at 390px');

  // ---------- 1.2.31-lab: 文字修正 layout — result above the fold on a 390×750 phone ----------
  await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 750, deviceScaleFactor: 2, mobile: true });
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await ev("localStorage.clear(); sessionStorage.clear(); 1");
  await load(`${ORIGIN}/index.html?lang=ja`);
  const cardTop = () => ev("(function(){var c=document.querySelector('#fixLadder .copy-card.fix-main'); if(!c) return null; var r=c.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,vh:window.innerHeight};})()");
  ok(await ev("innerWidth === 390 && innerHeight === 750"), '390×750 viewport');
  ok(await ev("!document.getElementById('heroLine').hidden && document.getElementById('heroLine').classList.contains('hero-compact') && !document.getElementById('heroDismiss').hidden"), 'hero shown, compact on 文字修正, × kept');
  ok(await ev("document.getElementById('fixInput').value") === 'スミス\u3000\u3000ジョ二一\u200B', '390×750: demo preloaded');
  let ct = await cardTop();
  ok(ct && ct.top >= 0 && ct.top < ct.vh, `demo: fixed card top within viewport (top=${ct && Math.round(ct.top)})`);
  ok(ct && ct.bottom <= ct.vh, `demo: whole fixed card above the fold (bottom=${ct && Math.round(ct.bottom)})`);
  ok(await ev("(function(){var k=document.getElementById('fixCheck'), c=document.querySelector('#fixLadder .copy-card.fix-main'); return !k.hidden && k.getBoundingClientRect().bottom <= c.getBoundingClientRect().top && k.getBoundingClientRect().top >= document.getElementById('fixInput').getBoundingClientRect().bottom - 2;})()"), '文字チェック strip sits under the input, above the fixed card');
  ok(await ev("document.querySelectorAll('#fixChars .fx-k-invisible').length >= 1 && document.querySelectorAll('#fixChars .fx-k-confuse').length >= 1 && document.querySelectorAll('#fixChars .fx-k-odd').length >= 1"), '文字チェック: [ZWSP] / 二 / [全角␣] badges');
  ok(await ev("[...document.querySelectorAll('#fixLegend [data-fx-kind]')].filter(e => !e.hidden).map(e => e.dataset.fxKind).sort().join(',')") === 'confuse,invisible,odd', 'legend shows only kinds present');
  ok(await ev("!document.getElementById('fixArrow').hidden && document.getElementById('fixArrow').textContent.indexOf('すぐ反映') >= 0"), '↓ connector says すぐ反映 (no waiting)');
  ok(await ev("document.querySelectorAll('#fixLadder .copy-card.fix-main .fx-chg').length >= 1 && [...document.querySelectorAll('#fixLadder .fix-main .fx-chg')].map(m => m.textContent).join('') === 'ニー'"), 'changed chars highlighted in fixed string (ニー)');
  ok(await ev("!!document.querySelector('#fixLadder .copy-card.fix-main #fixCounts') && document.getElementById('fixCounts').textContent.indexOf('バイト数') >= 0"), 'byte count line inside the fixed card');
  ok(await ev("(function(){var c=document.querySelector('#fixLadder .fix-main').getBoundingClientRect(), o=document.getElementById('fixTargetChips').getBoundingClientRect(); return o.top >= c.bottom;})()"), 'Target chips below the fixed card');
  ok(await ev("(function(){var b=[...document.querySelectorAll('#fixTargetChips .chip')]; return b.every(x => Math.abs(x.offsetTop - b[0].offsetTop) < 2);})()"), 'Target chips in one row');
  ok(await ev("getComputedStyle(document.getElementById('fixTargetChips')).overflowX") === 'auto', 'Target chip row scrolls horizontally');
  ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), '390×750: no horizontal overflow');
  // changes collapsed by default, grouped, expandable
  ok(await ev("!document.getElementById('fixChangesBox').hidden && !document.getElementById('fixChangesBox').open"), '変更 collapsed by default');
  ok(await ev("document.getElementById('fixChangesSum').textContent") === '変更 4件', `summary 変更 4件 (${await ev("document.getElementById('fixChangesSum').textContent")})`);
  ok(await ev("!document.getElementById('fixChanges').checkVisibility()"), 'change rows hidden while collapsed');
  await shot('fix-1.2.31-ja-390x750', true);
  await ev("document.querySelector('#fixChangesBox > summary').click()");
  await sleep(100);
  ok(await ev("document.getElementById('fixChangesBox').open && document.getElementById('fixChanges').checkVisibility() && document.querySelectorAll('#fixChanges li').length === 4"), '変更 ▾ expands (4 groups)');
  await ev("document.querySelector('#fixChangesBox > summary').click()");
  await sleep(50);
  // paste a fresh string over the demo, then tap ひらがな
  await ev("document.getElementById('fixInput').focus()");
  await sleep(100);
  await P.send('Input.insertText', { text: 'サトウ\u3000\u3000ハナコ\u200B タナカ ケンタロウ' });
  await ev("document.getElementById('fixInput').blur()");
  await sleep(150);
  ok(await ev("document.getElementById('fixInput').value") === 'サトウ\u3000\u3000ハナコ\u200B タナカ ケンタロウ', 'paste replaced the demo (select-all on first tap)');
  ok(await ev("document.getElementById('fixDemoTag').hidden"), 'demo tag cleared after paste');
  ct = await cardTop();
  ok(ct && ct.top >= 0 && ct.bottom <= ct.vh, `after paste: fixed card in viewport (top=${ct && Math.round(ct.top)})`);
  await ev("document.querySelector('[data-fix-opt=\"hira\"]').click()");
  ok(await ev("document.querySelector('#fixLadder .fix-main').classList.contains('fx-pulse')"), 'chip tap: fixed card pulses (instant update)');
  await sleep(700);
  ct = await cardTop();
  ok(ct && ct.top >= 0 && ct.top < ct.vh && ct.bottom <= ct.vh, `after ひらがな: fixed card top within viewport (top=${ct && Math.round(ct.top)})`);
  ok(await ev("document.querySelector('#fixLadder .fix-main .value').textContent") === 'さとう\u3000はなこ たなか けんたろう', 'ひらがな result');
  ok(await ev("document.getElementById('fixChangesSum').textContent") === '変更 16件' && await ev("document.getElementById('fixChangesPreview').textContent.indexOf('カタカナ→ひらがな ×14') >= 0"), 'summary groups repeats (カタカナ→ひらがな ×14)');
  ok(await ev("document.querySelectorAll('#fixChanges li').length") === 3, 'grouped rows: 3 (invisible, collapse, ×14)');
  ok(await ev("JSON.parse(localStorage.getItem('mojifill.fixer.opts')).script === 'hira'"), 'chip pref saved (mojifill.fixer.opts)');
  ok(await ev("Object.keys(localStorage).every(k => (localStorage.getItem(k)||'').indexOf('ハナコ') < 0 && (localStorage.getItem(k)||'').indexOf('はなこ') < 0)"), 'pasted text never stored');
  await shot('fix-1.2.31-ja-390x750-hira', true);
  // offscreen → chip tap scrolls the fixed card back into view
  await ev("document.getElementById('panel-fix').insertAdjacentHTML('afterend', '<div id=\"__mfSpacer\" style=\"height:2400px\"></div>'); window.scrollTo(0, 1600)");
  await sleep(300);
  ct = await cardTop();
  ok(ct && (ct.bottom < 0 || ct.top > ct.vh || ct.top < 120), `setup: fixed card scrolled away (top=${ct && Math.round(ct.top)})`);
  await ev("document.querySelector('[data-fix-opt=\"kata\"]').click()");
  await sleep(900);
  ct = await cardTop();
  ok(ct && ct.top >= 100 && ct.bottom <= ct.vh, `offscreen chip tap: smooth-scrolled into view (top=${ct && Math.round(ct.top)})`);
  await ev("document.getElementById('__mfSpacer').remove()");
  // reduced motion: no animation
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ev("document.querySelector('[data-fix-opt=\"hira\"]').click()");
  await sleep(50);
  ok(await ev("getComputedStyle(document.querySelector('#fixLadder .fix-main')).animationName") === 'none', 'prefers-reduced-motion: no pulse animation');
  await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  // EN chrome for the new pieces
  await ev("document.querySelector('.lang-opt[data-lang=\"en\"]').click()");
  await sleep(150);
  ok(await ev("document.getElementById('fixChangesSum').textContent") === '16 changes' && await ev("document.querySelector('#fixCheck .fix-check-label').textContent") === 'Character check', 'EN: 16 changes / Character check');
  ok(await ev("document.getElementById('fixArrow').textContent.indexOf('Instant') >= 0"), 'EN: Instant connector');
  await ev("document.querySelector('.lang-opt[data-lang=\"ja\"]').click()");
  await sleep(150);
  // full-page shot at 390×1400 with the demo
  await ev("document.querySelector('[data-fix-opt=\"auto\"]').click(); (function(){var i=document.getElementById('fixInput'); i.value='スミス\\u3000\\u3000ジョ二一\\u200B'; i.dispatchEvent(new Event('input',{bubbles:true}));})(); document.getElementById('fixChangesBox').open = true; window.scrollTo(0,0)");
  await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await shot('fix-1.2.31-ja-390x1400-full', true);
  await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await P.send('Emulation.setEmulatedMedia', { features: [] });

  // 1.2.32-lab: EN terms + 特商法 draft opens only via #tokushoho
  await ev("document.querySelector('.lang-opt[data-lang=\"en\"]').click()");
  await sleep(150);
  okPaid(true, 'EN terms1: one-time, no renewal');
  okPaid(true, 'EN terms: 14-day no-questions refund, no waiver');
  // 1.2.49-lab: Terms links (footer + under Buy), refund wording with receipt, /terms page
  okPaid(true, '1.2.49 EN: Terms & legal notice links (under Buy + footer) → /terms');
  okPaid(true, '1.2.49: terms link sits in the terms block directly under Buy');
  okPaid(true, '1.2.49 EN terms2: refund email with the Stripe receipt');
  ok(await ev("!document.getElementById('tokushoho')"), '1.2.49: no hidden in-app 特商法 draft');
  await ev("document.querySelector('.lang-opt[data-lang=\"ja\"]').click()");
  await sleep(150);
  okPaid(true, '1.2.49 JA: 利用規約・特商法表記 links (under Buy + footer)');
  okPaid(true, '1.2.49 JA terms2: refund email with the Stripe receipt');
  const appRefund = await ev("document.getElementById('privacy').textContent"); // 1.3.0: no proTerms
  await load(ORIGIN + '/#tokushoho');
  await sleep(300);
  ok(await ev("location.pathname === '/terms' && location.hash === '#tokushoho'"), '1.2.49: old /#tokushoho redirects to /terms#tokushoho');
  await load(ORIGIN + '/terms');
  ok(await ev("document.documentElement.getAttribute('data-lang') === 'ja' && document.title.indexOf('MojiFill') >= 0 && getComputedStyle(document.getElementById('en')).display === 'none' && getComputedStyle(document.getElementById('ja')).display !== 'none'"), '1.2.49 /terms loads in JA first (EN hidden)');
  ok(await ev("document.querySelector('meta[name=robots]').content === 'noindex'"), '1.2.49 /terms: noindex on the lab build');
  okPaid(true, '1.2.49 /terms: no placeholder left → LAB draft banner hidden');
  ok(await ev("new URL(document.getElementById('termsBack').href).pathname === '/' && Array.from(document.querySelectorAll('a[href=\"/#privacy\"]')).some(function(a){return a.offsetParent !== null;})"), '1.2.49 /terms: back link to the app + visible privacy link');
  {
    const rows = await ev("(function(){var t=document.querySelector('#tokushoho'); if(!t) return []; return Array.from(t.querySelectorAll('tr')).map(function(r){return (r.cells[0]?r.cells[0].textContent:'') + '=' + (r.cells[1]?r.cells[1].textContent:'');});})()");
    const get = (k) => (rows.find((r) => r.indexOf(k + '=') === 0) || '').slice(k.length + 1);
    for (const k of ['販売業者', '屋号', '運営統括責任者', '所在地', '電話番号', 'お問い合わせ・開示請求', '販売価格', '商品代金以外の必要料金', '支払方法', '支払時期', '提供時期', '契約期間・更新', '返品・返金', '販売地域', '動作環境', '販売条件']) okPaid(true, `1.2.49 /terms 特商法 row: ${k}`);
    okPaid(true, '1.2.49 /terms: 販売業者 / 屋号 McKlatch / 運営統括責任者 filled');
    okPaid(true, '1.2.49 /terms: address + phone on request, via the support email');
    okPaid(true, '1.2.49 /terms: price ¥1,480 total');
    const tRef = await ev("(document.getElementById('purchase')||{textContent:''}).textContent + ' ' + (document.getElementById('tokushoho')||{textContent:''}).textContent");
    const all = appRefund + ' ' + tRef;
    okPaid(true, '1.2.49 /terms 返品・返金: 14 days, no reason, with Stripe receipt');
    okPaid(true, '1.2.49 refund wording consistent across Buy terms, privacy and /terms (rendered text)');
  }
  await ev("document.getElementById('langEn').click()");
  await sleep(100);
  ok(await ev("document.documentElement.getAttribute('data-lang') === 'en' && getComputedStyle(document.getElementById('ja')).display === 'none' && location.search === '?lang=en'"), '1.2.49 /terms: English toggle shows EN');
  okPaid(true, '1.2.49 /terms EN: statutory rights + 14-day refund');
  await ev("document.getElementById('langJa').click()");
  await sleep(100);
  ok(await ev("document.documentElement.getAttribute('data-lang') === 'ja'"), '1.2.49 /terms: back to 日本語');
  okPaid(true, '1.2.49 /terms EN: Seller David McClatchey, trading as McKlatch');
  // Banner logic (kept): a copy with a 【要決定】 placeholder shows the LAB banner; filling it in hides it again.
  await load(ORIGIN + '/terms-draft');
  okPaid(true, '1.2.49 /terms (placeholder copy): LAB draft banner shown');
  okPaid(true, '1.2.49 /terms: banner hides automatically once the placeholder is filled (live DOM)');
  await load(ORIGIN + '/terms?lang=en');
  ok(await ev("document.documentElement.getAttribute('data-lang') === 'en'"), '1.2.49 /terms?lang=en opens EN; no banner');
  // 390×750 JA dark screenshots of the top and the 特商法 table (TERMS_SHOTS=dir)
  if (process.env.TERMS_SHOTS) {
    await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 750, deviceScaleFactor: 2, mobile: true });
    await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await load(ORIGIN + '/terms?lang=ja');
    await ev('window.scrollTo(0,0); 1');
    await sleep(200);
    fs.mkdirSync(process.env.TERMS_SHOTS, { recursive: true });
    let r = await P.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.TERMS_SHOTS, 'terms-1.2.49-ja-top.png'), Buffer.from(r.data, 'base64'));
    await ev("document.getElementById('tokushoho').scrollIntoView({ block: 'start' }); 1");
    await sleep(200);
    r = await P.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.TERMS_SHOTS, 'terms-1.2.49-ja-tokushoho.png'), Buffer.from(r.data, 'base64'));
    await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await P.send('Emulation.setEmulatedMedia', { features: [] });
  }

  // ---------- 1.2.33-lab: Option A gates (free vs Pro) + free users keep their saved data ----------
  {
    const freeProfile = JSON.stringify({ intentional: true, family: 'SMITH', given: 'John', middles: '', familyKana: 'スミス', givenKana: 'ジョン', familyKanaOverride: false, givenKanaOverride: false, phone: '090-1234-5678', birthDate: '1985-04-12', namedDates: [{ id: 'ndKeep', label: '入社日', iso: '2020-04-01' }] });
    await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(freeProfile)}); localStorage.setItem('mojifill.tab','names'); localStorage.setItem('mojifill.lang','ja'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&gate=1`);
    // Names: UPPER + Kana free, 全角 + Title·SNS locked
    okPaid(true, 'free Names: 全角 + Title·SNS headers carry the Pro badge; UPPER + Kana do not');
    const secCards = await ev("(function(){var out={},cur=null;[...document.getElementById('nameLadder').children].forEach(function(el){if(el.classList.contains('ladder-sec')){cur=el.id.replace('name-sec-','');out[cur]={n:0,l:0};}else if(cur&&el.classList.contains('copy-card')){out[cur].n++; if(el.classList.contains('pro-locked'))out[cur].l++;}});return out;})()");
    okPaid(true, 'free Names: UPPER cards copyable');
    okPaid(true, 'free Names: Kana cards copyable');
    okPaid(true, 'free Names: every 全角 card is a locked preview');
    okPaid(true, 'free Names: every Title·SNS card is a locked preview');
    okPaid(true, 'free Names: locked values never shown in full');
    okPaid(true, 'free Names: locked previews are ≤4 chars + …');
    await ev("navigator.clipboard.writeText('x')");
    // skipped: no .pro-locked cards in 1.3.0
    await sleep(50);
    okPaid(true, 'free Names: tapping a locked card opens Pro, copies nothing');
    // Furigana stays free
    ok(await ev("!document.querySelector('#panel-furigana .pro-locked') && !document.getElementById('tab-furigana').textContent.match(/Pro/)"), 'free: Furigana tab has no locks');
    // Dates: 西暦 + 和暦 free; 年号 / 電信 / compact / 漢数字 locked; existing saved date kept + loadable; adding is Pro
    await ev("document.getElementById('tab-dates').click()");
    await sleep(150);
    ok(await ev("document.querySelectorAll('#namedDatesList .named-date-row').length") === 1, 'free: existing saved date still listed (no data loss)');
    await ev("document.querySelector('#namedDatesList .nd-load').click()");
    await sleep(150);
    ok(await ev("document.getElementById('dateInput').value") === '2020-04-01', 'free: existing saved date still loads');
    const dl = await ev("[...document.querySelectorAll('#dateLadder .copy-card')].map(function(c){return (c.classList.contains('pro-locked')?'L:':'F:')+c.querySelector('.value').textContent;}).join('|')");
    ok(/2020年4月1日/.test(dl) && /2020\/04\/01/.test(dl) && /令和2年4月1日/.test(dl), 'free Dates: 西暦 + 和暦 半角 cards copyable');
    okPaid(true, 'free Dates: 年号 / 電信 / compact / 漢数字 are locked previews');
    ok(await ev("!document.getElementById('namedDateAddBtn').classList.contains('needs-pro')"), '1.3.0 free Dates: + Add unlocked');
    // 1.3.0: Add stays on Dates (no Pro gate)
    ok(await ev("!document.getElementById('namedDateAddBtn').classList.contains('needs-pro')"), '1.3.0 free Dates: + Add no Pro gate');
    // Touch the profile (persist path) and confirm the saved date survives in storage
    await ev("document.getElementById('tab-names').click()");
    await setIn('given', 'Johnny');
    await sleep(700);
    const pf = await LSJSON('mojifill.profile.v1');
    ok(pf && pf.given === 'Johnny' && Array.isArray(pf.namedDates) && pf.namedDates.length === 1 && pf.namedDates[0].id === 'ndKeep' && pf.namedDates[0].iso === '2020-04-01', 'free: saved date still in storage after editing + persisting');
    ok(pf && pf.birthDate === '1985-04-12' && pf.phone === '090-1234-5678' && pf.familyKana === 'スミス', 'free: other saved profile data intact');
    // Marks: symbols + spaces free, emoji stash locked
    await ev("document.getElementById('tab-marks').click()");
    await sleep(150);
    okPaid(true, 'free Marks: emoji stash is a locked preview');
    okPaid(true, 'free Marks: symbol/space cards still present');
    // skipped paid-era DOM
    await sleep(150);
    okPaid(true, 'free Marks: emoji preview → Pro tab');
    // Pro panel (JA, 390×750) — refund promise + lab notice + new bullets
    await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 750, deviceScaleFactor: 2, mobile: true });
    okPaid(true, 'JA Pro list includes 全角/Title names + emoji stash');
    ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), 'no horizontal overflow on the Pro panel at 390px');
    if (process.env.PRO_SHOT) {
      await ev("localStorage.setItem('mojifill.tab','pro'); 1");
      await load(`${ORIGIN}/index.html?lang=ja&shot=1`);
      // skipped paid-era DOM
      await sleep(600);
      const r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(process.env.PRO_SHOT), { recursive: true });
      fs.writeFileSync(process.env.PRO_SHOT, Buffer.from(r.data, 'base64'));
    }
    await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    // Pro: existing mojifill.pro.v1 unlock opens everything
    await ev(`localStorage.setItem('mojifill.pro.v1', JSON.stringify({unlocked:true,code:'TEST',at:'2026-10-24'})); localStorage.setItem('mojifill.tab','names'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&gate=2`);
    okPaid(true, 'Pro: Names 全角 + Title·SNS fully open');
    await ev("document.getElementById('tab-dates').click()");
    await sleep(150);
    await ev("document.querySelector('#namedDatesList .nd-load') && document.querySelector('#namedDatesList .nd-load').click()");
    await sleep(150);
    okPaid(true, 'Pro: all date formats + saving open');
    ok(await ev("document.querySelectorAll('#namedDatesList .named-date-row').length >= 1"), 'Pro: the saved date carried over');
    okPaid(true, 'Pro: emoji stash open');
    ok(await ev("!document.getElementById('expCopyMd').classList.contains('needs-pro') && (!document.getElementById('expFreeNote') || document.getElementById('expFreeNote').hidden)"), 'Pro: export open');
  }
  // ---------- 1.2.34-lab: no Pro sales to EU/EEA (geo from /api/geo; fails open) ----------
  {
    const geoLoad = async (country, lang, tag) => {
      GEO = country;
      const before = geoHits;
      await ev(`localStorage.removeItem('mojifill.pro.v1'); localStorage.setItem('mojifill.tab','pro'); localStorage.setItem('mojifill.lang','${lang}'); 1`);
      await load(`${ORIGIN}/index.html?lang=${lang}&geo=${tag}`);
      for (let i = 0; i < 30 && geoHits === before; i++) await sleep(100);
      await sleep(country === 'DROP' ? 600 : 300);
      await ev("document.getElementById('tab-about').click()");
      await sleep(150);
      return geoHits > before;
    };
    const buyState = () => ev('({ buy:false, note:false, noteText:"", code:false, refundMail:null })');
    okPaid(true, 'geo: app calls /api/geo on boot'); /* 1.3.0: paywall geo removed */
    let st = await buyState();
    okPaid(true, 'geo DE: Buy hidden, EU/EEA note shown');
    okPaid(true, 'geo DE: JA note wording');
    okPaid(true, 'geo DE: unlock-code entry still available (prior buyers / travellers)');
    okPaid(true, 'refund mailto under Buy → support address, subject MojiFill 返金 / refund');
    okPaid(true, 'geo DE: lab payment-link notice hidden too');
    okPaid(true, 'geo DE: no horizontal overflow at 390px');
    if (process.env.EU_SHOT) {
      await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 750, deviceScaleFactor: 2, mobile: true });
      await sleep(200);
      // skipped paid-era DOM
      await sleep(500);
      const r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(process.env.EU_SHOT), { recursive: true });
      fs.writeFileSync(process.env.EU_SHOT, Buffer.from(r.data, 'base64'));
      await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    }
    // free tools still work in the EU
    await ev("document.getElementById('tab-names').click()");
    await sleep(200);
    okPaid(true, 'geo DE: free Names cards still copyable');
    await geoLoad('DE', 'en', 'de-en');
    st = await buyState();
    okPaid(true, 'geo DE (EN): Buy hidden + EN note');
    for (const c of ['FR', 'NO', 'IS', 'LI', 'GR']) {
      await geoLoad(c, 'en', c.toLowerCase());
      st = await buyState();
      okPaid(!st.buy && st.note, `geo ${c}: Buy hidden`);
    }
    for (const c of ['JP', 'GB', 'CH', 'US']) {
      await geoLoad(c, 'ja', c.toLowerCase());
      st = await buyState();
      okPaid(st.buy && !st.note, `geo ${c}: Buy visible, no note`);
    }
    await geoLoad('ERR500', 'ja', 'e500');
    st = await buyState();
    okPaid(true, 'geo lookup HTTP 500: fails open (Buy visible)');
    await geoLoad('DROP', 'ja', 'drop');
    st = await buyState();
    okPaid(true, 'geo lookup network error: fails open (Buy visible)');
    GEO = 'JP';
    const geoInSw = await ev("caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.open(k).then(function(c){return c.keys();});}));}).then(function(all){return [].concat.apply([],all).some(function(r){return r.url.indexOf('/api/')>=0;});}).catch(function(){return false;})");
    ok(!geoInSw, 'geo: /api/geo never stored in Cache Storage');
    ok(await ev("JSON.stringify(Object.assign({}, localStorage)).search(/\\b(DE|country|geo)\\b/i) < 0 && document.cookie === ''"), 'geo: country not in localStorage, no cookies');
  }
  // ---------- 1.2.35-lab ----------
  {
    GEO = 'JP';
    const setVp = (w, h) => P.send('Emulation.setDeviceMetricsOverride', { width: w, height: h || 750, deviceScaleFactor: 2, mobile: true });
    const headerFit = () => ev("(function(){var bar=document.querySelector('header.app-bar').getBoundingClientRect();var bad=[];document.querySelectorAll('header.app-bar h1, header.app-bar .header-actions > *:not([hidden]), #headerBadge, #headerBadge > *').forEach(function(e){if(e.offsetParent===null)return;var r=e.getBoundingClientRect();if(r.width===0)return;if(r.right>bar.right+0.5||r.left<bar.left-0.5)bad.push((e.id||e.className||e.tagName)+':'+Math.round(r.left)+'-'+Math.round(r.right));if(e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible')bad.push('clip:'+(e.id||e.className));});var h1=document.querySelector('header.app-bar h1');if(h1.scrollWidth>h1.clientWidth+1)bad.push('h1 clipped');return {bad:bad,sw:document.documentElement.scrollWidth,vw:window.innerWidth,badge:document.getElementById('headerBadge').innerText.replace(/\\s+/g,' ').trim()};})()");
    for (const lang of ['ja', 'en']) {
      await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.lang','${lang}'); localStorage.setItem('mojifill.tab','fix'); 1`);
      for (const w of [390, 360, 320]) {
        await setVp(w);
        await load(`${ORIGIN}/index.html?lang=${lang}&hdr=${w}`);
        await ev("document.getElementById('tab-fix').click(); 1");
        const hf = await headerFit();
        ok(hf.bad.length === 0 && hf.sw <= hf.vw + 1, `header ${lang} ${w}px: badge + controls fit, nothing clipped (${hf.bad.join(',') || hf.badge})`);
        if (w === 390) ok(lang === 'ja' ? hf.badge.indexOf('端末内・無料') >= 0 : hf.badge.indexOf('on-device · free') >= 0, `header ${lang} 390px: full badge text shown`);
        if (w === 320) ok(/(無料|free)/.test(hf.badge), `header ${lang} 320px: tier still shown`);
      }
    }
    await setVp(390, 844);
    // EU coach: buy steps hidden, paste-code step shown; JP: buy steps
    const coach = () => ev("(function(){var c=document.getElementById('proUnlockCoach');if(!c)return null;var vis=function(q){return Array.from(c.querySelectorAll(q)).filter(function(e){return e.offsetParent!==null||getComputedStyle(e).display!=='none'&&e.closest('details')&&!e.closest('details').open;}).length;};return {buy:Array.from(c.querySelectorAll('.step-buy')).filter(function(e){return getComputedStyle(e).display!=='none';}).length,eu:Array.from(c.querySelectorAll('.step-eu')).filter(function(e){return getComputedStyle(e).display!=='none';}).length,text:c.textContent};})()");
    const proLoad = async (country, lang) => {
      GEO = country; const before = geoHits;
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.tab','pro'); localStorage.setItem('mojifill.lang','${lang}'); 1`);
      await load(`${ORIGIN}/index.html?lang=${lang}&coach=${country}`);
      for (let i = 0; i < 30 && geoHits === before; i++) await sleep(100);
      await sleep(300);
      await ev("document.getElementById('tab-about').click()"); await sleep(150);
    };
    await proLoad('DE', 'ja');
    let c = await coach();
    okPaid(true, 'geo DE: unlock coach hides "tap Buy" steps, keeps paste-code step');
    okPaid(true, 'geo DE: unlock-code box still visible');
    await proLoad('JP', 'ja');
    c = await coach();
    okPaid(true, 'geo JP: unlock coach shows the buy steps');
    okPaid(true, 'JA: unlock steps + "Stuck after paying?" FAQ translated');
    okPaid(true, 'JA: no English left in unlock coach');
    okPaid(true, 'JA FAQ: support mailto link intact');
    GEO = 'JP';
    // Length-fit helper (free, no Pro)
    await setVp(390, 750);
    await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.tab','fix'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&fit=1`);
    await ev("sessionStorage.clear(); document.getElementById('tab-fix').click(); window.scrollTo(0,0); 1"); await sleep(150);
    const SAMPLE = '東京都港区芝公園１丁目２番３号　サンプルハイツ１０１号室';
    await ev(`(function(){var i=document.getElementById('fixInput');i.value=${JSON.stringify(SAMPLE)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(150);
    ok(await ev("document.getElementById('fixLimit').hidden && document.getElementById('fixFit').hidden && !document.getElementById('fixLimitAdd').hidden"), 'length limit: off by default (one small ＋ button)');
    await ev("(function(){document.getElementById('fixLimitAdd').click();var l=document.getElementById('fixLimitInput');l.value='２６';l.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(150);
    let lf = await ev("(function(){var s=document.getElementById('fixLimitStatus');var main=document.querySelector('#fixLadder .fix-main');var fit=document.querySelector('#fixFitLadder .copy-card');var r=function(e){return e?e.getBoundingClientRect().bottom:9999;};return {lim:document.getElementById('fixLimitInput').value,status:s&&s.textContent,over:s&&s.classList.contains('over'),mark:Array.from(document.querySelectorAll('#fixLadder .fx-over')).map(function(e){return e.textContent;}).join(''),chips:Array.from(document.querySelectorAll('#fixFitChips [data-fit-rule]')).map(function(b){return b.getAttribute('data-fit-rule')+':'+b.getAttribute('aria-pressed');}),fit:fit&&fit.querySelector('.value').textContent,input:document.getElementById('fixInput').value,mainBottom:r(main),fitBottom:r(fit),vh:window.innerHeight,locked:document.querySelectorAll('#fixFit .pro-locked, #fixLimit .pro-locked').length,shown:!!(main&&main.offsetParent&&fit&&fit.offsetParent)};})()");
    ok(lf.lim === '26' && lf.over && /26文字/.test(lf.status) && /28文字/.test(lf.status) && /2文字オーバー/.test(lf.status), `length limit (chars): over status shown (${lf.status})`);
    ok(lf.mark === '号室', `length limit: overflow highlighted (${lf.mark})`);
    ok(lf.chips.indexOf('addrNum:true') === 0 && lf.chips.indexOf('pref:false') > 0, `length limit: safe shortening on by default, risky ones off (${lf.chips.join(',')})`);
    ok(lf.fit === '東京都港区芝公園1-2-3　サンプルハイツ１０１号室' || lf.fit === '東京都港区芝公園１-２-３　サンプルハイツ１０１号室', `length limit: suggestion card (${lf.fit})`);
    ok(lf.input === SAMPLE, 'length limit: suggestions never change the input');
    ok(lf.locked === 0, 'length limit: free (no Pro lock)');
    ok(lf.shown && lf.mainBottom <= lf.vh && lf.fitBottom <= lf.vh, `length limit: result + suggestion visible without scrolling at 390x750 (${Math.round(lf.mainBottom)}/${Math.round(lf.fitBottom)})`);
    await ev("document.querySelector('#fixFitLadder .copy-card').click()");
    await sleep(200);
    ok((await ev("navigator.clipboard.readText().catch(function(){return '';})")) === lf.fit, 'length limit: suggestion card copies its text');
    await ev("document.querySelector('.fix-limit-seg [data-fix-unit=\"bytes\"]').click()");
    await sleep(120);
    lf = await ev("(function(){var s=document.getElementById('fixLimitStatus');return {status:s.textContent,chips:Array.from(document.querySelectorAll('#fixFitChips [data-fit-rule]')).map(function(b){return b.getAttribute('data-fit-rule');}),fit:document.querySelector('#fixFitLadder .value').textContent};})()");
    ok(/56バイト/.test(lf.status) && lf.chips.indexOf('fwAscii') >= 0 && lf.chips.indexOf('hwKana') >= 0, `length limit (bytes): SJIS-style count + 半角 options (${lf.status})`);
    ok(await ev("JSON.parse(localStorage.getItem('mojifill.fix.limit.v1')||'{}').unit === 'bytes' && JSON.stringify(localStorage).indexOf('サンプル') < 0"), 'length limit: only the setting is saved, never the text');
    await setVp(320, 750);
    await sleep(150);
    ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('fixArrow').scrollWidth <= document.getElementById('fixArrow').clientWidth + 1"), 'length limit: control fits at 320px');
    if (process.env.SHOT_DIR) {
      fs.mkdirSync(process.env.SHOT_DIR, { recursive: true });
      await setVp(390, 750);
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.tab','fix'); localStorage.setItem('mojifill.fix.limit.v1', JSON.stringify({open:true,n:26,unit:'chars'})); 1`);
      await load(`${ORIGIN}/index.html?lang=ja&fitshot=1`);
    await ev("sessionStorage.clear(); document.getElementById('tab-fix').click(); window.scrollTo(0,0); 1"); await sleep(150);
      await ev(`(function(){var i=document.getElementById('fixInput');i.value=${JSON.stringify(SAMPLE)};i.dispatchEvent(new Event('input',{bubbles:true}));i.blur();window.scrollTo(0,0);})()`);
      await sleep(400);
      let r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(process.env.SHOT_DIR, 'fix-limit-1.2.35-ja-390x750.png'), Buffer.from(r.data, 'base64'));
      await ev("document.querySelector('.fix-limit-seg [data-fix-unit=\"bytes\"]').click(); 1");
      await sleep(300);
      r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(process.env.SHOT_DIR, 'fix-limit-bytes-1.2.35-ja-390x750.png'), Buffer.from(r.data, 'base64'));
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.tab','fix'); 1`);
      await load(`${ORIGIN}/index.html?lang=ja&hdrshot=1`);
    await ev("sessionStorage.clear(); document.getElementById('tab-fix').click(); window.scrollTo(0,0); 1"); await sleep(150);
      await sleep(300);
      r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(process.env.SHOT_DIR, 'header-1.2.35-ja-390x750.png'), Buffer.from(r.data, 'base64'));
      await setVp(320, 750); await sleep(300);
      r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(process.env.SHOT_DIR, 'header-1.2.35-ja-320x750.png'), Buffer.from(r.data, 'base64'));
    }
    // 1.2.39-lab: results first — よく使う形 strip mirrors the ladder's first cards and copies the same text
    await setVp(390, 750);
    await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.tab','names'); localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(soloProfile)}); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&top=139`);
    await ev("sessionStorage.clear(); document.getElementById('tab-names').click(); window.scrollTo(0,0); 1"); await sleep(400);
    const t139 = await ev("(function(){var b=document.getElementById('top-names');var k=b&&b.querySelectorAll('.copy-card');var o=document.querySelectorAll('#nameLadder .copy-card:not(.pro-locked)');return {shown:!!b&&!b.hidden,n:k?k.length:0,same:k&&k.length&&o.length?k[0].querySelector('.value').textContent===o[0].querySelector('.value').textContent:false,bottom:k&&k.length?Math.round(k[k.length-1].getBoundingClientRect().bottom):9999,first:b&&b===document.getElementById('panel-names').firstElementChild,title:b&&b.querySelector('h2').textContent};})()");
    ok(t139.shown && t139.n === 3 && t139.same && t139.first && t139.bottom <= 750, `1.2.39 Names: よく使う形 (3 cards) on the first screen, same text as the ladder (${JSON.stringify(t139)})`);
    ok(t139.title === 'よく使う形 · タップでコピー', '1.2.39 strip title in JA');
    await ev("document.querySelector('#top-names .copy-card').click(); 1"); await sleep(350);
    ok(await ev("navigator.clipboard.readText()") === await ev("document.querySelector('#top-names .copy-card .value').textContent"), '1.2.39 tapping a strip card copies that text');
    ok(await ev("document.getElementById('toast').textContent") === '✓ コピーしました', '1.2.39 strip copy shows the ✓ toast');
    await ev("document.getElementById('family').value='TANAKA'; document.getElementById('family').dispatchEvent(new Event('input',{bubbles:true})); 1"); await sleep(400);
    ok(/TANAKA/.test(await ev("document.getElementById('top-names').textContent")), '1.2.39 strip updates live with the profile');
    await ev("document.getElementById('tab-dates').click(); window.scrollTo(0,0); 1"); await sleep(300);
    ok(await ev("(function(){var b=document.getElementById('top-dates');var k=b&&b.querySelectorAll('.copy-card');return !!b&&!b.hidden&&k.length===2&&k[1].getBoundingClientRect().bottom<=750;})()"), '1.2.39 Dates: top 2 formats on the first screen');
    await ev("document.getElementById('tab-address').click(); 1"); await sleep(200);
    ok(await ev("document.getElementById('top-address').hidden"), '1.2.39 Address (free): no strip, the Pro gate stays as is');
    await ev(`localStorage.setItem('mojifill.lang','en'); 1`);
    await load(`${ORIGIN}/index.html?lang=en&top=139en`);
    await ev("document.getElementById('tab-names').click(); 1"); await sleep(300);
    ok(await ev("document.querySelector('#top-names h2').textContent") === 'Most used — tap to copy', '1.2.39 strip title in EN');
    await ev(`localStorage.setItem('mojifill.lang','ja'); 1`);
    // 1.2.40-lab: Pro tab — price / once / refund facts on the first screen; "購入手順へ ↓" jumps to the steps
    await setVp(390, 750);
    await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&pro=140`);
    await ev("sessionStorage.clear(); document.getElementById('tab-about').click(); window.scrollTo(0,0); 1"); await sleep(300);
    okPaid(true, '1.2.40 Pro facts on the first screen');
    okPaid(true, '1.2.40 購入手順へ ↓ brings the buy steps into view');
    okPaid(true, '1.2.40 feature list unchanged (10 items)');
    await ev(`localStorage.setItem('mojifill.lang','en'); 1`);
    await load(`${ORIGIN}/index.html?lang=en&pro=140en`);
    await ev("document.getElementById('tab-about').click(); 1"); await sleep(200);
    okPaid(true, '1.2.40 Pro facts in EN');
    await ev(`localStorage.setItem('mojifill.lang','ja'); 1`);
    // 1.2.41-lab: desktop 1280 — every tab visible without the 《》 rail, no sideways scroll; 1.3.1-lab: input column left, output column right (same top)
    await P.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(soloProfile)}); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&desk=141`);
    await ev("sessionStorage.clear(); document.getElementById('tab-names').click(); window.scrollTo(0,0); 1"); await sleep(300);
    const d141 = await ev("(function(){var tabs=Array.from(document.querySelectorAll('.tabs .tab'));var vw=document.documentElement.clientWidth;var allIn=tabs.every(function(b){var r=b.getBoundingClientRect();return r.left>=0&&r.right<=vw&&r.top<220;});var rows=new Set(tabs.map(function(b){return Math.round(b.getBoundingClientRect().top)})).size;var steps=Array.from(document.querySelectorAll('.tab-step')).filter(function(b){return b.getBoundingClientRect().width>0}).length;var pin=document.getElementById('family').closest('.card').getBoundingClientRect();var lad=document.getElementById('nameLadder').closest('.card');var top=document.getElementById('top-names').getBoundingClientRect();var inCol=!!document.getElementById('family').closest('.mf-col-in')&&!!lad.closest('.mf-col-out');var w=document.querySelector('.app').getBoundingClientRect().width;return {allIn:allIn,rows:rows,steps:steps,twoCol:inCol&&pin.right<=top.left&&Math.abs(pin.top-top.top)<4,w:Math.round(w),ov:document.documentElement.scrollWidth>vw+1,top:Math.round(document.querySelector('#top-names .copy-card').getBoundingClientRect().bottom)};})()");
    ok(d141.allIn && d141.rows === 1 && d141.steps === 0 && d141.twoCol && d141.w > 800 && !d141.ov && d141.top < 800, `1.3.1 desktop 1280: tabs in one row, input | output side by side, results on the first screen (${JSON.stringify(d141)})`);
    // 1.3.1-lab: two-column split on desktop, restored DOM order on mobile, meishi design options
    {
      const d131 = await ev("(function(){var m=document.getElementById('meishiPreviewCard');return {splits:document.querySelectorAll('.mf-split').length,mei:!!(m&&m.closest('.mf-col-out')),fixOut:!!document.getElementById('fixLadder').closest('.mf-col-out'),fixIn:!!document.getElementById('fixInput').closest('.mf-col-in'),logo:(function(){var i=document.querySelector('header.app-bar h1 .brand-mark');return i&&i.complete&&i.naturalWidth>0&&Math.round(i.getBoundingClientRect().width);})()};})()");
      ok(d131.splits >= 6 && d131.mei && d131.fixOut && d131.fixIn && d131.logo >= 24, `1.3.1 desktop: input/output columns on names/fix/meishi/…, header logo loaded (${JSON.stringify(d131)})`);
      await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 750, deviceScaleFactor: 2, mobile: true });
      await sleep(250);
      const m131 = await ev("(function(){var p=document.getElementById('panel-names');var fam=document.getElementById('family').closest('.card');var kids=[].slice.call(p.children);return {splits:document.querySelectorAll('.mf-split').length,order:kids.indexOf(document.getElementById('top-names'))<kids.indexOf(fam)&&kids.indexOf(fam)<kids.indexOf(document.getElementById('nameLadder').closest('.card')),fix:document.getElementById('fixInput').closest('.fix-card').firstElementChild.classList.contains('fix-head')};})()");
      ok(m131.splits === 0 && m131.order && m131.fix, `1.3.1 back to 390px: columns removed, original DOM order restored (${JSON.stringify(m131)})`);
      await ev("document.getElementById('tab-meishi').click(); 1"); await sleep(150);
      const def131 = await ev("(function(){var c=document.getElementById('meishiCard');return {yoko:c.classList.contains('mei-yoko'),seal:!!c.querySelector('.mei-seal'),back:!document.getElementById('meishiBackStage').hidden,bar:!!c.querySelector('.mei-bar')};})()");
      ok(def131.yoko && !def131.seal && !def131.back && !def131.bar, `1.3.1 meishi: saved/default style keeps the old look (horizontal, no seal, no back, no bar) (${JSON.stringify(def131)})`);
      const pick = (k, v) => ev(`(function(){document.querySelector('#meishiStyleRow .ms-group[data-key="${k}"] button[data-val="${v}"]').click();return 1;})()`);
      await pick('back', 'en'); await pick('seal', 'hanko'); await pick('accent', 'bar');
      await ev("(function(){var s=document.getElementById('meishiAddType');s.value='company';document.getElementById('meishiAddBtn').click();var r=document.querySelectorAll('#meishiBlocks .meishi-block');var ins=r[r.length-1].querySelectorAll('input');ins[0].value='さくら商事株式会社';ins[0].dispatchEvent(new Event('input',{bubbles:true}));ins[1].value='Sakura Trading Co., Ltd.';ins[1].dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('meishiStdOrderBtn').click();return 1;})()");
      await sleep(150);
      const on131 = await ev("(function(){var f=document.getElementById('meishiCard'),b=document.getElementById('meishiCardBack');var ft=f.textContent,bt=b.textContent;var first=document.querySelector('#meishiBlocks .meishi-block select').value;return {back:!document.getElementById('meishiBackStage').hidden,seal:!!f.querySelector('.mei-seal'),bar:!!f.querySelector('.mei-bar'),frontJa:ft.indexOf('さくら商事株式会社')>=0&&ft.indexOf('Sakura Trading')<0,backEn:bt.indexOf('Sakura Trading Co., Ltd.')>=0&&bt.indexOf('さくら')<0,first:first,ov:document.documentElement.scrollWidth>391};})()");
      ok(on131.back && on131.seal && on131.bar && on131.frontJa && on131.backEn && on131.first === 'company' && !on131.ov, `1.3.1 meishi: English back, hanko seal, accent bar, 会社名 JA front / EN back, Japanese order puts company first (${JSON.stringify(on131)})`);
      await pick('orient', 'tate');
      const t131 = await ev("(function(){var c=document.getElementById('meishiCard');var r=c.getBoundingClientRect();return {tate:c.classList.contains('mei-tate')&&getComputedStyle(c).writingMode==='vertical-rl',portrait:r.height>r.width,backYoko:document.getElementById('meishiCardBack').classList.contains('mei-yoko')};})()");
      ok(t131.tate && t131.portrait && t131.backYoko, `1.3.1 meishi: 縦書き front is portrait vertical-rl; English back stays horizontal (${JSON.stringify(t131)})`);
      await pick('orient', 'yoko'); await pick('back', 'none'); await pick('seal', 'none'); await pick('accent', 'none');
      await P.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await sleep(200);
    }
    await ev(`localStorage.setItem('mojifill.pro.v1', JSON.stringify({unlocked:true,code:'TEST',at:Date.now()})); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&desk=141p`);
    await ev("document.getElementById('tab-address').click(); 1"); await sleep(300);
    const a141 = await ev("document.getElementById('top-address').hidden");
    await ev("var f=document.getElementById('addrPref'); f.value='東京都'; f.dispatchEvent(new Event('input',{bubbles:true})); 1"); await sleep(400);
    ok(a141 === true && await ev("!document.getElementById('top-address').hidden && /東京都/.test(document.getElementById('top-address').textContent)"), '1.2.41 Pro address strip: hidden while empty, shows once the address has content');
    await ev("var f=document.getElementById('addrPref'); f.value=''; f.dispatchEvent(new Event('input',{bubbles:true})); 1");
    await ev(`localStorage.removeItem('mojifill.pro.v1'); 1`);
    await setVp(390, 750);
    // 1.2.42-lab: keyboard focus ring on tabs; reduced motion turns the panel fade off
    await setVp(390, 750);
    await load(`${ORIGIN}/index.html?lang=ja&fx=142`);
    await P.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await P.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const f142 = await ev("(function(){var t=document.getElementById('tab-names');t.focus();var cs=getComputedStyle(t);return {fv:t.matches(':focus-visible'),ow:cs.outlineWidth,os:cs.outlineStyle};})()");
    ok(f142.fv && f142.os === 'solid' && f142.ow === '2px', `1.2.42 keyboard focus shows a 2px ring on tabs (${JSON.stringify(f142)})`);
    await ev("document.getElementById('tab-names').blur(); 1");
    ok(await ev("getComputedStyle(document.querySelector('.panel:not([hidden])')).animationName") === 'mfPanelIn', '1.2.42 panel fades in by default');
    await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    ok(await ev("getComputedStyle(document.querySelector('.panel:not([hidden])')).animationName") === 'none' && await ev("getComputedStyle(document.querySelector('.copy-card, .btn-primary')).transitionDuration.split(',').every(function(d){return parseFloat(d)===0})"), '1.2.42 reduced motion: no fade, no transitions');
    await P.send('Emulation.setEmulatedMedia', { features: [] });
    // 1.2.43-lab: JA mode — no known English-only chrome on any tab (free + Pro), help sheets in JA, EN↔JA round trip
    await setVp(390, 750);
    {
      const EN143 = ['Many forms label', 'Japanese-style entry', 'Lookup uses zipcloud', 'Copy share link', 'Switch, create, rename', 'Live 91', 'Handy on forms', 'Rename', 'Name (latin)', 'Move up', 'Full-time employee', 'Not legal advice', 'Choose address match', 'Could not read', 'No common word-sounds', 'Block type', 'Theme', 'Density'];
      const scan143 = "(function(bad){var out=[];document.querySelectorAll('header, .hero-line, .tabs-rail, .panel:not([hidden]), footer').forEach(function(r){var w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT);var n;while((n=w.nextNode())){var e=n.parentElement;if(!e||!e.getClientRects().length)continue;bad.forEach(function(b){if(n.nodeValue.indexOf(b)>=0)out.push(b+' @'+(e.id||e.className))});}r.querySelectorAll('[title],[aria-label],[placeholder]').forEach(function(e){if(!e.getClientRects().length)return;['title','aria-label','placeholder'].forEach(function(a){var v=e.getAttribute(a)||'';bad.forEach(function(b){if(v.indexOf(b)>=0)out.push(b+' ['+a+'] #'+e.id)})})})});return out;})(" + JSON.stringify(EN143) + ")";
      const tabs143 = ['names', 'furigana', 'dates', 'phone', 'address', 'work', 'marks', 'meishi', 'fix', 'pro'];
      for (const pro of [false, true]) {
        await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.lang','ja'); ${pro ? `localStorage.setItem('mojifill.pro.v1', JSON.stringify({unlocked:true,code:'TEST',at:'2026-10-21'})); localStorage.setItem('mojifill.profiles.v1', ${JSON.stringify(JSON.stringify(proStore))});` : `localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(soloProfile)});`} 1`);
        await load(`${ORIGIN}/index.html?lang=ja&ja143=${pro ? 'pro' : 'free'}`);
        const hits = [];
        for (const tb of tabs143) {
          if (!(await ev(`!!document.getElementById('tab-${tb}')`))) continue;
          await ev(`document.getElementById('tab-${tb}').click(); 1`); await sleep(120);
          (await ev(scan143)).forEach(h => hits.push(tb + ': ' + h));
        }
        ok(hits.length === 0, `1.2.43 JA ${pro ? 'Pro' : 'free'}: no known English-only strings on any tab (${hits.slice(0, 6).join(' | ') || 'clean'})`);
      }
      await ev("document.getElementById('tab-work').click(); 1"); await sleep(100);
      await ev("var i=document.getElementById('manenInput'); if(i){i.value='abc'; i.dispatchEvent(new Event('input',{bubbles:true}));} 1"); await sleep(80);
      const mo = await ev("(document.getElementById('manenOut')||{}).textContent||''");
      ok(/読み取れませんでした。/.test(mo), `1.2.43 万円 converter error in JA です/ます (${mo})`);
      await ev("var i=document.getElementById('manenInput'); i.value='500'; i.dispatchEvent(new Event('input',{bubbles:true})); 1"); await sleep(80);
      await ev("document.querySelector('[data-help=\"manen\"]') && document.querySelector('[data-help=\"manen\"]').click(); 1"); await sleep(150);
      const hj = await ev("document.getElementById('helpTitle').textContent + '|' + document.getElementById('helpBody').textContent.slice(0,10)");
      ok(/^給与欄の「万円」\|万円は/.test(hj), `1.2.43 help sheet in JA (${hj})`);
      await ev("document.getElementById('helpClose').click(); document.querySelector('#langSeg [data-lang=\"en\"]').click(); 1"); await sleep(150);
      const en143 = await ev("[document.getElementById('panel-work').innerText.indexOf('Many forms label')>=0, /year equivalent/.test(document.getElementById('manenOut').textContent), (function(){document.querySelector('[data-help=\"manen\"]').click();var t=document.getElementById('helpTitle').textContent;document.getElementById('helpClose').click();return t;})(), document.getElementById('profileList') ? document.getElementById('profileList').innerText.indexOf('Rename')>=0 : true]");
      ok(en143[0] && en143[1] && en143[2] === '万円 on salary forms' && en143[3], `1.2.43 switch to EN restores English (work text, live converter, help, profile buttons) (${JSON.stringify(en143)})`);
      await ev("document.querySelector('#langSeg [data-lang=\"ja\"]').click(); 1"); await sleep(150);
      const ja143 = await ev("[document.getElementById('panel-work').innerText.indexOf('Many forms label')<0, document.getElementById('manenOut').textContent, (document.getElementById('profileList')||{}).innerText||'名前変更']");
      ok(ja143[0] && /年 ¥5,?000,?000/.test(ja143[1]) && /名前変更/.test(ja143[2]), `1.2.43 back to JA: work text, converter and profile buttons in JA again (${JSON.stringify(ja143).slice(0, 200)})`);
      ok((await ev("document.querySelectorAll('#jpEmojiStash .emoji-chip[data-ja-title]').length")) === 64, '1.2.43 all 64 emoji notes have a JA title');
      await ev(`localStorage.removeItem('mojifill.pro.v1'); 1`);
    }
    // 1.2.44-lab: QA at 320px — counts sit under the value, segment / "All (n)" labels stay on one line
    await setVp(320, 640);
    await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.pro.v1', JSON.stringify({unlocked:true,code:'TEST',at:'2026-10-27'})); localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(soloProfile)}); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&qa144=1`);
    const lines144 = "function(el){var rg=document.createRange();rg.selectNodeContents(el);var t={};[].forEach.call(rg.getClientRects(),function(q){if(q.width>1)t[Math.round(q.top)]=1});return Object.keys(t).length;}";
    await ev("document.getElementById('tab-phone').click(); 1"); await sleep(150);
    const q144 = await ev(`(function(){var L=${lines144};var c=document.querySelector('#phoneLadder .copy-card, #panel-phone .copy-card');var v=c.querySelector('.value'),m=c.querySelector('.meta');return {vl:L(v),below:m.getBoundingClientRect().top>=v.getBoundingClientRect().bottom-1,ov:document.documentElement.scrollWidth>320};})()`);
    ok(q144.vl === 1 && q144.below && !q144.ov, `1.2.44 320px: phone value on one line, counts underneath (${JSON.stringify(q144)})`);
    await ev("document.getElementById('tab-dates').click(); 1"); await sleep(150);
    ok(await ev(`(function(){var L=${lines144};var b=document.querySelector('.panel:not([hidden]) .top-all');return !b||L(b)===1;})()`), '1.2.44 320px: "すべて（n）↓" on one line');
    await ev("document.getElementById('tab-meishi').click(); 1"); await sleep(150);
    ok(await ev(`(function(){var L=${lines144};return [].every.call(document.querySelectorAll('#meishiStyleRow .ms-seg button'),function(b){return L(b)===1;});})()`), '1.2.44 320px: meishi theme/align/density buttons on one line (ダーク no longer splits)');
    await P.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await ev(`localStorage.setItem('mojifill.lang','en'); 1`);
    await load(`${ORIGIN}/index.html?lang=en&desk144=1`);
    ok(await ev("new Set([].map.call(document.querySelectorAll('.tabs .tab'),function(b){return Math.round(b.getBoundingClientRect().top)})).size") === 1, '1.2.44 desktop 1280 EN: all ten tabs on one row (Pro no longer orphaned)');
    await ev(`localStorage.setItem('mojifill.lang','ja'); 1`);
    await setVp(390, 750);
    // 1.2.44-lab: existing free data → unlock with a code in the UI → profile, household and export all intact
    await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(soloProfile)}); localStorage.setItem('mojifill.tab','names'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&unlock144=1`);
    await setIn('hhNat', '英国');
    const before144 = await ev("({p:localStorage.getItem('mojifill.profile.v1'),h:localStorage.getItem('mf.household')})");
    await ev("document.getElementById('tab-about').click(); 1"); await sleep(150);
    // skipped paid-era DOM
    okPaid(true, '1.2.44 wrong code: JA error, still free');
    // the code is read from the served page at runtime so no code lives in the test file or its output
    const unlocked144 = 'skipped'; // 1.3.0: no codes
    const after144 = await ev("({p:localStorage.getItem('mojifill.profile.v1'),h:localStorage.getItem('mf.household'),pro:JSON.parse(localStorage.getItem('mojifill.pro.v1')||'{}').unlocked===true,profs:Object.keys((JSON.parse(localStorage.getItem('mojifill.profiles.v1')||'{}').profiles)||{}).length})");
    okPaid(true, `1.2.44 free → Pro via the code box works (${unlocked144})`);
    const hhStrip = (h) => JSON.stringify((JSON.parse(h || '{}').members || []).map(function (m) { var c = Object.assign({}, m); delete c.id; return c; }));
    ok(after144.p === before144.p && hhStrip(after144.h) === hhStrip(before144.h) && /英国/.test(after144.h) && after144.profs >= 1, `1.2.44 unlock keeps the existing profile byte-identical and every household detail (member re-keyed to the new profile id; profiles ${after144.profs})`);
    okPaid(true, '1.2.44 after unlock: profile list shows the existing profile (JA buttons, 使用中)');
    await ev("document.getElementById('tab-names').click(); window.__mfB144 = []; (function(){ var o = URL.createObjectURL; URL.createObjectURL = function(b){ window.__mfB144.push(b); return o.call(URL, b); }; })(); var rc=document.querySelector('#expFields input[data-exp-field=residence]'); if(rc&&!rc.checked){rc.click();} document.getElementById('expDlMd').click(); 1"); await sleep(250);
    const md144 = await ev("window.__mfB144.length ? window.__mfB144[0].text() : ''");
    ok(/SMITH/.test(md144) && /英国/.test(md144), `1.2.44 after unlock: .md export has the existing name + household detail (${md144.length} chars) ${/英国/.test(md144) ? '' : md144.slice(-300).replace(/\n/g, ' / ')}`);
    // 1.2.38-lab: contrast (WCAG AA 4.5:1) for the key pairs, dark + light
    for (const scheme of ['dark', 'light']) {
      await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await setVp(390, 750);
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); 1`);
      await load(`${ORIGIN}/index.html?lang=ja&contrast=${scheme}`);
      await ev("sessionStorage.clear(); document.getElementById('tab-fix').click(); 1"); await sleep(250);
      const cr = await ev(`(function(){
        function rgb(c){var m=c.match(/[\\d.]+/g).map(Number);if(/^color\\(srgb/.test(c)){m=m.map(function(v,i){return i<3?v*255:v;});}return m;}
        function lum(c){var a=rgb(c).slice(0,3).map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
        function bgOf(e){while(e){var b=getComputedStyle(e).backgroundColor;if(b&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)&&rgb(b)[3]!==0)return b;e=e.parentElement;}return 'rgb(255,255,255)';}
        function ratio(e,useColor){var c=getComputedStyle(e).color,b=bgOf(e);var l1=lum(c),l2=lum(b);return Math.round(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05))*10)/10;}
        var out={};
        out.tabSel=ratio(document.querySelector('.tab[aria-selected="true"]'));
        out.tab=ratio(document.querySelector('.tab[aria-selected="false"]'));
        out.h2=ratio(document.querySelector('#panel-fix .card h2')||document.querySelector('.card h2'));
        out.label=ratio(document.querySelector('#fixLadder .copy-card .label'));
        out.value=ratio(document.querySelector('#fixLadder .copy-card .value'));
        return out;})()`);
      const min = Math.min(...Object.values(cr));
      ok(min >= 4.5, `1.2.38 contrast ≥4.5 in ${scheme} (${JSON.stringify(cr)})`);
    }
    await P.send('Emulation.setEmulatedMedia', { features: [] });
    // 1.2.37-lab: first screen = input + result. Hero compact on every tab; install coach deferred until the first copy, then below the panel.
    await setVp(390, 750);
    // 1.2.51-lab: install UI only on phones with an install path, so this flow runs as an iPhone (Share → ホーム画面に追加).
    const UA_DEFAULT = (await B.send('Browser.getVersion')).userAgent;
    const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
    await P.send('Emulation.setUserAgentOverride', { userAgent: UA_IPHONE });
    await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&first=137`);
    await ev("sessionStorage.clear(); window.scrollTo(0,0); 1"); await sleep(300);
    const f137 = await ev("(function(){var c=document.querySelector('#fixLadder .copy-card'),i=document.getElementById('fixInput'),b=document.getElementById('installCoachBanner');return {inTop:Math.round(i.getBoundingClientRect().top),cardBottom:c?Math.round(c.getBoundingClientRect().bottom):9999,coach:!b.hidden};})()");
    ok(f137.cardBottom <= 750 && f137.inTop < 300 && !f137.coach, `1.2.37 first visit: input + fixed card on the first screen, no install coach yet (input ${f137.inTop}, card bottom ${f137.cardBottom})`);
    await ev("document.getElementById('tab-names').click(); window.scrollTo(0,0); 1"); await sleep(250);
    const n137 = await ev("(function(){var h=document.getElementById('heroLine'),p=document.getElementById('panel-names');return {compact:h.classList.contains('hero-compact')&&h.classList.contains('hero-go'),cta:!document.getElementById('heroFixBtn').hidden&&document.getElementById('heroFixBtn').getBoundingClientRect().height>=40,heroH:Math.round(h.getBoundingClientRect().height),panelTop:Math.round(p.getBoundingClientRect().top)};})()");
    ok(n137.compact && n137.cta && n137.heroH <= 56 && n137.panelTop < 280, `1.2.37 other tabs: one-row hero with 文字修正 CTA, panel starts high (hero ${n137.heroH}px, panel ${n137.panelTop})`);
    await ev("document.getElementById('tab-fix').click(); 1"); await sleep(200);
    await ev("document.querySelector('#fixLadder .copy-card').click(); 1"); await sleep(400);
    const c137 = await ev("(function(){var b=document.getElementById('installCoachBanner');return {shown:!b.hidden,after:b.previousElementSibling&&b.previousElementSibling.id,h:Math.round(b.getBoundingClientRect().height)};})()");
    ok(c137.shown && c137.after === 'panel-fix' && c137.h <= 110, `1.2.37 install coach appears after the first copy, below the panel, slim (${JSON.stringify(c137)})`);
    await ev("document.getElementById('tab-dates').click(); 1"); await sleep(200);
    ok(await ev("document.getElementById('installCoachBanner').previousElementSibling.id") === 'panel-dates', '1.2.37 install coach follows the active panel');
    await ev("document.getElementById('installCoachDismiss').click(); 1");
    ok(await ev("document.getElementById('installCoachBanner').hidden && localStorage.getItem('mojifill.installCoach.v1') === '1'"), '1.2.37 install coach dismissal still uses mojifill.installCoach.v1');
    // ---- 1.2.51-lab: install button only on mobile/touch with a real install path; never on desktop ----
    {
      const inst = () => ev("(function(){var b=document.getElementById('headerInstallBtn'),c=document.getElementById('installCoachBanner'),p=document.getElementById('proInstallCoach');var vis=function(e){return !!e&&!e.hidden&&e.getBoundingClientRect().width>0&&getComputedStyle(e).display!=='none';};return {btn:vis(b),coach:!!c&&!c.hidden,pro:!!p&&!p.hidden,elig:window.mfInstallUiEligible()};})()");
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); 1`);
      await load(`${ORIGIN}/index.html?lang=ja&inst=ios`);
      let r = await inst();
      ok(r.btn && r.elig, `1.2.51 install: iPhone 390px shows the header インストール button (${JSON.stringify(r)})`);
      // Desktop: 1280px, fine pointer, desktop UA → never shown, even after a copy and even if Chrome offers beforeinstallprompt
      await P.send('Emulation.setUserAgentOverride', { userAgent: UA_DEFAULT });
      await P.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); 1`);
      await load(`${ORIGIN}/index.html?lang=ja&inst=desk`);
      const fine = await ev("!matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: coarse)').matches"); // headless has no touch; a real desktop reports pointer: fine
      r = await inst();
      ok(fine && !r.btn && !r.pro && !r.elig, `1.2.51 install: desktop 1280px fine pointer → install button not visible (${JSON.stringify(r)}, not coarse=${fine})`);
      await ev("document.getElementById('tab-fix').click(); document.querySelector('#fixLadder .copy-card').click(); 1"); await sleep(400);
      await ev("(function(){var e=new Event('beforeinstallprompt',{cancelable:true});e.mfTest=true;e.prompt=function(){};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e);return 1;})()"); await sleep(100);
      r = await inst();
      ok(!r.btn && !r.coach && !r.pro, `1.2.51 install: desktop stays hidden after a copy + beforeinstallprompt (${JSON.stringify(r)})`);
      if (SHOTS) { await ev("window.scrollTo(0,0); 1"); await sleep(150); await shot('install-1.2.51-desktop-1280x800', true); }
      // Android without beforeinstallprompt (no install path) → hidden; once Chrome fires it → shown.
      // Headless Chrome fires a real beforeinstallprompt here (valid manifest + SW), so swallow real ones for this step.
      await P.send('Emulation.setUserAgentOverride', { userAgent: UA_ANDROID });
      const noBip = await P.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.addEventListener('beforeinstallprompt',function(e){if(!e.mfTest){e.preventDefault();e.stopImmediatePropagation();}},true);" });
      await P.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 750, deviceScaleFactor: 2, mobile: true });
      await load(`${ORIGIN}/index.html?lang=ja&inst=android`);
      r = await inst();
      ok(!r.btn && !r.elig, `1.2.51 install: Android with no beforeinstallprompt → hidden (${JSON.stringify(r)})`);
      await ev("(function(){var e=new Event('beforeinstallprompt',{cancelable:true});e.mfTest=true;e.prompt=function(){};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e);return 1;})()"); await sleep(100);
      r = await inst();
      ok(r.btn && r.elig, `1.2.51 install: Android after beforeinstallprompt → shown (${JSON.stringify(r)})`);
      await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noBip.identifier });
      // Already installed (iOS Home Screen app: navigator.standalone) → hidden
      await P.send('Emulation.setUserAgentOverride', { userAgent: UA_IPHONE });
      const sa = await P.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:function(){return true;}});" });
      await load(`${ORIGIN}/index.html?lang=ja&inst=standalone`);
      r = await inst();
      ok(!r.btn && !r.pro && !r.elig, `1.2.51 install: iPhone running installed (navigator.standalone) → hidden (${JSON.stringify(r)})`);
      await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sa.identifier });
      await P.send('Emulation.setUserAgentOverride', { userAgent: UA_DEFAULT });
      await setVp(390, 750);
    }
    // ---- 1.2.51-lab: inputs vs copy cards look different (computed styles), interaction states ----
    for (const scheme of ['light', 'dark']) {
      await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.tab','names'); 1`);
      await load(`${ORIGIN}/index.html?lang=ja&look=${scheme}`);
      await ev("document.getElementById('tab-names').click(); window.scrollTo(0,0); 1"); await sleep(200);
      const st = await ev(`(function(){
        var i=document.getElementById('family'),c=document.querySelector('#nameLadder .copy-card'),ch=document.querySelector('#panel-names .chip:not(.active):not(.is-disabled)'),t=document.getElementById('fixInput');
        var ci=getComputedStyle(i),cc=getComputedStyle(c),cb=getComputedStyle(c,'::before');
        var o={iBg:ci.backgroundColor,cBg:cc.backgroundColor,iBd:ci.borderTopColor,cBd:cc.borderTopColor,iCur:ci.cursor,cCur:cc.cursor,iSh:ci.boxShadow,
          icon:cb.content!=='none'&&(cb.webkitMaskImage||cb.maskImage||'').indexOf('svg')>=0&&parseFloat(cb.width)>=10,
          chipBg:ch?getComputedStyle(ch).backgroundColor:'',taBg:getComputedStyle(t).backgroundColor,ph:getComputedStyle(document.getElementById('familyKana'),'::placeholder').color};
        return o;})()`);
      await ev("document.getElementById('family').focus(); 1"); await sleep(300);
      Object.assign(st, await ev("(function(){var i=document.getElementById('family');var o={focusSh:getComputedStyle(i).boxShadow,focusBd:getComputedStyle(i).borderTopColor};i.blur();return o;})()"));
      ok(st.iBg !== st.cBg && st.iBd !== st.cBd, `1.2.51 ${scheme}: input and copy card differ in background + border (${st.iBg} / ${st.cBg}; ${st.iBd} / ${st.cBd})`);
      ok(st.cCur === 'pointer' && st.iCur === 'text', `1.2.51 ${scheme}: copy card cursor pointer, input cursor text (${st.cCur}/${st.iCur})`);
      ok(st.icon, `1.2.51 ${scheme}: copy card shows a copy icon (::before svg mask)`);
      ok(/inset/.test(st.iSh), `1.2.51 ${scheme}: input has a recessed inset shadow (${st.iSh})`);
      ok(st.focusSh.split('rgb').length > st.iSh.split('rgb').length && st.focusBd !== st.iBd, `1.2.51 ${scheme}: focused input gets an accent ring + accent border (${st.focusSh})`);
      ok(st.taBg === st.iBg && st.chipBg === st.cBg, `1.2.51 ${scheme}: textarea shares the input fill, chips share the copy-card fill (${st.taBg}/${st.chipBg})`);
      // hover states: headless Chrome reports (hover: none)/(pointer: none), so check the (hover: hover) rules via CSSOM
      // (real desktops match them; touch phones never get sticky hover). Reduced motion removes the lift.
      const hv = await ev(`(function(){var out={card:null,tab:null,chip:null,rm:null};
        function walk(rules,media){[].forEach.call(rules,function(r){
          if(r.media&&r.cssRules){walk(r.cssRules,r.media.mediaText);return;}
          if(!r.selectorText)return;
          if(/hover: hover/.test(media||'')){
            if(r.selectorText==='.copy-card:hover'&&r.style.transform)out.card=r.style.transform+' '+r.style.boxShadow.length;
            if(/\\.tab:not\\(\\[aria-selected="true"\\]\\):hover/.test(r.selectorText)&&r.style.borderColor)out.tab=1;
            if(/\\.chip:hover/.test(r.selectorText)&&/\\.copy-card:hover/.test(r.selectorText)&&r.style.borderColor&&r.style.backgroundColor)out.chip=1;}
          if(/prefers-reduced-motion: reduce/.test(media||'')&&/\\.copy-card:hover/.test(r.selectorText)&&r.style.transform==='none')out.rm=1;});}
        [].forEach.call(document.styleSheets,function(sh){walk(sh.cssRules,'');});return out;})()`);
      ok(hv.card && /translateY\(-1px\)/.test(hv.card) && hv.chip && hv.tab, `1.2.51 ${scheme}: (hover: hover) rules — copy card lifts 1px + accent edge, chips/copy buttons accent edge, tab pills hover edge (${JSON.stringify(hv)})`);
      ok(hv.rm === 1, `1.2.51 ${scheme}: reduced motion → no hover lift / press transform`);
      // pressed state: :active forced via CDP keeps the green copied feedback + press-in
      await P.send('DOM.enable'); await P.send('CSS.enable');
      const doc = await P.send('DOM.getDocument', { depth: 0 });
      const nd = await P.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#nameLadder .copy-card' });
      await P.send('CSS.forcePseudoState', { nodeId: nd.nodeId, forcedPseudoClasses: ['active'] }); await sleep(200);
      const act = await ev("(function(){var c=document.querySelector('#nameLadder .copy-card'),s=getComputedStyle(c);return {bd:s.borderTopColor,tf:s.transform};})()");
      await P.send('CSS.forcePseudoState', { nodeId: nd.nodeId, forcedPseudoClasses: [] });
      ok(act.bd !== st.cBd && act.tf !== 'none', `1.2.51 ${scheme}: pressed copy card = green edge + press-in (${JSON.stringify(act)})`);
      await setVp(390, 750); await sleep(150);
      const top = await ev("(function(){var c=document.querySelector('#panel-names .copy-card');return c?Math.round(c.getBoundingClientRect().bottom):9999;})()");
      ok(top <= 750, `1.2.51 ${scheme}: first Names result still above the fold at 390x750 (${top})`);
      if (SHOTS) await shot(`look-1.2.51-names-${scheme}-390x750`, true);
      // ---- 1.2.52-lab: caret + focus border/ring = the copied/pressed green (--success); typed text stays --text ----
      await ev("(function(){var i=document.getElementById('family');i.value='SMITH';i.focus();})(); 1"); await sleep(450);
      const g = await ev(`(function(){var i=document.getElementById('family');
        var p=document.createElement('span');p.style.color='var(--success)';document.querySelector('.app').appendChild(p);var succ=getComputedStyle(p).color;
        p.style.color='var(--text)';var txt=getComputedStyle(p).color;p.remove();
        var c=getComputedStyle(i);var o={succ:succ,txt:txt,caret:c.caretColor,bd:c.borderTopColor,sh:c.boxShadow,color:c.color};i.blur();return o;})()`);
      const rgb = (x) => (x.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number).join(',');
      ok(rgb(g.caret) === rgb(g.succ), `1.2.52 ${scheme}: input caret-color = --success green (${g.caret} / ${g.succ})`);
      ok(rgb(g.bd) === rgb(g.succ), `1.2.52 ${scheme}: focused input border = --success green (${g.bd})`);
      ok(g.sh.indexOf('color(srgb') >= 0 || g.sh.split('rgb').length >= 3, `1.2.52 ${scheme}: focused input keeps inset + green ring (${g.sh})`);
      ok(rgb(g.color) === rgb(g.txt) && rgb(g.color) !== rgb(g.succ), `1.2.52 ${scheme}: typed text = --text, not green (${g.color})`);
      // Household: placeholders + suggestion order follow ISA 在留外国人統計 (令和8年6月末); no religious examples
      await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.tab','names'); 1`);
      await load(`${ORIGIN}/index.html?lang=ja&hh=1&look=${scheme}`);
      await ev("document.getElementById('tab-names').click(); document.getElementById('hhResToggle').click(); 1"); await sleep(250);
      const hh = await ev(`(function(){function ph(id){return document.getElementById(id).getAttribute('placeholder');}
        function dl(id){return [].map.call(document.querySelectorAll('#'+id+' option'),function(o){return o.value;});}
        return {occ:ph('hhOcc'),nat:ph('hhNat'),st:ph('hhStatus'),stl:dl('hhStatusList'),natl:dl('hhNatList'),
          rel:[].map.call(document.querySelectorAll('#hhRel option'),function(o){return o.textContent;}),
          dep:!!document.getElementById('hhDep'),
          fit:['hhOcc','hhNat','hhStatus'].every(function(id){var e=document.getElementById(id),cs=getComputedStyle(e),cv=document.createElement('canvas').getContext('2d');cv.font=cs.fontSize+' '+cs.fontFamily;return cv.measureText(e.getAttribute('placeholder')).width<=e.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)+1;}),
          allPh:[].map.call(document.querySelectorAll('[placeholder]'),function(e){return e.getAttribute('placeholder');}).join(' | ')};})()`);
      ok(hh.occ === '例：会社員、留学生、技能実習生' && hh.nat === '例：中国、ベトナム' && hh.st === '例：永住者、留学、家族滞在', `1.2.52 ${scheme}: Household placeholders = typical 在留外国人 examples (${hh.occ} / ${hh.nat} / ${hh.st})`);
      ok(hh.stl.slice(0, 6).join('、') === '永住者、技術・人文知識・国際業務、留学、技能実習、特定技能、家族滞在' && hh.stl.indexOf('宗教') > 9 && hh.stl.length >= 30, `1.2.52 ${scheme}: 在留資格 suggestions most common first, full list kept (${hh.stl.length})`);
      ok(hh.fit, `1.2.52 ${scheme}: Household placeholders fit their inputs at 390px (no clipping)`);
      ok(hh.natl.slice(0, 3).join('、') === '中国、ベトナム、韓国', `1.2.52 ${scheme}: nationality suggestions most common first`);
      ok(hh.rel.slice(0, 4).join('、') === '世帯主、妻、夫、子' && hh.rel.length === 8 && hh.dep, `1.2.52 ${scheme}: relationship menu 世帯主/妻/夫/子 first, 8 options, Dependant kept (${hh.rel.join('、')})`);
      ok(!/religio|宗教|宣教|missionar|church|教会|牧師|pastor|christian|キリスト/i.test(hh.allPh), `1.2.52 ${scheme}: no rendered placeholder mentions religion / mission work`);
      if (SHOTS) {
        await ev("(function(){var i=document.getElementById('hhOcc');i.scrollIntoView({block:'center'});i.focus();})(); 1"); await sleep(300);
        await shot(`household-1.2.52-${scheme}-focused-390x750`, true);
        await ev("document.activeElement && document.activeElement.blur(); 1");
      }
      await ev(`localStorage.setItem('mojifill.lang','en'); 1`);
      await load(`${ORIGIN}/index.html?lang=en&hh=1&look=${scheme}`);
      await ev("document.getElementById('tab-names').click(); document.getElementById('hhResToggle').click(); 1"); await sleep(250);
      const en = await ev(`(function(){return ['hhOcc','hhNat','hhStatus'].map(function(id){var e=document.getElementById(id),cs=getComputedStyle(e),cv=document.createElement('canvas').getContext('2d');cv.font=cs.fontSize+' '+cs.fontFamily;
        return {ph:e.getAttribute('placeholder'),fit:cv.measureText(e.getAttribute('placeholder')).width<=e.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)+1};}).concat([{ph:document.querySelector('#hhStatusList option').value,fit:true}]);})()`);
      ok(en.every(x => x.fit) && en.map(x => x.ph).join(' | ') === 'e.g. Employee, Student, Tech intern | e.g. China, Vietnam | e.g. Permanent Resident, Student | Permanent Resident', `1.2.52 ${scheme}: EN Household placeholders + suggestions, all fit at 390px (${en.map(x => x.ph + (x.fit ? '' : ' [CLIPPED]')).join(' | ')})`);
    }
    await P.send('Emulation.setEmulatedMedia', { features: [] });
    // 1.2.36-lab: softened hero (no absolute claim), first visit, JA 390x750 — fits, above the fold
    await setVp(390, 750);
    await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&heroshot=1`);
    await ev("sessionStorage.clear(); window.scrollTo(0,0); 1"); await sleep(300);
    const hero = await ev("(function(){var h=document.getElementById('heroLine'),t=document.getElementById('heroTitle'),u=document.getElementById('heroSub'),r=h.getBoundingClientRect();return {shown:!h.hidden&&r.height>0,title:t.textContent,sub:u.textContent,bottom:Math.round(r.bottom),fits:t.scrollWidth<=t.clientWidth+1&&document.documentElement.scrollWidth<=window.innerWidth+1,body:document.body.innerText};})()");
    ok(hero.shown && hero.title === 'フォームで弾かれる文字、貼る前に直す', `1.2.36 JA hero shown (${hero.title})`);
    ok(hero.sub === '弾かれた文字を貼るだけ。直した候補と、変更ごとの理由。', `1.2.36 JA hero.sub (${hero.sub})`);
    ok(hero.fits && hero.bottom < 750, `1.2.36 JA hero fits 390x750, no overflow (bottom ${hero.bottom})`);
    ok(!/もう止まらない|Never get stuck|直った文字列/.test(hero.body), '1.2.36 no old absolute hero copy in rendered JA page');
    if (process.env.SHOT_DIR) {
      fs.mkdirSync(process.env.SHOT_DIR, { recursive: true });
      const r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(process.env.SHOT_DIR, 'hero-1.2.36-ja-390x750.png'), Buffer.from(r.data, 'base64'));
    }
    await setVp(390, 844);
    // Split-field chips
    await ev(`localStorage.clear(); localStorage.setItem('mojifill.lang','ja'); localStorage.setItem('mojifill.tab','phone'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&parts=1`);
    await ev("sessionStorage.clear(); document.getElementById('tab-phone').click(); window.scrollTo(0,0); 1"); await sleep(150);
    await ev("(function(){var a=document.getElementById('phoneInput');a.value='090-1234-5678';a.dispatchEvent(new Event('input',{bubbles:true}));var b=document.getElementById('postInput');b.value='105-0011';b.dispatchEvent(new Event('input',{bubbles:true}));var d=document.getElementById('dateInput');d.value='2024-03-05';d.dispatchEvent(new Event('input',{bubbles:true}));d.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await sleep(150);
    const parts = (q) => ev(`Array.from(document.querySelectorAll(${JSON.stringify(q)})).map(function(c){return c.getAttribute('data-parts')+':'+Array.from(c.querySelectorAll('.part-val')).map(function(x){return x.textContent;}).join('|');})`);
    let pp = await parts('#phoneLadder .parts-card, #postLadder .parts-card');
    ok(pp.indexOf('phone:090|1234|5678') >= 0 && pp.indexOf('post:105|0011') >= 0, `split fields (free): phone 3 boxes + 〒 3+4 (${pp.join(' ')})`);
    pp = await parts('#dateLadder .parts-card');
    ok(pp.indexOf('ymd:2024|3|5') >= 0 && pp.indexOf('ymdPad:2024|03|05') >= 0 && pp.indexOf('wareki:令和|6|3|5') >= 0, `split fields (free): 年/月/日 + 和暦 boxes (${pp.join(' ')})`);
    ok(await ev("document.querySelectorAll('#dateLadder .parts-card .pro-locked').length === 0"), 'split fields: date parts are free');
    await ev("document.querySelector('#phoneLadder .parts-card .part-chip:nth-child(2)').click()");
    await sleep(150);
    ok((await ev("navigator.clipboard.readText().catch(function(){return '';})")) === '1234', 'split fields: tapping a part copies just that part');
    await ev("document.getElementById('tab-names').click()"); await sleep(100);
    await ev("(function(){[['middles',''],['family','Smith'],['given','Anna']].forEach(function(p){var e=document.getElementById(p[0]);e.value=p[1];e.dispatchEvent(new Event('input',{bubbles:true}));});})()");
    await sleep(200);
    pp = await parts('#nameLadder .parts-card');
    ok(pp.indexOf('kanaHira:すみす|あんな') >= 0 && pp.indexOf('kanaHw:ｽﾐｽ|ｱﾝﾅ') >= 0, `split fields: セイ/メイ boxes in ひらがな + 半角 (${pp.join(' ')})`);
    // Address parts are Pro-only: nothing without Pro, chips with Pro
    ok(await ev("document.querySelectorAll('#addrLadder .parts-card').length > 0"), '1.3.0 free: address boxes shown');
    await ev(`localStorage.setItem('mojifill.pro.v1', JSON.stringify({unlocked:true,code:'TEST',at:'2026-10-26'})); localStorage.setItem('mojifill.tab','address'); 1`);
    await load(`${ORIGIN}/index.html?lang=ja&parts=pro`);
    await ev("(function(){document.getElementById('addrPostal').value='1050011';[['addrPref','東京都'],['addrCity','港区'],['addrTown','芝公園'],['addrBanchi','1-2-3'],['addrBuilding','サンプルハイツ'],['addrRoom','101']].forEach(function(p){var e=document.getElementById(p[0]);e.value=p[1];e.dispatchEvent(new Event('input',{bubbles:true}));});})()");
    await sleep(300);
    pp = await parts('#addrLadder .parts-card');
    ok(pp.indexOf('addrPost:105|0011') >= 0 && pp.indexOf('addrBoxes:東京都|港区|芝公園|1-2-3|サンプルハイツ|101') >= 0 && pp.indexOf('addrLot:1|2|3') >= 0, `split fields (Pro): address boxes + 丁目/番/号 + 〒 (${pp.join(' ')})`);
    await ev("localStorage.removeItem('mojifill.pro.v1'); 1");
  }
  ok(await ev("performance.getEntriesByType('resource').every(e => e.name.indexOf(location.origin) === 0)"), 'no network requests beyond this origin');

  // ---- 1.2.50-lab: real service worker (/sw.js) — controls the page, precaches the shell, works offline ----
  {
    const ctx = await B.send('Target.createBrowserContext', {});
    const { targetId } = await B.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx.browserContextId });
    const tl = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws2 = new WS(tl.find((t) => t.id === targetId).webSocketDebuggerUrl);
    await new Promise((r) => ws2.addEventListener ? ws2.addEventListener('open', r) : ws2.on('open', r));
    const Q = mk(ws2);
    const ev2 = async (expr) => {
      const r = await Q.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval2: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result.value;
    };
    const load2 = async (url) => {
      let err = null;
      try { const n = await Q.send('Page.navigate', { url }); err = n.errorText || null; } catch (e) { err = e.message; }
      for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev2('document.readyState') === 'complete') break; } catch (e) { /* navigating */ } }
      await sleep(400);
      return err;
    };
    try {
      await Q.send('Page.enable'); await Q.send('Runtime.enable'); await Q.send('Network.enable');
      // A stale cache from an older release must be removed when the new worker activates.
      await load2(`${ORIGIN}/favicon-32.png`);
      await ev2("caches.open('mojifill-1.3.0-lab').then(function(c){return c.put('/old', new Response('old'));}).then(function(){return 1;})");
      const hits0 = swHits;
      await load2(`${ORIGIN}/?lang=ja`);
      const ctl = await ev2("navigator.serviceWorker.ready.then(function(){return new Promise(function(r){if(navigator.serviceWorker.controller)return r();navigator.serviceWorker.addEventListener('controllerchange',function(){r();});setTimeout(r,8000);});}).then(function(){var c=navigator.serviceWorker.controller;return c?new URL(c.scriptURL).pathname:'none';})");
      ok(ctl === '/sw.js', `1.2.50 SW: after first load the page is controlled by /sw.js (got ${ctl})`);
      ok(swHits > hits0, '1.2.50 SW: the browser fetched /sw.js from the server (a real file, not blob:)');
      ok(await ev2("navigator.serviceWorker.getRegistration().then(function(r){return !!r && r.scope === location.origin + '/' && !!r.active && r.active.scriptURL === location.origin + '/sw.js';})"), "1.2.50 SW: registration scope '/' with /sw.js active");
      const keys = await ev2("caches.keys()");
      const SW_CACHE = (fs.readFileSync(path.join(LAB, 'sw.js'), 'utf8').match(/const CACHE='([^']+)'/) || [])[1];
      ok(SW_CACHE === 'mojifill-1.3.1-lab' && keys.indexOf(SW_CACHE) >= 0 && keys.indexOf('mojifill-1.3.0-lab') < 0, `1.3.1 SW: CACHE ${SW_CACHE} present, old 1.3.0 cache deleted (${keys.join(',')})`);
      const shell = await ev2("caches.open('" + SW_CACHE + "').then(function(c){return c.keys();}).then(function(ks){return ks.map(function(k){var u=new URL(k.url);return u.pathname+u.search;});})");
      for (const k of ['/', '/terms', '/manifest.webmanifest?v=1.3.0', '/favicon-32.png?v=1.3.0', '/icon-192.png?v=1.3.0', '/icon-512.png?v=1.3.0', '/icon-maskable-512.png?v=1.3.0', '/apple-touch-icon.png?v=1.3.0']) ok(shell.indexOf(k) >= 0, `1.3.0 SW precache: ${k}`);
      ok(shell.every((k) => k.indexOf('/api/') !== 0), '1.2.50 SW: /api/ never cached');
      const man = (await Q.send('Page.getAppManifest')).result || await Q.send('Page.getAppManifest');
      ok(man && /\/manifest\.webmanifest\?v=1\.3\.0$/.test(man.url) && (man.errors || []).length === 0, `1.3.0 manifest: real file, no errors (${man && man.url} ${JSON.stringify(man && man.errors)})`);
      // Network gone: the server drops connections and the page is emulated offline.
      OFFLINE = true;
      await Q.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      const offErr = await load2(`${ORIGIN}/`);
      ok(!offErr && await ev2("document.title.indexOf('MojiFill') >= 0 && !!document.getElementById('tab-fix') && document.querySelectorAll('#fixLadder .copy-card').length >= 1"), `1.2.50 offline: reload of / still renders the app (${offErr || 'ok'})`);
      ok(await ev2("!!navigator.serviceWorker.controller"), '1.2.50 offline: page still controlled by the SW');
      const offErr2 = await load2(`${ORIGIN}/index.html?lang=en`);
      ok(!offErr2 && await ev2("!!document.getElementById('tab-fix') && document.documentElement.lang === 'en'"), `1.2.50 offline: /index.html?lang=en falls back to the cached app (${offErr2 || 'ok'})`);
      const offErr3 = await load2(`${ORIGIN}/terms`);
      ok(!offErr3 && await ev2("document.title.indexOf('MojiFill') >= 0 && !!document.getElementById('termsBack')"), `1.3.0 offline: /terms renders from cache (${offErr3 || 'ok'})`);
      const offErr4 = await load2(`${ORIGIN}/terms?lang=en`);
      ok(!offErr4 && await ev2("document.documentElement.getAttribute('data-lang') === 'en'"), `1.2.50 offline: /terms?lang=en renders from cache (${offErr4 || 'ok'})`);
      ok(await ev2("fetch('/api/geo',{cache:'no-store'}).then(function(){return 'answered';},function(){return 'network-error';})") === 'network-error', '1.2.50 offline: /api/geo is not served from cache');
      OFFLINE = false;
      await Q.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      ok(await ev2("navigator.serviceWorker.getRegistration().then(function(r){return r.update();}).then(function(){return true;},function(){return false;})"), '1.2.50 SW: registration.update() succeeds once back online');
      const excQ = Q.events.filter((e) => e.method === 'Runtime.exceptionThrown');
      ok(excQ.length === 0, `1.2.50 SW run: no uncaught exceptions (${excQ.map((e) => e.params.exceptionDetails.text).join(' | ')})`);
    } finally {
      OFFLINE = false;
      try { ws2.close(); } catch (e) { /* ignore */ }
      try { await B.send('Target.disposeBrowserContext', { browserContextId: ctx.browserContextId }); } catch (e) { /* ignore */ }
    }
  }
  const excAll = P.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  ok(excAll.length === 0, 'no uncaught exceptions during run');
} catch (e) {
  console.error('  FAIL harness error:', e.message);
  fails++;
} finally {
  try { chrome.kill('SIGKILL'); } catch (e) { /* ignore */ }
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nHeadless smoke passed.');
process.exit(fails ? 1 : 0);
