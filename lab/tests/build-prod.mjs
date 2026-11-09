#!/usr/bin/env node
// 1.2.35-lab (1.2.36: hero/claims guard): build the production artifact from the lab page. Pure file transform — no network, no deploy.
// usage: node build-prod.mjs <out-dir> [prod-cache-name]
// Removes the LAB banner (HTML + CSS) and swaps the service-worker cache name to the prod one.
// 1.2.50-lab: the SW is a real file (sw.js, CACHE swapped there) + manifest.webmanifest + _headers (no-cache for /sw.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.join(__dirname, '..');
const out = process.argv[2];
const cache = process.argv[3] || 'mojifill-v39';
if (!out) { console.error('usage: node build-prod.mjs <out-dir> [cache]'); process.exit(2); }
if (!/^mojifill-v\d+$/.test(cache)) { console.error('prod cache must look like mojifill-vNN, got ' + cache); process.exit(2); }

let html = fs.readFileSync(path.join(LAB, 'index.html'), 'utf8');
const fail = (m) => { console.error('build-prod: ' + m); process.exit(1); };
const swap = (re, to, what) => {
  const n = (html.match(re) || []).length;
  if (n !== 1) fail(`${what}: expected exactly 1 match, found ${n}`);
  html = html.replace(re, to);
};
// 1.2.50-lab: CACHE lives in sw.js (served at /sw.js). index.html must register the file, never a blob: worker.
let sw = fs.readFileSync(path.join(LAB, 'sw.js'), 'utf8');
const labVer = (sw.match(/const CACHE='mojifill-([0-9.]+)-lab';/) || [])[1] || '?';
if (!/navigator\.serviceWorker\.register\('\/sw\.js'/.test(html)) fail("index.html does not register '/sw.js'");
if (/swBlob|new Blob\(\[swCode/.test(html)) fail('index.html still builds a blob: service worker');
{
  const n = (sw.match(/const CACHE='mojifill-[0-9.]+-lab';/g) || []).length;
  if (n !== 1) fail(`sw.js cache name: expected exactly 1 match, found ${n}`);
  sw = sw.replace(/const CACHE='mojifill-[0-9.]+-lab';/, `const CACHE='${cache}';`);
  if (/-lab'/.test(sw)) fail('lab markers left in sw.js');
}
// 1.2.36-lab: prod must ship the softened hero, and no absolute performance claims (景品表示法 7条2項)
if (!html.includes("'hero.title': 'フォームで弾かれる文字、貼る前に直す'") || !html.includes("'hero.title': 'Fix the characters forms reject — before you paste.'")) fail('softened hero (1.2.36) missing');
{ const m = html.match(/もう止まらない|Never get stuck|直った文字列|forms accept your/); if (m) fail('absolute claim left in artifact: ' + m[0]); }
swap(/\n\.lab-banner \{[^}]*\}\n\.lab-banner a \{[^}]*\}\n/, '\n', 'lab banner CSS');
swap(/<div class="lab-banner" role="status">.*?<\/div>\n/, '', 'lab banner HTML');
if (/lab-banner|-lab';/.test(html)) fail('lab markers left in artifact');
// 1.3.0: app is free — no Stripe payment link required.
if (/buy\.stripe\.com|plink_/.test(html)) fail('free build must not contain Stripe payment links');
if (/PRO_VALID_CODES/.test(html)) fail('PRO_VALID_CODES must be absent in free build');

fs.mkdirSync(path.join(out, 'public'), { recursive: true });
fs.writeFileSync(path.join(out, 'public', 'index.html'), html);
fs.writeFileSync(path.join(out, 'public', 'sw.js'), sw);
// 1.2.49-lab: the Terms / 特商法 page ships too (served at /terms), minus the LAB-only noindex. Refuses if a 【要決定】 placeholder remains.
{
  const terms = fs.readFileSync(path.join(LAB, 'terms.html'), 'utf8');
  if (!terms.includes('id="tokushoho"')) fail('terms.html has no #tokushoho section');
  const termsMarkup = terms.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/data-placeholder="|【要決定】/.test(termsMarkup)) fail('terms.html still has a 【要決定】 placeholder — fill it in before building prod');
  // noindex is LAB-only: drop the robots line for mojifill.app (exactly one).
  const ni = '<meta name="robots" content="noindex">\n';
  if (terms.split(ni).length !== 2) fail('terms.html: expected exactly 1 noindex line');
  const termsProd = terms.replace(/<!--[\s\S]*?noindex[\s\S]*?-->\n?/, '').replace(ni, '');
  if (/noindex/.test(termsProd)) fail('noindex left in prod terms.html');
  fs.writeFileSync(path.join(out, 'public', 'terms.html'), termsProd);
}
for (const f of ['favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'manifest.webmanifest', '_headers', 'robots.txt', 'sitemap.xml', 'og.png']) {
  const src = path.join(LAB, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, 'public', f));
  else if (!['robots.txt','sitemap.xml','og.png'].includes(f)) fail('missing ' + f);
}
fs.cpSync(path.join(LAB, 'functions'), path.join(out, 'functions'), { recursive: true });
// 1.3.2-lab: how-it-works demo media (About tab)
if (fs.existsSync(path.join(LAB, 'demo'))) fs.cpSync(path.join(LAB, 'demo'), path.join(out, 'public', 'demo'), { recursive: true });
const listing = fs.readdirSync(path.join(out, 'public')).sort();
if (listing.some((f) => /PRO_CODES|\.md$/i.test(f) || (/\.txt$/i.test(f) && f !== 'robots.txt'))) fail('unexpected file in public/: ' + listing.join(', '));
console.log(`build-prod: ${path.join(out, 'public')} = ${listing.join(', ')} + functions/api/geo.js · CACHE ${cache} (sw.js) · from lab ${labVer}`);
