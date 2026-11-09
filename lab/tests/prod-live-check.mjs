// Read-only headless check of live https://mojifill.app (EXPECT_CACHE, default mojifill-v40): SW control, offline / and /terms, desktop install hidden, buy → ¥1,480 link.
// Run: node lab/tests/prod-live-check.mjs   (read-only; needs google-chrome + ws)
import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawn } from 'child_process'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let WS; for (const p of ['ws', path.join(os.homedir(), '.local/lib/node_modules/ws')]) { try { WS = require(p); break; } catch (e) {} }
if (!WS) WS = WebSocket;
const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const O = process.env.CHECK_ORIGIN || 'https://mojifill.app';
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-prod-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res) => { let b = ''; chrome.stderr.on('data', (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); });
const port = new URL(wsUrl).port;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WS(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener ? ws.addEventListener('open', r) : ws.on('open', r));
let id = 0; const pend = new Map(); const events = [];
const onMsg = (raw) => { const m = JSON.parse(typeof raw === 'string' ? raw : (raw.data ?? raw.toString())); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } else if (m.method) events.push(m); };
ws.on ? ws.on('message', onMsg) : ws.addEventListener('message', onMsg);
const send = (method, params = {}) => new Promise((res, rej) => { id++; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
const load = async (u) => { await send('Page.navigate', { url: u }); for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev('document.readyState') === 'complete') break; } catch (e) {} } await sleep(500); };
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await load(O + '/?lang=ja');
  const exc = events.filter((e) => e.method === 'Runtime.exceptionThrown');
  ok(exc.length === 0, 'boot: no uncaught exceptions ' + exc.map((e) => e.params.exceptionDetails.text).join('|'));
  ok(!(await ev("!!document.querySelector('.lab-banner')")), 'no LAB banner');
  console.log("  reg", JSON.stringify(await ev("Promise.race([navigator.serviceWorker.ready.then(r=>({scope:r.scope,active:!!r.active})),new Promise(r=>setTimeout(()=>r(\"timeout\"),15000))]).then(x=>navigator.serviceWorker.getRegistrations().then(rs=>({x:x,n:rs.length,s:rs.map(r=>[r.installing,r.waiting,r.active].map(w=>w&&w.state))})))")));
  await load(O + '/?lang=ja'); // second load: controlled
  const sw = await ev("(async()=>({ctrl:!!navigator.serviceWorker.controller, url:navigator.serviceWorker.controller&&navigator.serviceWorker.controller.scriptURL, caches:await caches.keys()}))()");
  ok(sw.ctrl && sw.url === O + '/sw.js', 'SW /sw.js controls page ' + JSON.stringify(sw));
  const EXPECT = process.env.EXPECT_CACHE || 'mojifill-v40';
  ok(sw.caches.includes(EXPECT), `cache ${EXPECT} present`);
  // 1.2.53: truthful analytics wording is live (no 'no trackers' claims)
  const pv = await ev("document.documentElement.innerHTML");
  ok(!/no (other )?trackers|トラッカー/i.test(pv) && /Cloudflare Web Analytics/.test(pv), 'live page: no "no trackers"/トラッカー claim, discloses Cloudflare Web Analytics');
  // desktop install button hidden
  const inst = await ev("(function(){var b=document.getElementById('headerInstallBtn');var vis=!!b&&!b.hidden&&b.getBoundingClientRect().width>0&&getComputedStyle(b).display!=='none';return {btn:vis, elig: typeof window.mfInstallUiEligible==='function'?window.mfInstallUiEligible():null};})()");
  ok(!inst.btn && !inst.elig, 'desktop 1280: install button not visible ' + JSON.stringify(inst));
  // buy → link (capture window.open)
  const buy = await ev("(function(){var u=null;var o=window.open;window.open=function(x){u=x;return null;};var b=document.getElementById('proBuyBtn');var vis=!!b&&!b.hidden;if(b)b.click();window.open=o;return {vis:vis,url:u,text:b?b.textContent.trim():null};})()");
  ok(!buy.vis || !/buy\.stripe\.com/.test(buy.url||''), 'free: no live Stripe buy button');
  // 1.3.4: no visible Pro / unlock wording on any tab or help, JA + EN
  const SCAN = fs.readFileSync(new URL('./visible-pro-scan.js', import.meta.url), 'utf8').replace(/^\/\/.*\n/, '');
  for (const lg of ['ja', 'en']) {
    await load(O + '/?lang=' + lg);
    const r = await ev(SCAN);
    ok(r.hits.length === 0, `${lg}: no visible Pro/unlock wording on any tab or help ${JSON.stringify(r.hits)}`);
  }
  await load(O + '/terms'); await sleep(300);
  ok(await ev("!!document.getElementById('tokushoho')"), '/terms online renders #tokushoho');
  ok(await ev("!/no (other )?trackers|トラッカー/i.test(document.documentElement.innerHTML) && document.body.innerText.includes('Cloudflare Web Analytics')"), '/terms: no "no trackers" claim, discloses Cloudflare Web Analytics');
  // offline
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  for (const u of ['/', '/?lang=en', '/terms']) {
    await load(O + u);
    const r = await ev("({title:document.title, cards:document.querySelectorAll('.copy-card').length, tok:!!document.getElementById('tokushoho'), body:document.body?document.body.innerText.length:0})");
    ok(u.startsWith('/terms') ? r.tok : r.cards > 0, `offline ${u} renders ${JSON.stringify(r)}`);
  }
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
} catch (e) { ok(false, 'error ' + e.message); }
chrome.kill(); console.log(fails ? `FAILED ${fails}` : 'prod live check passed'); process.exit(fails ? 1 : 0);
