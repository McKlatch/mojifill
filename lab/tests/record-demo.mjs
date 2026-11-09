#!/usr/bin/env node
/**
 * 1.3.2-lab: record the how-it-works demo from the lab page (headless Chrome, neutral demo text).
 * usage: node lab/tests/record-demo.mjs <outDir> [url]   → <outDir>/{desktop,mobile}/f###.png + timings.txt
 * Then lab/tests/build-demo.sh <outDir> encodes WebP / GIF / PNG still into lab/demo/.
 * Demo text: "サトウ  エマ" with an invisible zero-width space + ① (a typical form-rejected paste), name Sato Emma.
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
for (const p of ['ws', path.join(os.homedir(), '.local/lib/node_modules/ws')]) { try { WS = require(p); break; } catch (e) { /* next */ } }
if (!WS && typeof WebSocket !== 'undefined') WS = WebSocket;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || '/tmp/mf-demo';
let URL0 = process.argv[3] || '';
let server = null;
if (!URL0) {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/api/geo') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"country":"JP"}'); return; }
    const f = path.join(LAB, u === '/' ? 'index.html' : u);
    if (!f.startsWith(LAB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  URL0 = `http://127.0.0.1:${server.address().port}/`;
}
const pd = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-rec-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${pd}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res) => { let b = ''; chrome.stderr.on('data', (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); });
const port = new URL(wsUrl).port;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WS(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener ? ws.addEventListener('open', r) : ws.on('open', r));
let id = 0; const pend = new Map();
const onMsg = (raw) => { const m = JSON.parse(typeof raw === 'string' ? raw : (raw.data !== undefined ? raw.data : raw.toString())); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
if (ws.on) ws.on('message', onMsg); else ws.addEventListener('message', onMsg);
const send = (method, params = {}) => new Promise((res, rej) => { id++; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
await send('Page.enable'); await send('Runtime.enable');
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});

const TAP_CSS = `#mfTap{position:fixed;z-index:99999;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(232,115,90,.35);border:2px solid rgba(232,115,90,.9);pointer-events:none;transition:transform .15s ease,opacity .2s ease;opacity:0}`;
async function run(kind, W, H, dsf) {
  const dir = path.join(OUT, kind); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let n = 0;
  async function snap(ms) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = `f${String(n++).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(dir, f), Buffer.from(r.data, 'base64'));
    frames.push([f, ms]);
  }
  async function tap(sel, hold) {
    await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});var r=e.getBoundingClientRect();var t=document.getElementById('mfTap');t.style.left=(r.left+Math.min(r.width/2,120))+'px';t.style.top=(r.top+r.height/2)+'px';t.style.opacity='1';t.style.transform='scale(1)';return 1})()`);
    await sleep(120); await snap(380);
    await ev(`(function(){var t=document.getElementById('mfTap');t.style.transform='scale(.7)';document.querySelector(${JSON.stringify(sel)}).click();return 1})()`);
    await sleep(90); await snap(hold || 900);
    await ev(`(function(){document.getElementById('mfTap').style.opacity='0';return 1})()`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dsf, mobile: W < 600 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: URL0 }); await sleep(1200);
  await ev(`(function(){localStorage.clear();sessionStorage.clear();localStorage.setItem('mojifill.lang','en');localStorage.setItem('mojifill.installCoach.v1','1');localStorage.setItem('mojifill.tab','fix');return 1})()`);
  await send('Page.navigate', { url: URL0 + '?demo-rec=1' }); await sleep(1500);
  await ev(`(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(TAP_CSS)}+'.lab-banner{display:none!important}';document.head.appendChild(s);var t=document.createElement('div');t.id='mfTap';document.body.appendChild(t);
    var c=document.getElementById('fixClearBtn'); if(c) c.click(); var i=document.getElementById('fixInput'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); i.blur(); window.scrollTo(0,0); return 1})()`);
  await sleep(300); await snap(900);
  // paste the rejected text
  await ev(`(function(){var i=document.getElementById('fixInput');i.focus();i.value='サトウ　　エマ\\u200b ①';i.dispatchEvent(new Event('input',{bubbles:true}));i.blur();return 1})()`);
  await sleep(250); await snap(1600);
  await tap('#fixLadder .copy-card', 1300);
  await sleep(1600);
  // Names
  await ev(`(function(){document.getElementById('tab-names').click();var f=document.getElementById('family'),g=document.getElementById('given'),m=document.getElementById('middles');[f,g,m].forEach(function(x){x.value='';x.dispatchEvent(new Event('input',{bubbles:true}));});window.scrollTo(0,0);return 1})()`);
  await sleep(300); await snap(600);
  for (const [fid, word] of [['family', 'Sato'], ['given', 'Emma']]) {
    for (let k = 1; k <= word.length; k++) {
      await ev(`(function(){var f=document.getElementById('${fid}');f.value=${JSON.stringify(word.slice(0, k))};f.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
      await sleep(60); await snap(150);
    }
  }
  await ev(`(function(){document.activeElement&&document.activeElement.blur();return 1})()`);
  await sleep(250); await snap(1300);
  const cardSel = W >= 1024 ? '#nameLadder .copy-card' : '#top-names .copy-card';
  await tap(cardSel, 1500);
  fs.writeFileSync(path.join(dir, 'timings.txt'), frames.map(([f, ms]) => `${f} ${ms}`).join('\n') + '\n');
  console.log(kind, frames.length, 'frames');
}
await run('desktop', 1280, 800, 1);
await run('mobile', 390, 693, 2);
ws.close(); chrome.kill('SIGKILL'); if (server) server.close();
process.exit(0);
