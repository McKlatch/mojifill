#!/usr/bin/env node
/**
 * 1.3.1-lab design pass — screenshots of any MojiFill URL (deployed lab or local server) at a viewport + colour scheme.
 * usage: node lab/tests/design-shots.mjs <url> <outDir> [spec ...]
 *   spec = tab:WxH:scheme:lang[:full]   e.g. names:1440x900:light:en  meishi:1440x900:dark:ja  fix:390x750:dark:ja
 * Not part of deploy-lab.sh. Needs Chrome + `ws` (same as headless-smoke).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let WS;
for (const p of ['ws', path.join(os.homedir(), '.local/lib/node_modules/ws')]) { try { WS = require(p); break; } catch (e) { /* next */ } }
if (!WS && typeof WebSocket !== 'undefined') WS = WebSocket;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [URL0, OUT, ...SPECS] = process.argv.slice(2);
if (!URL0 || !OUT) { console.error('usage: design-shots.mjs <url> <outDir> spec...'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''; const to = setTimeout(() => reject(new Error('chrome did not start')), 20000);
  chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); resolve(m[1]); } });
});
const port = new URL(wsUrl).port;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WS(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener ? ws.addEventListener('open', r) : ws.on('open', r));
let id = 0; const pend = new Map();
const onMsg = (raw) => { const msg = JSON.parse(typeof raw === 'string' ? raw : (raw.data !== undefined ? raw.data : raw.toString())); if (msg.id && pend.has(msg.id)) { const p = pend.get(msg.id); pend.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); } };
if (ws.on) ws.on('message', onMsg); else ws.addEventListener('message', onMsg);
const send = (method, params = {}) => new Promise((res, rej) => { id++; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {})); return r.result.value; }
await send('Page.enable'); await send('Runtime.enable');
const PROFILE = { v: 1, family: 'SATO', given: 'EMMA', middles: [], familyKana: 'サトウ', givenKana: 'エマ' };
for (const spec of SPECS) {
  const [tab, vp, scheme, lang, full] = spec.split(':');
  const [W, H] = vp.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: W < 600 ? 2 : 1, mobile: W < 600 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  const u = new URL(URL0);
  await send('Page.navigate', { url: u.origin + '/' });
  for (let i = 0; i < 80; i++) { await sleep(100); if (await ev('document.readyState') === 'complete') break; }
  await ev(`(function(){try{localStorage.clear();sessionStorage.clear();localStorage.setItem('mojifill.lang', ${JSON.stringify(lang)});localStorage.setItem('mojifill.installCoach.v1','1');}catch(e){}return 1})()`);
  await send('Page.navigate', { url: u.origin + '/#' + tab });
  for (let i = 0; i < 80; i++) { await sleep(100); if (await ev('document.readyState') === 'complete') break; }
  await sleep(500);
  await ev(`(function(){var b=document.querySelector('.lang-opt[data-lang="${lang}"]'); if(b) b.click(); var t=document.getElementById('tab-${tab}'); if(t) t.click();
    if('${tab}'==='names'||'${tab}'==='meishi'){var f=document.getElementById('family'),g=document.getElementById('given');
      if(f&&!f.value){f.value='Sato';f.dispatchEvent(new Event('input',{bubbles:true}));} if(g&&!g.value){g.value='Emma';g.dispatchEvent(new Event('input',{bubbles:true}));}}
    if('${tab}'==='fix'){var i=document.getElementById('fixInput'); if(i){i.value='サトウ　　エマ\\u200b ①';i.dispatchEvent(new Event('input',{bubbles:true}));i.blur();}}
    if('${tab}'==='meishi'){
      var pick=function(k,v){var b=document.querySelector('#meishiStyleRow .ms-group[data-key="'+k+'"] button[data-val="'+v+'"]'); if(b) b.click();};
      var preset='${scheme}'==='dark'?{orient:'tate',accent:'crest',color:'shu',seal:'hanko',furi:'above',back:'none'}:{orient:'yoko',accent:'bar',color:'ai',seal:'hanko',furi:'above',back:'en'};
      Object.keys(preset).forEach(function(k){pick(k,preset[k]);});
      var sel=document.getElementById('meishiAddType'), add=document.getElementById('meishiAddBtn');
      var addB=function(t){sel.value=t; add.click();};
      addB('company'); addB('department'); addB('job_title');
      var rows=document.querySelectorAll('#meishiBlocks .meishi-block');
      var setIn=function(row,i,v){var x=row.querySelectorAll('input')[i]; if(x){x.value=v; x.dispatchEvent(new Event('input',{bubbles:true}));}};
      var n=rows.length; setIn(rows[n-3],0,'さくら商事株式会社'); setIn(rows[n-3],1,'Sakura Trading Co., Ltd.'); setIn(rows[n-2],0,'営業部'); setIn(rows[n-2],1,'Sales Department'); setIn(rows[n-1],0,'Manager');
      var ph=document.getElementById('phoneInput'); if(ph){ph.value='090-1234-5678'; ph.dispatchEvent(new Event('input',{bubbles:true}));}
      var so=document.getElementById('meishiStdOrderBtn'); if(so) so.click();
    }
    window.scrollTo(0,0); return 1})()`);
  await sleep(tab === 'meishi' ? 2600 : 700);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full === 'full' });
  const name = `${tab}-${W}x${H}-${scheme}-${lang}${full === 'full' ? '-full' : ''}.png`;
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  const m = await ev(`(function(){var vw=innerWidth;return {hOverflow:document.documentElement.scrollWidth>vw+1, cols:(function(){var p=document.querySelector('.panel:not([hidden])');return p?getComputedStyle(p).gridTemplateColumns:''})()}})()`);
  console.log(name, JSON.stringify(m));
}
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
