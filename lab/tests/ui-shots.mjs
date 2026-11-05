#!/usr/bin/env node
/**
 * MojiFill lab — UI audit + per-tab screenshots (overnight UI pass, 1.2.37+). Not a test; prints metrics.
 * usage: node lab/tests/ui-shots.mjs <tag> [outDir]   e.g. before-1.2.36 → shots/ui-<tab>-before-1.2.36-ja-390x750.png
 * env VP=390x750 (default), LANGS=ja, PRO=1 to unlock Pro (test code), FIRST=1 to skip the install-banner dismissal.
 *
 * (harness below copied from headless-smoke (Chrome via CDP, no npm deps beyond `ws`).
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
function ok(cond, msg) { if (cond) console.log('  PASS', msg); else { console.error('  FAIL', msg); fails++; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1.2.34-lab: mock of the Cloudflare Pages Function /api/geo. 'ERR500' → 500, 'DROP' → connection reset, else {country}.
let GEO = 'JP';
let geoHits = 0;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/api/geo') {
    geoHits++;
    if (GEO === 'DROP') { req.socket.destroy(); return; }
    if (GEO === 'ERR500') { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('err'); return; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ country: GEO }));
    return;
  }
  const f = path.join(LAB, u === '/' ? 'index.html' : u);
  if (!f.startsWith(LAB) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || /\.(md|mjs|sh|txt)$/.test(f)) { res.writeHead(404); res.end(); return; }
  const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream';
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


const TAG = process.argv[2] || 'now';
const OUT = process.argv[3] || path.join(LAB, 'shots');
const [VW, VH] = (process.env.VP || '390x750').split('x').map(Number);
const LANG = process.env.LANGS || 'ja';
fs.mkdirSync(OUT, { recursive: true });
const PROFILE = JSON.stringify({ v: 1, family: 'SMITH', given: 'ANNA', middles: [], familyKana: 'スミス', givenKana: 'アンナ' });
const DEMO = {
  fix: "(function(){var i=document.getElementById('fixInput');i.value='スミス　　ジョ二ー\\u200b';i.dispatchEvent(new Event('input',{bubbles:true}));i.blur();})()",
  names: "1",
  furigana: "(function(){var i=document.getElementById('furiInput');i.value='スミス アンナ';i.dispatchEvent(new Event('input',{bubbles:true}));i.blur();})()",
  dates: "(function(){var d=document.getElementById('dateInput');d.value='1990-04-12';d.dispatchEvent(new Event('input',{bubbles:true}));d.dispatchEvent(new Event('change',{bubbles:true}));d.blur();})()",
  phone: "(function(){var a=document.getElementById('phoneInput');a.value='090-1234-5678';a.dispatchEvent(new Event('input',{bubbles:true}));var b=document.getElementById('postInput');b.value='105-0011';b.dispatchEvent(new Event('input',{bubbles:true}));b.blur();})()",
  work: "1", address: "1", meishi: "1", marks: "1", pro: "1",
};
const TABS = (process.env.TABS || 'fix,names,furigana,dates,phone,work,address,meishi,marks,pro').split(',');
const METRICS = `(function(){
  var vh=window.innerHeight, vw=window.innerWidth, p=document.querySelector('.panel:not([hidden])');
  var small=[]; document.querySelectorAll('button,a[href],[role=button],input[type=checkbox],input[type=radio],select,summary,.copy-card,.part-chip').forEach(function(e){var r=e.getBoundingClientRect(); if(!r.width||!r.height||r.bottom<0||r.top>vh) return; var cs=getComputedStyle(e); if(cs.visibility==='hidden') return; if(r.height<44||r.width<44) small.push((e.id||e.className||e.tagName).toString().slice(0,28)+':'+Math.round(r.width)+'x'+Math.round(r.height));});
  var card=p&&p.querySelector('.copy-card'); var cr=card&&card.getBoundingClientRect();
  var cards=p?p.querySelectorAll('.copy-card').length:0;
  var radii={}; if(p) p.querySelectorAll('.card,.copy-card,.parts-card,details,.callout,.note').forEach(function(e){var cs=getComputedStyle(e); if(e.getBoundingClientRect().height) radii[cs.borderRadius]=(radii[cs.borderRadius]||0)+1;});
  var fonts={}; if(p) p.querySelectorAll('h2,h3,.card-title,.label,.copy-card .value').forEach(function(e){var cs=getComputedStyle(e); if(e.getBoundingClientRect().height) fonts[e.tagName+'/'+(e.className||'').toString().split(' ')[0]+'='+cs.fontSize+'/'+cs.fontWeight]=1;});
  var chips=p?p.querySelectorAll('.chip,.seg button,.part-chip,[class*=chip]').length:0;
  return {firstCardTop:cr?Math.round(cr.top):null, firstCardBottom:cr?Math.round(cr.bottom):null, cards:cards, panelTop:p?Math.round(p.getBoundingClientRect().top):null, docH:document.documentElement.scrollHeight, hOverflow:document.documentElement.scrollWidth>vw+1, small:small.length, smallList:small.slice(0,12), radii:radii, fonts:Object.keys(fonts), chips:chips, install:(function(){var b=document.querySelector('.install-banner,#installBanner,#installCoach');if(!b)return null;var r=b.getBoundingClientRect();return r.height?Math.round(r.height):0;})()};
})()`;
try {
  await B.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await P.send('Page.enable'); await P.send('Runtime.enable');
  await P.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: VW < 800 });
  if (process.env.SCHEME) await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.SCHEME }].concat(process.env.REDUCED ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : []) });
  else if (process.env.REDUCED) await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const report = {};
  for (const tab of TABS) {
    await load(`${ORIGIN}/index.html?lang=${LANG}`);
    const pro = process.env.PRO ? `localStorage.setItem('mojifill.pro.v1', JSON.stringify({unlocked:true,code:'TEST',at:'2026-10-27'}));` : '';
    await ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('mojifill.lang','${LANG}'); localStorage.setItem('mojifill.tab','${tab}'); localStorage.setItem('mojifill.profile.v1', ${JSON.stringify(PROFILE)}); ${pro} 1`);
    await load(`${ORIGIN}/index.html?lang=${LANG}&ui=${tab}`);
    await ev(`(function(){var t=document.getElementById('tab-${tab}'); if(t) t.click(); window.scrollTo(0,0); return 1;})()`);
    await sleep(200);
    await ev(DEMO[tab] || '1');
    await sleep(350);
    await ev('window.scrollTo(0,0); document.activeElement && document.activeElement.blur && document.activeElement.blur(); 1');
    await sleep(150);
    report[tab] = await ev(METRICS);
    const r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `ui-${tab}-${TAG}-${LANG}${process.env.SCHEME ? '-' + process.env.SCHEME : ''}-${VW}x${VH}.png`), Buffer.from(r.data, 'base64'));
  }
  for (const [k, v] of Object.entries(report)) console.log(k.padEnd(9), JSON.stringify(v));
} finally {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  server.close();
}
process.exit(0);
