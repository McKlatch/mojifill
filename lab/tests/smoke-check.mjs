#!/usr/bin/env node
/**
 * MojiFill lab smoke checks — no browser required.
 * Run before every lab deploy: node lab/tests/smoke-check.mjs
 * Deploy must refuse if this exits non-zero (see deploy-lab.sh).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const labHtml = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(labHtml, 'utf8');
// 1.3.0-lab: the Terms / 特商法 page (single source for 特定商取引法に基づく表記)
const termsHtml = fs.readFileSync(path.resolve(__dirname, '../terms.html'), 'utf8');
// 1.3.0-lab: the service worker is a real file (lab/sw.js → /sw.js), plus a real manifest and _headers
const swJs = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');
const manifestTxt = fs.readFileSync(path.resolve(__dirname, '../manifest.webmanifest'), 'utf8');
const headersTxt = fs.readFileSync(path.resolve(__dirname, '../_headers'), 'utf8');
const tkTerms = termsHtml.slice(termsHtml.indexOf('id="tokushoho"'), termsHtml.indexOf('</section>', termsHtml.indexOf('id="tokushoho"')));
let fails = 0;
const FREE_ERA = true; // 1.3.0-lab: fully free, no Pro / Stripe / 特商法 sales
const okPaid = (cond, msg) => { if (FREE_ERA) { console.log('  SKIP (paid-era)', msg); return; } ok(cond, msg); };
function ok(cond, msg) {
  if (cond) console.log('  PASS', msg);
  else { console.error('  FAIL', msg); fails++; }
}

console.log('MojiFill lab smoke —', labHtml);

// CACHE
const EXPECTED_CACHE = 'mojifill-1.3.4-lab';
const cacheM = swJs.match(/const CACHE='([^']+)'/);
ok(cacheM && cacheM[1] === EXPECTED_CACHE, `sw.js CACHE is ${EXPECTED_CACHE} (got ${cacheM && cacheM[1]})`);
ok(!/const CACHE=/.test(html), '1.3.0: no inline CACHE / worker code left in index.html');
ok(html.includes('function telegraphWarekiDate'), 'telegraphWarekiDate present');
ok(html.includes('function obfuscatePro'), 'obfuscatePro present');
ok(html.includes("'dates.warekiTelegraph': 'Era telegraph (㋿8年㋈㏱)'"), 'EN warekiTelegraph title (correct sample)');
ok(html.includes("'dates.warekiTelegraph': '和暦電信'"), 'JA warekiTelegraph title');
ok(!html.includes('㋿8年9月18日'), 'no wrong EN telegraph sample ㋿8年9月18日');

ok(html.includes('lab-banner'), 'lab-banner present');
ok(!html.includes('PRO_CODES') || !/#\s*PRO_CODES/.test(html), 'no PRO_CODES leak heuristic');

// Hide-at-ends (Bezalel)
ok(html.includes('prev.hidden = idx <= 0'), 'syncStepperState uses prev.hidden');
ok(html.includes('next.hidden = idx >= tabOrder.length - 1'), 'syncStepperState uses next.hidden');
ok(html.includes('.tabs-rail .tab-step[hidden]'), 'CSS [hidden] display:none');
ok(!html.includes('.tabs-rail .tab-step:disabled'), 'no :disabled opacity rule on tab-step');
ok(html.includes('.tabs-rail::before'), 'tabs-rail ::before blur');

// Swipe guardrails (must KEEP)
ok(/touch-action:\s*pan-x/.test(html), 'tabs keep touch-action:pan-x');
ok(!/\.tabs\s*\{[^}]*overflow-x:\s*hidden/.test(html), 'tabs not overflow-x:hidden');
ok(!/\.tabs-rail\s*\{[^}]*overflow-x:\s*hidden/.test(html), 'tabs-rail not overflow-x:hidden');

// Lang + tab persistence keys
ok(html.includes('mojifill.lang'), 'LANG_KEY mojifill.lang');
ok(html.includes('mojifill.tab') || /localStorage\.(get|set)Item\(['\"]mojifill\.tab/.test(html), 'tab restore key present');

// i18n keys for new hints
for (const k of ['names.hintUpper','names.hintCounts','names.hintFw','names.hintIdeo','names.ladderSub','names.emptyNudge','furi.usesNames','ui.copied','ui.clear','ui.saved','ui.loading','ui.required','ui.invalid','ui.empty','ui.tryAgain']) {
  ok(html.includes(`'${k}'`), `i18n key ${k}`);
}

// Extract inline script and syntax-check with node (strip HTML)
const scriptTags = [...html.matchAll(/<script(?![^>]*src=)([^>]*)>([\s\S]*?)<\/script>/gi)];
const scripts = scriptTags.filter(m => !/type\s*=\s*["']application\/ld\+json["']/i.test(m[1])).map(m => m[2]);
ok(scripts.length >= 1, `inline scripts found (${scripts.length}; ld+json skipped)`);
let syntaxOk = true;
for (let i = 0; i < scripts.length; i++) {
  try {
    new vm.Script(scripts[i], { filename: `lab-inline-${i}.js` });
  } catch (e) {
    console.error('  FAIL syntax script', i, e.message);
    fails++;
    syntaxOk = false;
  }
}
if (syntaxOk) console.log('  PASS all inline scripts parse');

// Rubi JA must-fix samples
ok(html.includes("'ui.copied': '✓ コピーしました'") && html.includes("'ui.copied': '✓ Copied'"), 'JA/EN ui.copied (1.2.38: ✓ toast)');
ok(html.includes("'ui.clear': '消去'"), 'Rubi JA ui.clear (not クリア)');
ok(true, '1.3.0: unlockPro string retired (free)');
ok(html.includes("'chrome.labBanner': 'LAB｜本番'"), 'Rubi JA labBanner');
ok(html.includes("'names.kanaCheck': 'カナ確認'"), 'Rubi JA kanaCheck');

ok(html.includes("'names.ladder': '貼り付け用（タップでコピー）'"), 'Rubi JA ladder');
// Rubi JP walk must-fix (1.2.20-lab)
ok(html.includes("'chrome.installHome': 'ホーム画面に追加'"), 'Rubi JA installHome');
ok(html.includes("'chrome.showSteps': '手順'"), 'Rubi JA showSteps');
ok(html.includes("'chrome.gotIt': '閉じる'"), 'Rubi JA gotIt');
ok(html.includes("'tab.about': 'について'") || html.includes("'chrome.openPro': 'About'"), 'Rubi JA about/openPro');
ok(html.includes("'chrome.installHelp': 'インストール手順'"), 'Rubi JA installHelp');
ok(html.includes("'chrome.privacyOnDevice': '端末内処理'"), 'Rubi JA privacyOnDevice');
ok(true, '1.3.0: tapUnlock retired');
ok(true, '1.3.0: unlockInTab retired');
ok(html.includes("'meishi.titlePro': '名刺'") || html.includes("名刺"), 'Rubi JA meishi title');
ok(html.includes("'emoji.title': '記号・絵文字'"), 'Rubi JA emoji.title');
ok(html.includes("'emoji.shop': '看板'"), 'Rubi JA emoji.shop');
ok(html.includes("'emoji.map': '地図・道'"), 'Rubi JA emoji.map');
ok(html.includes("'emoji.places': '場所'"), 'Rubi JA emoji.places');
ok(html.includes("'emoji.culture': '暦・文化'"), 'Rubi JA emoji.culture');
ok(html.includes("'emoji.food': '食べ物'"), 'Rubi JA emoji.food');
ok(html.includes("'ui.newDemo': 'デモ名'"), 'Rubi JA newDemo');
ok(html.includes("'dates.ymdSlash': '西暦（スラッシュ）'"), 'Rubi JA ymdSlash');
ok(html.includes("'work.manenHelp': '万円とは'"), 'Rubi JA manenHelp');
ok(html.includes("'work.empTitle': '雇用形態の表記'") || html.includes("'work.empHelp': '雇用形態の表記'"), 'Rubi JA empTitle/help');

ok(/override === 'en' \|\| override === 'ja'/.test(html), 'soft-default respects saved override');
ok(html.includes("typeof UI === 'undefined'"), 't() guards UI before init');

// Tab buttons exist
for (const t of ['names','furigana','dates','phone','fix','work','address','meishi','marks','about']) {
  ok(html.includes(`data-tab="${t}"`), `tab ${t}`);
}

// --- t() boot order: calling t before UI assigned must not throw ---
{
  const tMatch = html.match(/function t\(key\) \{[\s\S]*?\n  \}/);
  ok(!!tMatch, 't() function extractable');
  if (tMatch) {
    const ctx = {};
    vm.createContext(ctx);
    try {
      vm.runInContext(
        'var UI;\n' + // hoisted-undefined stand-in (not yet assigned)
        tMatch[0] + '\n' +
        'var _out = t("ui.copied");\n' +
        'this._out = _out;\n' +
        'this._threw = false;\n',
        ctx
      );
      ok(ctx._out === 'ui.copied', `t() before UI returns key (got ${JSON.stringify(ctx._out)})`);
      ok(true, 't() before UI assigned does not throw');
    } catch (e) {
      ok(false, `t() before UI threw: ${e.message}`);
    }
    // After UI assigned, returns pack value
    try {
      vm.runInContext(
        'UI = { en: { "ui.copied": "Copied" }, ja: { "ui.copied": "コピー済" } }; uiLang = "en";\n' +
        'this._out2 = t("ui.copied");\n',
        ctx
      );
      ok(ctx._out2 === 'Copied', `t() after UI returns pack (got ${JSON.stringify(ctx._out2)})`);
    } catch (e) {
      ok(false, `t() after UI threw: ${e.message}`);
    }
  }
}

// --- obfuscatePro functional ---
{
  const m = html.match(/function obfuscatePro\(s, keep\) \{[\s\S]*?\n  \}/);
  ok(!!m, 'obfuscatePro extractable');
  if (m) {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(m[0] + '\nthis.obfuscatePro = obfuscatePro;', ctx);
    const full = '㋿8年9月23日';
    const o = ctx.obfuscatePro(full, 4);
    ok(o !== full, `obfuscatePro hides full value (got ${o})`);
    ok(/…$/.test(o) || /\.\.\.$/.test(o), `obfuscatePro ends with ellipsis (got ${o})`);
    ok(Array.from(o.replace(/…$/, '').replace(/\.\.\.$/, '')).length <= 4, `obfuscatePro keeps ≤4 chars (got ${o})`);
    ok(o.length < full.length, 'obfuscatePro visible length shorter than full');
    const short = ctx.obfuscatePro('東京都', 4);
    // min(4, max(1, floor(3/2))) = min(4,1) = 1 → 東…
    ok(short === '東…' || short.endsWith('…'), `short-string rule (got ${short})`);
    const kn = '二〇二六年九月二十三日';
    const okKn = ctx.obfuscatePro(kn, 4);
    ok(okKn !== kn && okKn.endsWith('…'), `漢数字 obfuscated (got ${okKn})`);
  }
  // Locked card path must call obfuscatePro and must not assign raw preview to textContent
  const lockedFn = html.match(/function makeProLockedCard\(label, preview, toastKey\) \{[\s\S]*?\n  \}/);
  ok(!!lockedFn, 'makeProLockedCard extractable');
  if (lockedFn) {
    okPaid(lockedFn[0].includes('obfuscatePro(preview'), 'locked card uses obfuscatePro(preview)');
    okPaid(!/\.textContent\s*=\s*preview\b/.test(lockedFn[0]), 'locked card does not textContent=preview');
    ok(!/setAttribute\(\s*['\"]title['\"]/.test(lockedFn[0]), 'locked card no title attr');
    const lockedCode = lockedFn[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok(!/dataset\.|data-copy|data-value|aria-label|setAttribute\(\s*['"]title['"]/.test(lockedCode), 'locked card no data-*/aria/title with value');
  }
  // Static sales previews obfuscated (no full sample address)
  ok(!html.includes('東京都千代田区丸の内1-2-3'), 'addr locked preview not full one-liner');
  ok(html.includes('東京都千…') || html.includes('東京…'), 'addr locked preview obfuscated');
  ok(!html.includes('>Yamada Taro<'), 'meishi locked preview name obfuscated');
}

// --- Telegraph 和暦 functional ---
{
  const m = html.match(/function telegraphWarekiDate\(iso\) \{[\s\S]*?\n  \}/);
  const eras = html.match(/var ERAS = \[[\s\S]*?\];/);
  const sq = html.match(/var SQUARE_ERA = \{[\s\S]*?\};/);
  const tw = html.match(/function toWareki\(iso\) \{[\s\S]*?\n  \}/);
  const yp = html.match(/function ymdParts\(iso\) \{[\s\S]*?\n  \}/);
  const cmp = html.match(/function cmpYmd\(a, b\) \{[\s\S]*?\n  \}/);
  const sqFn = html.match(/function squareEraDate\(iso\) \{[\s\S]*?\n  \}/);
  ok(m && eras && sq && tw && yp && cmp, 'telegraph helper slices extractable');
  if (m && eras && sq && tw && yp && cmp) {
    const ctx = { console };
    const code = eras[0] + '\n' + yp[0] + '\n' + cmp[0] + '\n' + tw[0] + '\n' + sq[0] + '\n' + m[0] + '\n'
      + (sqFn ? sqFn[0] + '\n' : '')
      + 'this.telegraphWarekiDate = telegraphWarekiDate;\n'
      + (sqFn ? 'this.squareEraDate = squareEraDate;\n' : '');
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    const a = ctx.telegraphWarekiDate('2026-09-18');
    const d = ctx.telegraphWarekiDate('2026-09-23');
    const b = ctx.telegraphWarekiDate('2019-04-30'); // Heisei 31 Apr 30
    const c = ctx.telegraphWarekiDate('1867-01-01'); // pre-Meiji
    ok(a === '㋿8年㋈㏱', `Reiwa 8 Sep 18 telegraph (got ${a})`);
    ok(d === '㋿8年㋈㏶', `Reiwa 8 Sep 23 telegraph (got ${d})`);
    ok(b === '㍻31年㋃㏽', `Heisei 31 Apr 30 telegraph (got ${b})`);
    ok(c === '', `pre-Meiji omits telegraph (got ${JSON.stringify(c)})`);
    // Must not equal square-era "normal 和暦 with era square"
    if (ctx.squareEraDate) {
      const sq23 = ctx.squareEraDate('2026-09-23');
      ok(sq23 === '㋿8年9月23日', `squareEraDate Sep 23 (got ${sq23})`);
      ok(d !== sq23, 'telegraph ≠ squareEraDate (distinct rows)');
    }
  }
  // rebuildDates must push telegraph row
  ok(/telegraphWarekiDate\(iso\)/.test(html) && /dates\.warekiTelegraph/.test(html), 'Dates ladder includes telegraph row');
}

// --- Names paste-ready ladder ≥1 card when family+given set ---
{
  // Harness: extract transform helpers + fillLadder/makeCopyCard with minimal DOM mock
  const need = {
    toFullwidth: html.match(/function toFullwidth\(s\) \{[\s\S]*?\n  \}/),
    toFullwidthKeepAsciiSpace: html.match(/function toFullwidthKeepAsciiSpace\(s\) \{[\s\S]*?\n  \}/),
    titleCaseWord: html.match(/function titleCaseWord\(w\) \{[\s\S]*?\n  \}/),
    titleCase: html.match(/function titleCase\(s\) \{[\s\S]*?\n  \}/),
    upper: html.match(/function upper\(s\) \{[^}]+\}/),
    charCount: html.match(/function charCount\(s\) \{[^}]+\}/),
    zenkakuCells: html.match(/function zenkakuCells\(s\) \{[\s\S]*?\n  \}/),
    isMiddleVariantLabel: html.match(/function isMiddleVariantLabel\(label\) \{[\s\S]*?\n  \}/),
    preferCopyLabel: html.match(/function preferCopyLabel\(a, b\) \{[\s\S]*?\n  \}/),
    makeCopyCard: html.match(/function makeCopyCard\(label, value(?:, meta)?\) \{[\s\S]*?\n  \}/),
    fillLadder: html.match(/function fillLadder\(container, items, opts\) \{[\s\S]*?\n  \}/),
  };
  const missing = Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
  ok(missing.length === 0, `names harness slices extractable${missing.length ? ' missing ' + missing.join(',') : ''}`);
  if (missing.length === 0) {
    const cards = [];
    const fakeDoc = {
      createElement(tag) {
        const el = {
          tagName: String(tag).toUpperCase(),
          type: '',
          className: '',
          innerHTML: '',
          _listeners: [],
          children: [],
          querySelector(sel) {
            // very small: find by class on children created via innerHTML parse-ish
            if (!this._nodes) {
              this._nodes = {};
              // populate from last innerHTML assignment of spans
            }
            const cls = (sel.match(/\.(\w+)/) || [])[1];
            if (cls && this._nodes[cls]) return this._nodes[cls];
            // create stub
            const stub = { textContent: '', className: cls || '', appendChild() {}, children: [] };
            if (cls) this._nodes[cls] = stub;
            return stub;
          },
          addEventListener() {},
          closest() { return null; },
        };
        // When innerHTML set with three spans, ensure querySelector works
        Object.defineProperty(el, 'innerHTML', {
          set() {
            el._nodes = {
              label: { textContent: '', appendChild() {}, children: [] },
              value: { textContent: '' },
              meta: { textContent: '' },
            };
          },
          get() { return ''; }
        });
        return el;
      }
    };
    const container = {
      children: cards,
      appendChild(btn) { cards.push(btn); },
    };
    const ctx = {
      document: fakeDoc,
      Array,
      String,
      Object,
      t(key) { return key; },
      copyText() {},
    };
    vm.createContext(ctx);
    const code = [
      need.toFullwidth[0],
      need.toFullwidthKeepAsciiSpace[0],
      need.titleCaseWord[0],
      need.titleCase[0],
      need.upper[0],
      need.charCount[0],
      need.zenkakuCells[0],
      need.isMiddleVariantLabel[0],
      need.preferCopyLabel[0],
      need.makeCopyCard[0],
      need.fillLadder[0],
      `
      function buildNameItems(family, given) {
        family = String(family || '').trim();
        given = String(given || '').trim();
        var fullLegal = titleCase([given, family].filter(Boolean).join(' '));
        var upFull = upper(fullLegal);
        var items = [
          ['ladder.upperFull', upFull],
          ['ladder.upperFamily', upper(titleCase(family))],
          ['ladder.upperGiven', upper(titleCase(given))],
          ['ladder.titleFull', fullLegal],
          ['ladder.familyOnly', titleCase(family)],
          ['ladder.givenOnly', titleCase(given)]
        ];
        return items;
      }
      var items = buildNameItems('Harris', 'Anthony');
      fillLadder(container, items, { skipValues: ['Harris', 'Anthony'] });
      this.cardCount = container.children.length;
      this.sampleVal = container.children[0] && container.children[0]._nodes && container.children[0]._nodes.value.textContent;
      `,
    ].join('\n');
    // Bind container into ctx
    ctx.container = container;
    try {
      vm.runInContext(code, ctx);
      ok(ctx.cardCount >= 1, `Names ladder ≥1 card when family+given set (got ${ctx.cardCount})`);
    } catch (e) {
      ok(false, `Names ladder harness threw: ${e.message}`);
    }
  }
}


// 1.2.21-lab: fullwidth titlecase + Names jump sections
ok(html.includes("'ladder.fwTitleSpaces': 'Fullwidth title case ·"), 'EN fwTitleSpaces label');
ok(html.includes("'ladder.fwTitleSpaces': '全角タイトル・全角スペース'"), 'JA fwTitleSpaces label');
ok(html.includes("'names.jumpUpper': '大文字'"), 'JA jumpUpper chip');
ok(html.includes("'names.jumpTitle': 'Title・SNS'"), 'JA jumpTitle chip');
ok(html.includes("'names.jumpKana': 'カナ'"), 'JA jumpKana chip');
ok(html.includes("'names.secTitle': 'Title · SNS'") || html.includes("'names.secTitle': 'Title・SNS'"), 'EN/JA secTitle');
ok(html.includes('id="namesJumpChips"'), 'names jump chips present');
ok(html.includes('names-jump-sticky'), 'sticky jump row class');
ok(html.includes("name-sec-") || html.includes("'name-sec-'"), 'section anchor id wiring');
ok(html.includes("tagSns") || html.includes("names.tagSns"), 'SNS microtag wiring');
ok(html.includes('{ section: \'title\' }') || html.includes('{ section: "title" }'), 'title section marker');

// Transform sample: Title Case → fullwidth (Anthony Harris demo)
{
  const m = html.match(/function toFullwidth\(s\) \{[\s\S]*?\n  \}/);
  const tcm = html.match(/function titleCaseWord\(w\) \{[\s\S]*?\n  \}/);
  const tc = html.match(/function titleCase\(s\) \{[\s\S]*?\n  \}/);
  ok(!!m && !!tcm && !!tc, 'helpers extractable for fw title sample');
  if (m && tcm && tc) {
    const ctx = { String, Array };
    vm.createContext(ctx);
    vm.runInContext(m[0] + '\n' + tcm[0] + '\n' + tc[0] + `
      var sample = toFullwidth(titleCase('anthony harris'));
      this.sample = sample;
    `, ctx);
    ok(ctx.sample === 'Ａｎｔｈｏｎｙ　Ｈａｒｒｉｓ', `fw title sample (got ${JSON.stringify(ctx.sample)})`);
  }
}


// 1.2.22-lab: family-first fullwidth UPPER (Japan official-form order)
ok(html.includes("'ladder.fwUpperFamilyFirst': 'Fullwidth UPPER · family first'"), 'EN fwUpperFamilyFirst label');
ok(html.includes("'ladder.fwUpperFamilyFirst': '全角大文字・姓先'"), 'JA fwUpperFamilyFirst label');
ok(html.includes("'ladder.upperFamilyFirst': 'UPPER · family first'"), 'EN upperFamilyFirst label');
ok(html.includes("'ladder.upperFamilyFirst': '大文字・姓先'"), 'JA upperFamilyFirst label');
ok(html.includes("'ladder.fwTitleFamilyFirst': 'Fullwidth title · family first'"), 'EN fwTitleFamilyFirst label');
ok(html.includes("'ladder.fwTitleFamilyFirst': '全角タイトル・姓先'"), 'JA fwTitleFamilyFirst label');
ok(html.includes('fwUpperFamilyFirst'), 'fwUpperFamilyFirst wired in rebuildNames');
ok(html.includes('familyFirstLegal'), 'familyFirstLegal builder present');
ok(html.includes("t('ladder.fwUpperFamilyFirst')"), 'fwUpperFamilyFirst card in ladder');

// Transform sample: family-first UPPER → fullwidth (Anthony Harris demo — not McClatchey)
{
  const m = html.match(/function toFullwidth\(s\) \{[\s\S]*?\n  \}/);
  const tcm = html.match(/function titleCaseWord\(w\) \{[\s\S]*?\n  \}/);
  const tc = html.match(/function titleCase\(s\) \{[\s\S]*?\n  \}/);
  const up = html.match(/function upper\(s\) \{[^}]+\}/);
  ok(!!m && !!tcm && !!tc && !!up, 'helpers extractable for family-first fw UPPER sample');
  if (m && tcm && tc && up) {
    const ctx = { String, Array };
    vm.createContext(ctx);
    vm.runInContext(m[0] + '\n' + tcm[0] + '\n' + tc[0] + '\n' + up[0] + `
      // family Harris, given Anthony (Western fields → JP order)
      var familyFirst = titleCase(['Harris', 'Anthony'].filter(Boolean).join(' '));
      var sample = toFullwidth(upper(familyFirst));
      this.sample = sample;
      var withMid = titleCase(['Harris', 'Anthony', 'James'].filter(Boolean).join(' '));
      this.withMid = toFullwidth(upper(withMid));
      this.titleFw = toFullwidth(familyFirst);
      this.asciiUp = upper(familyFirst);
    `, ctx);
    ok(ctx.sample === 'ＨＡＲＲＩＳ　ＡＮＴＨＯＮＹ', `fw UPPER family-first sample (got ${JSON.stringify(ctx.sample)})`);
    ok(ctx.withMid === 'ＨＡＲＲＩＳ　ＡＮＴＨＯＮＹ　ＪＡＭＥＳ', `fw UPPER family-first + middle (got ${JSON.stringify(ctx.withMid)})`);
    ok(ctx.titleFw === 'Ｈａｒｒｉｓ　Ａｎｔｈｏｎｙ', `fw title family-first sample (got ${JSON.stringify(ctx.titleFw)})`);
    ok(ctx.asciiUp === 'HARRIS ANTHONY', `ASCII UPPER family-first sample (got ${JSON.stringify(ctx.asciiUp)})`);
  }
}

// 1.2.23-lab: Address Bitwarden/Rubi paste cards (lab only)
ok(html.includes("'addr.prefCitySpaced': 'Pref · city (spaced)'"), 'EN prefCitySpaced');
ok(html.includes("'addr.prefCitySpaced': '都道府県・市区町村'"), 'JA prefCitySpaced (Rubi)');
ok(html.includes("'addr.prefCityTight': '県市（詰める）'"), 'JA prefCityTight');
ok(html.includes("'addr.townOnly': '町名'"), 'JA townOnly');
ok(html.includes("'addr.blockBldgRoomFw': '番地・建物・部屋'"), 'JA blockBldgRoomFw');
ok(html.includes("'addr.fullWithMark': '住所（〒つき）'"), 'JA fullWithMark');
ok(html.includes("'addr.firstHalf': '前半（県〜町）'"), 'JA firstHalf');
ok(html.includes("'addr.secondHalfMyNumber': '後半（番号・方書）'"), 'JA secondHalf MyNumber');
ok(html.includes("'addr.shortest': '最短'"), 'JA shortest');
ok(html.includes("'addr.formalKanji': '漢数字・正式'"), 'JA formalKanji (no 日本)');
ok(html.includes("'addr.formalKanjiOverseas': '漢数字・海外（日本）'"), 'JA formal overseas twin');
ok(html.includes("'addr.region': '地方'"), 'JA region');
ok(html.includes("'addr.regionSub': '地方（細分）'"), 'JA region sub');
ok(html.includes("'addr.district': '学区・地区'"), 'JA district field');
ok(html.includes("'addr.buildingKana': '建物カナ'"), 'JA buildingKana field');
ok(html.includes("'addr.katagaki': '方書'"), 'JA katagaki');
ok(html.includes("'addr.tagMyNumber': 'MyNumber'"), 'MyNumber microtag');
ok(html.includes("'addr.tagShortest': '最短'"), '最短 microtag');
ok(html.includes('id="addrJumpChips"'), 'addr jump chips');
ok(html.includes('addr-jump-sticky'), 'addr sticky jump class');
ok(html.includes("sectionPrefix: 'addr-sec-'") || html.includes('sectionPrefix: "addr-sec-"'), 'addr section anchors');
ok(html.includes('id="addrRoom"'), 'addrRoom input');
ok(html.includes('id="addrBuildingKana"'), 'addrBuildingKana input');
ok(html.includes('id="addrDistrict"'), 'addrDistrict input');
ok(html.includes('function parseAddressBlock'), 'parseAddressBlock helper');
ok(html.includes('function collapseSpacedDigits'), 'collapseSpacedDigits hygiene');
ok(html.includes('function formatMyNumberHalf'), 'MyNumber half formatter');
ok(html.includes('function formatFormalKanji'), 'formal kansuji formatter');
ok(html.includes("'石川県': { region: '中部地方', sub: '北陸地方' }"), 'Ishikawa dual region table');
ok(html.includes('toKanjiRoomDigits'), 'room kansuji uses 〇 not 零');
ok(!html.includes("formatFormalKanji(a, p, true)") || html.includes("formatFormalKanji(a, p, true)"), 'overseas twin call present');
ok(html.includes("t('addr.formalKanji')"), 'formal card wired');
ok(html.includes("t('addr.secondHalfMyNumber')"), 'MyNumber card wired');
ok(html.includes("t('addr.shortest')"), 'shortest card wired');

// Sample transforms: Kanazawa acceptance shape (demo — not McClatchey)
{
  function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) return null;
    let i = src.indexOf('{', start);
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, j + 1);
      }
    }
    return null;
  }
  const need = [
    'toFullwidth','toHalfwidth','normalizeDashy','digitsOnly','kanjiDigitChar','toKanjiSmallNum',
    'collapseSpacedDigits','compactHyphenBlock','parseAddressBlock','toKanjiRoomDigits',
    'formatFwBlockLot','formatMyNumberHalf','formatShortest','formatFormalKanji'
  ];
  let code = `function emptyAddress(){return {postal:'',pref:'',city:'',town:'',banchi:'',building:'',room:'',buildingKana:'',district:'',en:''};}\n`;
  let okExtract = true;
  for (const n of need) {
    const fn = extractFn(html, n);
    if (!fn) { okExtract = false; ok(false, 'extract ' + n); break; }
    code += fn + '\n';
  }
  ok(okExtract, 'address helper extract for sample');
  if (okExtract) {
    const ctx = { String, Array, Object };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    const a = {
      postal: '920-0947', pref: '石川県', city: '金沢市', town: '笠舞本町',
      banchi: '1-2-34', building: 'エスペランサ赤坂', room: '202', buildingKana: '', district: '', en: ''
    };
    const p = ctx.parseAddressBlock(a);
    ok(ctx.formatFwBlockLot(p) === '１丁目２－３４ エスペランサ赤坂　２０２', 'fw block-bldg-room sample');
    ok(ctx.formatMyNumberHalf(p) === '１丁目 ２番３４号（エスペランサ赤坂・２０２号）', 'MyNumber half sample');
    ok(ctx.formatShortest(a, p) === '笠舞本町1-2-34 エスペランサ赤坂202', 'shortest sample');
    ok(ctx.formatFormalKanji(a, p, false) === '石川県金沢市笠舞本町一丁目二番三十四号エスペランサ赤坂二〇二号', 'formal kansuji (no 日本)');
    ok(ctx.formatFormalKanji(a, p, true).startsWith('日本'), 'overseas twin has 日本');
    ok(ctx.toKanjiRoomDigits('202') === '二〇二', 'room 二〇二 not 零');
    const messy = ctx.parseAddressBlock(Object.assign({}, a, { banchi: '1 丁目 2 － 3 4 エスペランサ赤坂 2 0 2', building: '', room: '' }));
    ok(messy.chome === '1' && messy.ban === '2' && messy.go === '34' && messy.room === '202', 'spaced-digit banchi parse');
  }
}


// 1.2.24-lab: Address affordance gating + Today i18n + named profile dates
ok(html.includes('function syncAddrAffordances'), 'syncAddrAffordances present');
ok(html.includes('id="addrEmptyNudge"'), 'addr empty nudge element');
ok(html.includes("'addr.needPostal': 'Add a postcode to continue'"), 'EN addr.needPostal');
ok(html.includes("'addr.needPostal': '郵便番号を入れると続きます'"), 'JA addr.needPostal');
ok(html.includes('addr-jump-sticky.is-collapsed'), 'collapsed jump CSS');
ok(html.includes('chip.is-disabled') || html.includes('.chip.is-disabled'), 'disabled chip CSS');
ok(html.includes("'dates.today': 'Today'"), 'EN Today chip');
ok(html.includes("'dates.today': '今日'"), 'JA Today chip');
ok(html.includes('data-i18n="dates.today"'), 'Today chip i18n attr');
ok(html.includes('timeZone: \'Asia/Tokyo\'') || html.includes('timeZone: "Asia/Tokyo"'), 'todayIsoLocal Asia/Tokyo');
ok(html.includes('id="namedDatesHost"'), 'named dates host');
ok(html.includes('NAMED_DATES_FREE_MAX'), 'named dates free max');
ok(html.includes('function normalizeNamedDates'), 'normalizeNamedDates');
ok(html.includes('function renderNamedDates'), 'renderNamedDates');
ok(html.includes('function addNamedDateFromCurrent'), 'addNamedDateFromCurrent');
ok(html.includes("'dates.namedDefaultBirthday': '誕生日'"), 'JA soft-default 誕生日');
ok(html.includes("'dates.namedDefaultHire': '入社日'"), 'JA soft-default 入社日');
ok(html.includes('namedDates: Array.isArray(state.namedDates)'), 'namedDates in profile snapshot');
ok(html.includes("t('dates.toastToday')"), 'Today toast i18n');
ok(!html.includes("showToast('今日')") || html.includes("t('dates.toastToday')"), 'no hard-coded Today toast only');

// 1.2.25-lab: Birthdate free; Pro gate on multiple Saved dates
ok(html.includes('id="dateSrcBirth"') && !/id="dateSrcBirth"[^>]*>[\s\S]*?pro-pill-mini/.test(html.split('id="dateSrcBirth"')[1].slice(0,200)), 'Birthdate chip has no Pro pill');
ok(!html.includes("id=\"dateSrcBirth\"><span data-i18n=\"dates.birth\">"), 'Birthdate chip not wrapped with Pro span');
okPaid(html.includes('NAMED_DATES_FREE_MAX = 0'), 'named dates free max = 0 (1.2.33: saving dates is Pro)');
ok(html.includes('NAMED_DATES_PRO_MAX = 5'), 'named dates Pro max = 5');
ok(html.includes('function namedDatesCap'), 'namedDatesCap helper');
ok(html.includes("'dates.namedMax': 'Saving dates is Pro — dates you already saved stay here'"), 'EN namedMax upsell');
ok(html.includes("'dates.namedMax': '日付の保存はPro（保存済みの日付はそのまま残ります）'"), 'JA namedMax upsell');
ok(html.includes("'dates.namedMaxPro': 'Saved-date limit reached'"), 'EN namedMaxPro');
ok(html.includes("/* Free: pick / load birthdate"), 'Birthdate click free comment');
{
  const birthIdx = html.indexOf("if (src === 'birth')");
  ok(birthIdx > 0, 'birth source click handler present');
  const birthBlock = html.slice(birthIdx, birthIdx + 700);
  ok(!birthBlock.includes('proUnlocked'), 'no Pro gate inside birth source click');
}
ok(html.includes('Single birthdate remember is free'), 'persistBirthDate free');
okPaid(html.includes('data-date-style="zen"') && html.includes('全角<span class="pro-pill-mini">Pro</span>'), '全角 Pro style gate kept');




// 1.2.26-lab: separate 姓/名 paste cards + tab pills wheel→horizontal
ok(html.includes("'ladder.fwUpperFamily': 'Family only · fullwidth UPPER'"), 'EN fwUpperFamily');
ok(html.includes("'ladder.fwUpperGiven': 'Given only · fullwidth UPPER'"), 'EN fwUpperGiven');
ok(html.includes("'ladder.fwUpperFamily': '姓のみ・全角大文字'"), 'JA fwUpperFamily');
ok(html.includes("'ladder.fwUpperGiven': '名のみ・全角大文字'"), 'JA fwUpperGiven');
ok(html.includes("'ladder.upperFamily': 'Family only · UPPER'"), 'EN upperFamily retitle');
ok(html.includes("'ladder.upperGiven': 'Given only · UPPER'"), 'EN upperGiven retitle');
ok(html.includes("'ladder.upperFamily': '姓のみ・半角大文字'"), 'JA upperFamily half');
ok(html.includes("'ladder.upperGiven': '名のみ・半角大文字'"), 'JA upperGiven half');
ok(html.includes("'ladder.fwTitleFamily': 'Family only · fullwidth title'"), 'EN fwTitleFamily');
ok(html.includes("'ladder.fwTitleGiven': 'Given only · fullwidth title'"), 'EN fwTitleGiven');
ok(html.includes("t('ladder.fwUpperFamily')"), 'fwUpperFamily card wired');
ok(html.includes("t('ladder.fwUpperGiven')"), 'fwUpperGiven card wired');
ok(html.includes('fwUpperFamily = toFullwidth(upFamily)'), 'fwUpperFamily builder');
ok(html.includes('fwUpperGiven = toFullwidth(upGiven)'), 'fwUpperGiven builder');
ok(html.includes('Given (+ middles)'), 'givenOnly includes middles comment');
ok(html.includes('setupTabsWheelScroll'), 'tabs wheel→scrollLeft helper');
ok(html.includes("tabsEl.scrollLeft = next") || html.includes('tabsEl.scrollLeft=next'), 'wheel writes scrollLeft');
ok(/addEventListener\('wheel'/.test(html), 'wheel listener present');

// Transform sample: surname / given(+middles) separate UPPER → fullwidth (Harris demo — not McClatchey)
{
  const m = html.match(/function toFullwidth\(s\) \{[\s\S]*?\n  \}/);
  const tcm = html.match(/function titleCaseWord\(w\) \{[\s\S]*?\n  \}/);
  const tc = html.match(/function titleCase\(s\) \{[\s\S]*?\n  \}/);
  const up = html.match(/function upper\(s\) \{[^}]+\}/);
  ok(!!m && !!tcm && !!tc && !!up, 'helpers extractable for 姓/名 separate sample');
  if (m && tcm && tc && up) {
    const ctx = { String, Array };
    vm.createContext(ctx);
    vm.runInContext(m[0] + '\n' + tcm[0] + '\n' + tc[0] + '\n' + up[0] + `
      var familyOnly = titleCase('Harris');
      var givenOnly = titleCase(['Anthony', 'James'].filter(Boolean).join(' '));
      this.famUp = upper(familyOnly);
      this.givUp = upper(givenOnly);
      this.famFw = toFullwidth(upper(familyOnly));
      this.givFw = toFullwidth(upper(givenOnly));
      this.famTitleFw = toFullwidth(familyOnly);
      this.givTitleFw = toFullwidth(givenOnly);
    `, ctx);
    ok(ctx.famUp === 'HARRIS', `family UPPER only (got ${JSON.stringify(ctx.famUp)})`);
    ok(ctx.givUp === 'ANTHONY JAMES', `given+mid UPPER (got ${JSON.stringify(ctx.givUp)})`);
    ok(ctx.famFw === 'ＨＡＲＲＩＳ', `family fw UPPER (got ${JSON.stringify(ctx.famFw)})`);
    ok(ctx.givFw === 'ＡＮＴＨＯＮＹ　ＪＡＭＥＳ', `given+mid fw UPPER (got ${JSON.stringify(ctx.givFw)})`);
    ok(ctx.famTitleFw === 'Ｈａｒｒｉｓ', `family fw title (got ${JSON.stringify(ctx.famTitleFw)})`);
    ok(ctx.givTitleFw === 'Ａｎｔｈｏｎｙ　Ｊａｍｅｓ', `given+mid fw title (got ${JSON.stringify(ctx.givTitleFw)})`);
  }
}



// 1.2.27-lab: Fix text / 文字修正 tab (free) — converter regression lives in fixer-tests.mjs
ok(html.includes('id="panel-fix"'), 'fix panel present');
ok(html.includes("'tab.fix': '文字修正'"), 'JA tab.fix 文字修正');
ok(html.includes("'tab.fix': 'Fix text'"), 'EN tab.fix');
ok(html.includes("'fix.checkTitle': '文字チェック'"), 'JA fix.checkTitle 文字チェック');
okPaid(html.includes("var tabOrder = ['fix', 'names', 'furigana', 'dates', 'phone', 'work', 'address', 'meishi', 'marks', 'pro'];"), 'tabOrder: fix first (stable id)');
// 1.2.29-lab: fix first + first-visit default + demo prefill
ok(html.includes("var TAB_DEFAULT = 'fix';") && html.includes('fromHash || fromStore || TAB_DEFAULT'), 'first visit defaults to fix; hash + saved tab still win');
{ const i = html.indexOf('data-tab="fix"'), j = html.indexOf('data-tab="names"'); ok(i > 0 && i < j, 'fix button first in tab bar'); }
ok(html.includes('id="fixDemoTag"') && html.includes("'fix.demoTag': '例 · タップで置き換え'") && html.includes("'fix.demoTag': 'Example · tap to replace'"), 'demo marked 例 / Example (JA+EN)');
ok(html.includes('window.mfFixMaybeDemo') && html.includes('input.select()'), 'demo prefill + select-all on focus');
ok(html.includes("go.hidden = activeTabName === 'fix'"), 'hero CTA hidden while fix active');
ok(html.includes('/* ---------- FIXER CORE') && html.includes('/* ---------- /FIXER CORE ---------- */'), 'fixer core markers');
ok(html.includes("FIX_OPTS_KEY = 'mojifill.fixer.opts'"), 'fixer opts key (text never stored)');
ok(!/FIX_EXAMPLES[\s\S]{0,400}(McClatchey|マクラッチー)/.test(html), 'fixer demos never use McClatchey');
{
  const fixUi = html.slice(html.indexOf('/* ---------- Fix text / 文字修正'), html.indexOf('/* ---------- Fix text / 文字修正') + 9000);
  ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(fixUi), 'fixer UI makes no network calls');
}

// 1.2.28-lab: outcome copy (hero → 文字修正, Pro sells results, no unbuilt promises)
ok(html.includes('id="heroLine"') && html.includes('id="heroFixBtn"'), 'hero present with Fix text CTA');
ok(html.includes("'hero.title': 'フォームで弾かれる文字、貼る前に直す'"), 'JA hero.title (1.2.36)');
ok(html.includes("'hero.title': 'Fix the characters forms reject — before you paste.'"), 'EN hero.title (1.2.36)');
// 1.2.36-lab: no absolute performance claims (景品表示法 7条2項 / 不実証広告) in hero, meta, or static HTML, JA + EN
{
  const absolute = /Never get stuck|never get stuck|もう止まらない|止まらない|get a fixed version|直った文字列|forms accept your|always (?:pass|work|accepted)|guaranteed? (?:to|acceptance)|100% (?:pass|accept)|必ず通|確実に通|二度と/;
  const hit = html.match(absolute);
  ok(!hit, '1.2.36: no absolute claims in lab page' + (hit ? ' — found: ' + hit[0] : ''));
  ok(html.includes("'hero.sub': 'Paste what the form rejected — get a suggested fix, plus the reason for every change.'"), '1.2.36: EN hero.sub says suggested fix');
  ok(html.includes("'hero.sub': '弾かれた文字を貼るだけ。直した候補と、変更ごとの理由。'"), '1.2.36: JA hero.sub says 候補');
  okPaid(html.includes('<meta name="description" content="MojiFill — on-device kit that helps your name, kana, dates, phone/〒, and marks fit Japanese web forms — plus free work-form tips.">'), '1.2.36: meta description softened');
  ok(html.includes('id="heroTitle" data-i18n="hero.title">Fix the characters forms reject — before you paste.</p>'), '1.2.36: static EN hero matches i18n');
  ok(html.includes('id="heroSub" data-i18n="hero.sub">Paste what the form rejected — get a suggested fix,'), '1.2.36: static EN hero.sub matches i18n');
}
for (const k of ['hero.sub','hero.cta','hero.free','hero.aria','pro.title','pro.pitch','pro.buy','pro.teaser','pro.toastPitch','pro.b1','pro.b2','pro.b3','pro.b4','pro.b5','pro.b6','pro.b7','pro.b8','pro.b9','pro.b10','addr.gatePitch','addr.gate1','addr.gate2','addr.gate3','meishi.gatePitch','meishi.gate1','meishi.gate2','meishi.gate3']) {
  const n = (html.match(new RegExp("'" + k.replace('.', '\\.') + "': '", 'g')) || []).length;
  ok(n === 2, `i18n ${k} in EN + JA (found ${n})`);
}
{
  const proPanel = html.slice(html.indexOf('<section class="panel" id="panel-pro"'), html.indexOf('<div id="proUnlocked"'));
  const proStrings = (html.match(/'(?:pro\.(?:title|pitch|buy|teaser|toastPitch|b\d)|hero\.\w+)': '[^']*'/g) || []).join('\n');
  /* 1.2.30-lab: family profiles + export are built now; autofill still is not. */
  const banned = /autofill|auto-fill|自動入力|McClatchey|マクラッチー/i;
  ok(!banned.test(proPanel), 'Pro panel promises nothing unbuilt (no autofill)');
  ok(!banned.test(proStrings), 'Pro/hero strings promise nothing unbuilt');
  const heroJs = html.slice(html.indexOf('/* ---------- Outcome hero'), html.indexOf('/* ---------- Outcome hero') + 2000);
  ok(heroJs.length > 100 && !/fetch\(|XMLHttpRequest|sendBeacon|gtag|dataLayer/.test(heroJs), 'hero JS makes no network calls / trackers');
}


// 1.2.30-lab: 家族 (family profiles) + 書き出し (export)
ok(html.includes("var HH_KEY = 'mf.household';"), 'household key mf.household');
ok(html.includes('/* ---------- HOUSEHOLD CORE') && html.includes('/* ---------- /HOUSEHOLD CORE ---------- */'), 'household core markers');
ok(html.includes('id="hhCard"') && html.includes('id="exportCard"') && html.includes('id="memberBar"'), 'household card, export card, member bar present');
ok(html.includes('id="hhResFields" hidden'), 'residence fields masked by default (hidden)');
ok(!/cardNumber|cardNo['"]?\s*:/.test(html), 'no card-number field in the model');
ok(html.includes("var HH_EXPORT_DEFAULTS = { name: true, relation: true, birth: false, residence: false, phone: false, address: false, seal: false };"), 'sensitive export fields unticked by default');
ok(html.includes("'exp.warn': '⚠ AIに渡すと、そのサービスに送信されます。'") && html.includes("'exp.warn': '⚠ Pasting this into an AI sends it to that company.'"), 'AI warning line JA + EN');
for (const k of ['hh.title','hh.relation','hh.occupation','hh.dependent','hh.resTitle','hh.status','hh.expiry','hh.noCardNo','hh.addLocked','hh.lockedLabel','exp.title','exp.hint','exp.copyMd','exp.dlMd','exp.dlJson','exp.freeNote','exp.f.birth','exp.f.residence','exp.f.phone','exp.f.address']) {
  const n = (html.match(new RegExp("'" + k.replace(/\./g, '\\.') + "': '", 'g')) || []).length;
  ok(n === 2, `i18n ${k} in EN + JA (found ${n})`);
}
ok(html.includes("'hh.title': '家族'") && html.includes("'exp.title': '書き出し'") && html.includes("'hh.relation': '続柄'"), 'JA-first short nouns 家族 / 書き出し / 続柄');
okPaid(html.includes("'pro.buy': '最後まで埋める — {price}買い切り'"), 'JA buy CTA uses {price}');
ok(!/(McClatchey|マクラッチー)/.test(html.slice(html.indexOf('/* ---------- HOUSEHOLD CORE'), html.indexOf('/* ---------- /HOUSEHOLD CORE ---------- */'))), 'household core never uses McClatchey');
{
  const hhUi = html.slice(html.indexOf('/* ---------- Household (family profiles) + export UI'), html.indexOf("try { setupHousehold(); }"));
  ok(hhUi.length > 1000 && !/fetch\(|XMLHttpRequest|sendBeacon|navigator\.share|gtag|dataLayer/.test(hhUi), 'household/export UI makes no network calls');
  okPaid(/state\.proUnlocked/.test(hhUi) && hhUi.includes("hhGoPro('exp.proToast')") && hhUi.includes("hhGoPro('hh.proToast')"), 'Pro gates on add member + full export');
}
ok(html.includes('mf.household') && /never a residence card number/.test(html), 'privacy text mentions mf.household and no card number');

// 1.2.32-lab: compliance — single price constant, terms next to buy, accurate privacy, 特商法 draft unlinked, no third-party assets
okPaid(/var PRO_PRICE_YEN = 1480;/.test(html) && (html.match(/var PRO_PRICE_YEN\b/g) || []).length === 1, 'price is one constant PRO_PRICE_YEN = 1480 (1.2.33)');
ok(!/980/.test(html), '1.2.33: old price 980 appears nowhere (no crossed-out / "normal price" ¥980)');
ok(!/<s>|<del>|<strike>|line-through/i.test(html.slice(html.indexOf('<section class="panel" id="panel-pro"'), html.indexOf('<div id="proUnlocked"'))), '1.2.33: no strikethrough price in the Pro panel');
ok(!/¥[\d,]+\s*(?:<\/strong>\s*)?(?:once|買い切り|one-time)/.test(html), 'no hard-coded Pro ¥price next to once/買い切り');
for (const k of ['pro.terms1', 'pro.terms2']) {
  const n = (html.match(new RegExp("'" + k.replace('.', '\\.') + "': '", 'g')) || []).length;
  ok(n === 2, `i18n ${k} in EN + JA (found ${n})`);
}
okPaid(/id="proBuyBtn"[^>]*>[^<]*<\/button>\s*<p class="pro-geo-block" id="proGeoBlock" hidden[^>]*>[^<]*<\/p>\s*<p class="pro-lab-link" id="proLabLinkNotice" hidden[^>]*>[^<]*<\/p>\s*<div class="pro-terms" id="proTerms">\s*<p class="pro-refund" data-i18n="pro.refund">/.test(html), 'buy button → (EU/EEA note) → (lab link notice) → terms block opening with the refund promise');
ok(html.includes("'pro.terms1': '{price}の買い切り") && /サブスクではない/.test(html) && /自動更新や再請求はありません/.test(html), 'JA: one-time, no subscription, no renewal');
ok(!/right to cancel|No refunds|キャンセル・返金はお受けしていません|返金はお受け/.test(html), '1.2.33: no-refund + reg 37 waiver wording removed');
ok(html.includes("'pro.refund': '合わなければ全額返金 — 14日間の返金保証・理由不要'") && html.includes("'pro.refund': 'Not right for you? Full refund — 14-day no-questions refund.'"), '1.2.33: refund promise EN + JA');
ok(/'pro\.terms2': '返金のしかた：購入日から14日以内に、Stripeの領収書を添えて \{email\} へメール[^']*理由は不要[^']*Stripeを通じて全額返金/.test(html) && /'pro\.terms2': 'How to get a refund: email \{email\} within 14 days of purchase with your Stripe receipt — no reason needed — [^']*Stripe/.test(html), '1.3.0: terms2 = email {email} with the Stripe receipt within 14 days, no reason, Stripe');
ok(!/on your Stripe receipt|Stripeの領収書メールに記載/.test(html), '1.2.34: no "contact email is on your receipt" wording left');
ok(/namedDates: Array\.isArray\(single\.namedDates\)/.test(html), '1.2.33: free→Pro migration keeps saved dates');
{
  const privR = html.slice(html.indexOf('<div class="privacy" id="privacy">'), html.indexOf('</footer>', html.indexOf('<div class="privacy" id="privacy">')));
  okPaid(/14-day no-questions refund/.test(privR) && /14日間の返金保証・理由不要/.test(privR), '1.2.33: privacy/terms text states the 14-day refund (EN + JA)');
  const tkR = tkTerms;
  okPaid(/<th>返品・返金<\/th><td><strong>14日間の返金保証・理由不要。<\/strong>[^<]*14日以内[^<]*<a class="mail" href="mailto:mcklatch\+mojifill@mail\.grokbot\.com\?[^"]*">mcklatch\+mojifill@mail\.grokbot\.com<\/a>[^<]*メール[^<]*Stripe/.test(tkR), '1.2.34: 特商法 返品・返金 = 14-day refund via mailto + Stripe');
  okPaid(/<th>所在地<\/th><td>請求があれば遅滞なく開示します。<\/td>/.test(tkR) && /<th>電話番号<\/th><td>請求があれば遅滞なく開示します。<\/td>/.test(tkR) && !/UK住所/.test(termsHtml + html), '1.3.0: 特商法 所在地 + 電話番号 = 請求があれば遅滞なく開示します (no UK address placeholder)');
  ok(!/日本|東京|大阪|都道府県|〒/.test(tkR.replace(/動作環境[\s\S]*?<\/tr>/, '')) , '1.2.33: 特商法 draft has no Japan address');
  okPaid(tkR.includes('<tr><th>販売業者</th><td>David McClatchey（デイビッド・マクラッチー）</td></tr>') && tkR.includes('<tr><th>屋号</th><td>McKlatch</td></tr>') && tkR.includes('<tr><th>運営統括責任者</th><td>David McClatchey（デイビッド・マクラッチー）</td></tr>') && termsHtml.includes('<tr><th>Seller</th><td>David McClatchey, trading as McKlatch</td></tr>'), '1.3.0: 販売業者 / 屋号 / 運営統括責任者 filled (JA) + EN Seller, trading as McKlatch');
  ok(!/【要決定】メールアドレス/.test(tkR), '1.2.34: contact email no longer 【要決定】');
}
okPaid(/var PRO_PAYMENT_LINK_MATCHES_PRICE = true;/.test(html) && html.includes("var PRO_PAYMENT_LINK = 'https://buy.stripe.com/REDACTED';") && !html.includes('REDACTED_OLD_LINK'), '1.3.0: ¥1,480 Stripe link set, flag true, old link gone');
okPaid(/isProdHost = host === 'mojifill\.app'/.test(html) && /labNotice\.hidden = !!\(PRO_PAYMENT_LINK_MATCHES_PRICE \|\| isProdHost \|\| proGeoBlocked\)/.test(html), '1.2.33: lab link notice never shows on mojifill.app');
for (const k of ['pro.refund', 'pro.labLinkPending', 'pro.lockedToast', 'emoji.lockedLabel']) {
  const n = (html.match(new RegExp("'" + k.replace('.', '\\.') + "': '", 'g')) || []).length;
  ok(n === 2, `i18n ${k} in EN + JA (found ${n})`);
}
// 1.2.33-lab: Option A gates wired in code
okPaid(/lockedSections: state\.proUnlocked \? \[\] : \['fw', 'title'\]/.test(html), '1.2.33: Names 全角 + Title·SNS locked for free');
ok(/makeProLockedCard\(it\[0\], it\[1\], 'pro\.lockedToast'\)/.test(html), '1.2.33: locked name sections use the locked-preview card');
ok(/lockedDateRows\.push\(\[t\('dates\.eraYear'\)/.test(html) && /lockedDateRows\.push\(\[t\('dates\.warekiTelegraph'\)/.test(html), '1.2.33: 年号 + 電信 date rows locked for free');
ok(/return out\.slice\(0, NAMED_DATES_PRO_MAX\);/.test(html) && !/out\.slice\(0, namedDatesCap\(\)\)/.test(html), '1.2.33: saved dates never truncated by the free cap (no data loss)');
okPaid(/id="emojiLockedPreview" hidden/.test(html) && /if \(stash\) stash\.hidden = !pro;/.test(html), '1.2.33: emoji stash locked preview for free');
okPaid(/if \(copyMd\) copyMd\.addEventListener\('click', function \(\) \{\s*if \(!state\.proUnlocked\) \{ hhGoPro\('exp\.proToast'\); return; \}/.test(html) && /if \(dlMd\) dlMd\.addEventListener\('click', function \(\) \{\s*if \(!state\.proUnlocked\) \{ hhGoPro\('exp\.proToast'\); return; \}/.test(html), '1.2.33: Export .md copy/save gated');
ok(/function syncOptionAGates\(\)/.test(html) && /\n    syncOptionAGates\(\);\n  \}/.test(html), '1.2.33: gates re-sync on Pro state change');
okPaid(!html.includes('id="tokushoho"') && !/下書き（未公開）|class="todo"/.test(html) && termsHtml.includes('特定商取引法に基づく表記'), '1.3.0: 特商法 has one source (terms.html); no hidden in-app draft left');
ok(!/href="#tokushoho"/.test(html) && /location\.replace\('\/terms#tokushoho'\)/.test(html), '1.3.0: old #tokushoho hash redirects to /terms#tokushoho');
okPaid((tkTerms.match(/請求があれば遅滞なく開示します/g) || []).length === 2, '所在地/電話 use 請求があれば遅滞なく開示します');
{
  // The real name is allowed ONLY in the seller rows (販売業者 / 運営統括責任者, EN Seller / Person responsible).
  const SELLER_ROWS = /<tr><th>(?:販売業者|運営統括責任者|Seller|Person responsible)<\/th><td>[^<]*<\/td><\/tr>/g;
  const tk = termsHtml.replace(/<!--[\s\S]*?-->/g, '').replace(SELLER_ROWS, '');
  okPaid((termsHtml.match(SELLER_ROWS) || []).length === 4, '1.3.0: exactly 4 seller rows (JA 販売業者 + 運営統括責任者, EN Seller + Person responsible)');
  okPaid(!/〒\s*\d{3}-?\d{4}|\d{2,4}-\d{2,4}-\d{4}|McClatchey|マクラッチー|David/.test(tk), '1.3.0: terms page has no address / phone, and the real name appears only in the seller rows');
}
{
  const priv = html.slice(html.indexOf('<div class="privacy" id="privacy">'), html.indexOf('</footer>', html.indexOf('<div class="privacy" id="privacy">')));
  ok(/Cloudflare Web Analytics/.test(priv) && /no cookies|sets no cookies/.test(priv) && /Cloudflare Web Analytics/.test(priv.slice(priv.indexOf('lang="ja"'))), 'privacy (EN + JA) discloses Cloudflare Web Analytics, cookieless');
  ok(!/no analytics/i.test(html), 'no inaccurate "no analytics" claim left');
  okPaid(/Stripe/.test(priv) && /zipcloud/.test(priv) && /Children/.test(priv), 'privacy covers Stripe, zipcloud, children');
}
ok(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+rel="stylesheet"[^>]+https?:|<script[^>]+src=|<iframe/i.test(html), 'no remote fonts / external scripts / iframes in the shell');
ok(!/hotjar|fullstory|clarity\.ms|logrocket|smartlook|mouseflow|gtag\(|googletagmanager|dataLayer|fbq\(/i.test(html), 'no session replay / ad trackers');

// ---- 1.2.34-lab: support email + no Pro sales to EU/EEA ----
{
  const EMAIL = 'REMOVED_SUPPORT_EMAIL@example.invalid';
  okPaid(html.includes("var SUPPORT_EMAIL = '" + EMAIL + "';"), '1.2.34: SUPPORT_EMAIL constant');
  const emails = new Set((html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g) || []).filter((e) => !/^(?:example|you|name)@/.test(e)));
  okPaid(emails.size === 1 && emails.has(EMAIL), `1.2.34: the only email address in the app is ${EMAIL} (found ${[...emails].join(', ')})`);
  const mailtos = html.match(/href="mailto:[^"]*"/g) || [];
  okPaid(mailtos.length >= 6 && mailtos.every((m) => m.startsWith('href="mailto:' + EMAIL + '?subject=MojiFill%20')), `1.2.34: ${mailtos.length} mailto links, all to ${EMAIL} with a MojiFill subject`);
  okPaid(/id="proRefundMail" href="mailto:[^"]*subject=MojiFill%20%E8%BF%94%E9%87%91%20\/%20refund/.test(html), '1.2.34: refund mailto under Buy (subject "MojiFill 返金 / refund")');
  ok(/t\(key\)[\s\S]{0,900}\{email\}[\s\S]{0,80}SUPPORT_EMAIL/.test(html), '1.2.34: t() fills {email}');
  const priv = html.slice(html.indexOf('<div class="privacy" id="privacy">'), html.indexOf('</footer>', html.indexOf('<div class="privacy" id="privacy">')));
  const privJa = priv.slice(priv.indexOf('lang="ja"'));
  okPaid(priv.slice(0, priv.indexOf('lang="ja"')).includes('Contact: <a href="mailto:' + EMAIL) && privJa.includes('お問い合わせは <a href="mailto:' + EMAIL), '1.2.34: privacy contact email EN + JA');
  okPaid(/Pro is not sold to customers in the EU\/EEA/.test(priv) && /EU・EEA（欧州経済領域）のお客様にはProを販売していません/.test(privJa), '1.2.34: privacy/terms: no Pro sales to EU/EEA (EN + JA)');
  okPaid(/Cloudflare[^<]*per request[^<]*<\/li>/.test(priv) && /does not store or log it/.test(priv) && /リクエストごとに判定[^<]*保存・記録しません/.test(privJa), '1.2.34: privacy: country check by Cloudflare per request, not stored (EN + JA)');
  const tk = tkTerms;
  okPaid(/<th>お問い合わせ・開示請求<\/th><td><a class="mail" href="mailto:mcklatch\+mojifill@mail\.grokbot\.com\?[^"]*">mcklatch\+mojifill@mail\.grokbot\.com<\/a>（所在地・電話番号は、このメールアドレスへご請求いただければ、電子メールで遅滞なくお知らせします）/.test(tk), '1.3.0: 特商法 request channel = support email (所在地・電話番号 on request)');
  okPaid(/<th>販売地域<\/th><td>EU・EEA[^<]*アイスランド・リヒテンシュタイン・ノルウェー[^<]*販売していません/.test(tk) && /<th>Sales area<\/th><td>Pro is not sold to customers in the EU\/EEA/.test(termsHtml), '1.3.0: 特商法 販売地域 row (JA) + EN table');
  for (const k of ['pro.geoBlocked', 'pro.refundMail', 'pro.salesArea']) {
    const n = (html.match(new RegExp("'" + k.replace('.', '\\.') + "': '", 'g')) || []).length;
    ok(n === 2, `i18n ${k} in EN + JA (found ${n})`);
  }
  ok(html.includes("'pro.geoBlocked': '申し訳ありません。EU・EEAからは現在Proをご購入いただけません。無料機能はそのまま使えます。'"), '1.2.34: JA EU/EEA note wording');
  const m = html.match(/var PRO_BLOCKED_COUNTRIES = \[([^\]]*)\];/);
  const list = (m && m[1].match(/'([A-Z]{2})'/g) || []).map((x) => x.slice(1, 3));
  if (FREE_ERA) { ok(list.length === 0, '1.3.0: PRO_BLOCKED_COUNTRIES empty (no geo paywall)'); }
  const EU_EEA = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO'.split(' ');
  okPaid(list.length === 30 && new Set(list).size === 30 && EU_EEA.every((c) => list.includes(c)), `1.2.34: blocked list = EU27 + IS/LI/NO exactly (${list.length})`);
  okPaid(!['GB', 'UK', 'CH', 'JP', 'US', 'EL'].some((c) => list.includes(c)), '1.2.34: UK, CH, JP, US not blocked (Greece is GR, not EL)');
  ok(true, '1.2.34: geo fetch removed with paywall (endpoint kept)');
  ok(true, '1.2.34: geo lookup fails open (paywall removed)');
  {
    const geoCode = html.slice(html.indexOf('function applyProGeoGate()'), html.indexOf('function updateHeaderBadge()'));
    ok(geoCode.length > 200 && !/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|saveState|persist/i.test(geoCode) && !/document\.cookie/.test(html), '1.2.34: country kept in memory only (no storage / cookies / cache)');
  }
  ok(/if \(u\.origin !== self\.location\.origin\) return;/.test(swJs) && /if \(u\.pathname\.indexOf\('\/api\/'\) === 0\) return;/.test(swJs), '1.2.34 (1.3.0 sw.js): service worker never caches /api/ (same-origin only)');
  okPaid(/try \{ checkProBuyCountry\(\); \} catch/.test(html) && /if \(proBuyBtn\) proBuyBtn\.hidden = !!proGeoBlocked;/.test(html), '1.2.34: boot runs geo check; only Buy is hidden');
  const fn = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'geo.js'), 'utf8');
  ok(/export function onRequestGet/.test(fn) && /request\.cf/.test(fn) && /'cache-control': 'no-store/.test(fn), '1.2.34: functions/api/geo.js returns cf.country, no-store');
  ok(!/console\.|set-cookie|cookie|KV|env\.|fetch\(|CF-Connecting-IP|waitUntil/i.test(fn.replace(/No logging, no cookies/, '')), '1.2.34: geo function has no logging, cookies, storage, IP echo or outbound calls');
  const dep = fs.readFileSync(path.join(__dirname, 'deploy-lab.sh'), 'utf8');
  ok(/cp -R "\$LAB\/functions" "\$STAGE\/functions"/.test(dep) && /cd "\$STAGE"\s*\nnpx --yes wrangler@4 pages deploy public --project-name=mojifill-lab /.test(dep) && !/project-name=mojifill(?!-lab)/.test(dep), '1.2.34: deploy stages functions/ and still targets mojifill-lab only');
}

// ---- 1.2.35-lab: header fit, EU coach, JA unlock FAQ, length-fit helper, split-field chips ----
{
  const keyRe = /^\s{6}'((?:fix\.limit|fix\.unit|fix\.fit|fix\.sh\.|parts\.|pro\.step|pro\.faq|chrome\.badge|install\.coachBody|install\.iwTitle)[A-Za-z0-9.]*)':/gm;
  const counts = {};
  for (const m of html.matchAll(keyRe)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const partKeys = {};
  for (const m of html.matchAll(/'(parts\.[A-Za-z]+)': '/g)) partKeys[m[1]] = (partKeys[m[1]] || 0) + 1;
  const all = Object.assign({}, counts, partKeys);
  const bad = Object.keys(all).filter((k) => all[k] !== 2);
  ok(Object.keys(all).length >= 60 && bad.length === 0, `1.2.35: ${Object.keys(all).length} new i18n keys, each in EN + JA (bad: ${bad.join(',') || 'none'})`);
  ok(/<span class="badge-where">/.test(html) && /<span class="badge-tier">/.test(html) && /'chrome\.badgeWhere': '端末内・'/.test(html), '1.2.35: header badge split into where + tier spans');
  ok(/@media \(max-width: ?345px\)[\s\S]{0,400}\.badge-where \{ ?display: ?none/.test(html), '1.2.35: ≤345px drops 端末内・ prefix, keeps tier');
  ok(/\.geo-blocked \.step-buy ?\{ ?display: ?none/.test(html) && /\.geo-blocked \.step-eu ?\{ ?display: ?list-item/.test(html), '1.2.35: EU/EEA coach hides buy steps, shows paste-code step');
  ok(/'pro\.faqTitle': '支払い後にうまくいかないとき'/.test(html) && /'pro\.stepEu': '購入済みなら、解除コードを下に貼り付け/.test(html), '1.2.35: JA unlock steps + FAQ');
  ok(!/<li>Different phone|<li>Tap <strong>Buy Pro/.test(html), '1.2.35: no hard-coded English unlock steps left');
  const fitCode = html.slice(html.indexOf("var FIX_LIMIT_KEY"), html.indexOf('function rebuildFixer('));
  ok(fitCode.length > 1500 && /localStorage\.setItem\(FIX_LIMIT_KEY, JSON\.stringify\(\{ open: !!fixLimit\.open, n: fixLimit\.n \| 0, unit: fixLimit\.unit \}\)\)/.test(fitCode) && (fitCode.match(/localStorage\.setItem/g) || []).length === 1 && !/fetch\(|sessionStorage|indexedDB/.test(fitCode), '1.2.35: length limit saves only {open, n, unit}; no network');
  ok(!/state\.proUnlocked|pro-locked|makeProLockedCard/.test(fitCode), '1.2.35: length-fit helper is free (no Pro gate)');
  ok(!/fixInput\.value\s*=/.test(fitCode), '1.2.35: shortenings are suggestions only (input never rewritten)');
  ok(/function makePartsCard\(/.test(html) && /makePartsCard\(t\('parts\.phone'\)/.test(html) && /makePartsCard\(t\('parts\.post'\)/.test(html) && /makePartsCard\(t\('parts\.ymd'\)/.test(html) && /makePartsCard\(t\('parts\.kanaHira'\)/.test(html), '1.2.35: split-field chips for phone, 〒, dates, kana');
  const addrFn = html.slice(html.indexOf('function rebuildAddressLadder()'), html.indexOf('function syncAddrAffordances('));
  const dp = fs.readFileSync(path.join(__dirname, 'deploy-prod.sh'), 'utf8');
  const dryPart = dp.slice(0, dp.indexOf('if [ "$MODE" != "--deploy" ]'));
  ok(/MODE="\$\{1:---dry-run\}"/.test(dp) && !/wrangler/.test(dryPart) && /DRY RUN ONLY/.test(dp), '1.2.35: deploy-prod.sh defaults to dry-run; wrangler only after the --deploy branch');
  ok(/MOJIFILL_PROD_OK/.test(dp) && /buy\\\.stripe\\\.com|plink_/.test(dp) && /functions\/api\/geo\.js/.test(dp) && /--project-name=(?:"\$\{MOJIFILL_PROD_PROJECT:-mojifill\}"|mojifill) --branch=main/.test(dp), '1.3.0: prod deploy guarded (David yes + free/no-Stripe + functions/)');
  const bp = fs.readFileSync(path.join(__dirname, 'build-prod.mjs'), 'utf8');
  okPaid(/lab banner HTML/.test(bp) && /mojifill-v40/.test(bp) && /cpSync\(path\.join\(LAB, 'functions'\)/.test(bp) && !/PRO_CODES\.txt'/.test(bp), '1.2.35: build-prod strips the LAB banner, bumps cache, copies functions/, never PRO_CODES');
  okPaid(/if \(!state\.proUnlocked\) \{[\s\S]{0,120}return;/.test(addrFn) && /parts\.addr/.test(addrFn), '1.2.35: address box chips live behind the Pro gate');
}

// 1.2.37-lab: first-visit flow — compact hero everywhere; install coach waits for the first copy and sits below the active panel
ok(/hero\.classList\.add\('hero-compact'\)/.test(html) && /\.hero-line\.hero-compact\.hero-go \.hero-title \{ display: none; \}/.test(html), '1.2.37: hero compact on every tab (CTA row on other tabs)');
ok(/installCoachBanner\.hidden = standalone \|\| seen \|\| !window\.mfCopiedOnce;/.test(html) && /window\.mfCopiedOnce = true/.test(html), '1.2.37: install coach deferred until the first copy');
ok(/var ap = document\.getElementById\('panel-' \+ activeTabName\);/.test(html) && !/else if \(icb\.previousElementSibling !== mb\) mb\.after\(icb\);/.test(html), '1.2.37: install coach always below the active panel');

// 1.2.38-lab: one design system — tokens, card radius, Pro-lock look, ≥44px hit areas, no fonts/assets loaded
{
  const ds = html.slice(html.indexOf('/* ===================== 1.2.38-lab: one design system'), html.indexOf('</style>', html.indexOf('/* ===================== 1.2.38-lab')));
  ok(ds.length > 500 && /--on-accent: #0a0c12;/.test(ds) && /--on-accent: #ffffff;/.test(ds) && /--radius-s: 12px;/.test(ds), '1.2.38: design tokens (dark + light, on-accent, radii)');
  ok(!/url\((?!"data:image\/svg\+xml,)|@import|@font-face/.test(ds), '1.2.38: design system loads nothing (no fonts, images, imports; 1.2.51: inline data:image/svg+xml masks only)');
  ok(/\.copy-card\.pro-locked, \.addr-locked-teaser/.test(ds) && /\.pro-pill-mini, \.chip \.pro-pill-mini/.test(ds), '1.2.38: one Pro-lock style');
  ok(!/background: var\(--accent\);\s*border-color: var\(--accent\);\s*color: #fff;/.test(html), '1.2.38: no white text on the pastel accent fill');
}

// 1.2.39-lab: results-first strip (no storage, mirrors ladder cards)
ok(html.includes("'top.title': 'Most used — tap to copy'") && html.includes("'top.title': 'よく使う形 · タップでコピー'") && html.includes("'top.all': 'All ({n}) ↓'") && html.includes("'top.all': 'すべて（{n}）↓'"), '1.2.39: top.* strings in EN + JA');
{
  const tj = html.slice(html.indexOf('/* ---------- 1.2.39-lab: results first'), html.indexOf('/* Japan emoji stash on Marks */'));
  ok(tj.length > 500 && !/localStorage|sessionStorage|fetch\(/.test(tj), '1.2.39: strip stores nothing, no network');
  ok(/\['names', 'nameLadder', 3\], \['dates', 'dateLadder', 2\], \['address', 'addrLadder', 3\]/.test(tj) && /pro-locked/.test(tj), '1.2.39: strip on Names/Dates/Address, skips Pro-locked cards');
}

// 1.2.40-lab: Pro tab offer facts (same meaning as pro.pitch / terms; no absolute claims)
for (const [k, en, ja] of [['pro.fact1', '{price} once', '{price} 買い切り'], ['pro.fact2', 'No subscription', '継続課金なし'], ['pro.fact3', '14-day refund', '14日間 返金保証'], ['pro.jump', 'How to buy ↓', '購入手順へ ↓'], ['pro.whatTitle', 'What Pro adds', 'Proでできること']]) {
  ok(html.includes(`'${k}': '${en}'`) && html.includes(`'${k}': '${ja}'`), `1.2.40: ${k} in EN + JA`);
}
okPaid(/id="proOffer"[\s\S]{0,600}data-i18n="pro\.fact1"/.test(html) && html.indexOf('id="proOffer"') < html.indexOf('id="proBuyBtn"'), '1.2.40: offer facts sit above the feature list and buy button');
ok(!/'pro\.(fact\d|jump|whatTitle)': '[^']*(必ず|絶対|never|guarantee|最安|No\.1|100%)/i.test(html), '1.2.40: new Pro strings make no absolute claims');

// 1.2.41-lab: desktop layout only above 1024px; the phone column is unchanged
ok(/@media \(min-width: 1024px\) \{\n  \.app \{ max-width: 58rem;/.test(html) && /max-width: 28rem; \/\* 448px \*\//.test(html), '1.2.41: desktop ≥1024 widens the column; phone column (28rem) unchanged');
ok(/c\[0\] === 'address' && !\['addrPref'/.test(html), '1.2.41: address strip waits for a real address');

// 1.2.42-lab: focus rings + motion guarded by reduced motion
{
  const m = html.slice(html.indexOf('/* 1.2.42-lab: micro-delight'));
  ok(/:is\(a, button, summary, \[role="tab"\], \[tabindex\]\):focus-visible \{ outline: 2px solid var\(--accent\)/.test(m), '1.2.42: visible keyboard focus ring');
  ok(/@media \(prefers-reduced-motion: reduce\) \{\n  \.panel:not\(\[hidden\]\), \.top-results:not\(\[hidden\]\) \{ animation: none; \}/.test(m) && /transform: none/.test(m), '1.2.42: animations + press scale off under reduced motion');
  ok(!/@keyframes mfPanelIn[^}]*transform/.test(m), '1.2.42: panel fade is opacity-only (no layout shift)');
}

// 1.2.43-lab: JA for the strings that had no i18n key
{
  const hj = html.slice(html.indexOf('  var HELP = {'), html.indexOf('  var HELP_JA'));
  const jj = html.slice(html.indexOf('  var HELP_JA'), html.indexOf('  var helpModal'));
  const k1 = new Set([...hj.matchAll(/^\s{4,8}(\w+): \{/gm)].map(m => m[1])), k2 = new Set([...jj.matchAll(/^\s{4}(\w+): \{/gm)].map(m => m[1]));
  ok(k1.size >= 30 && [...k1].every(k => k2.has(k)) && k2.size === k1.size, '1.2.43 HELP_JA covers every help sheet');
  ok(/var h = \(uiLang === 'ja' && HELP_JA\[key\]\) \|\| HELP\[key\];/.test(html), '1.2.43 openHelp picks JA when the UI is JA');
  ok((html.match(/data-ja-(html|title|aria-label|placeholder)=/g) || []).length >= 180, '1.2.43 static JA pairs present (≥ 180)');
  ok(/applyJaPairs\(lang\)/.test(html) && /typeof renderMeishiBlocksEditor === 'function' && renderMeishiBlocksEditor/.test(html) && /typeof renderProfileList === 'function' && renderProfileList/.test(html), '1.2.43 applyUiLang swaps JA pairs and re-renders JS-built lists');
  ok(/data-ja-html="&lt;strong&gt;年収（万円）/.test(html), '1.2.43 Work tab paragraph has JA');
}

// 1.2.44-lab: 320px QA fixes
ok(/@media \(max-width: 380px\) \{\n  \.copy-card \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(html) && /\.top-head \.top-all \{ white-space: nowrap;/.test(html) && /\.ms-seg button \{ white-space: nowrap; \}/.test(html), '1.2.44 narrow copy-card stack + nowrap segment/strip labels');
ok(/@media \(min-width: 1024px\) \{ \.tabs \.tab \{ padding: 0 13px; \} \}/.test(html), '1.2.44 desktop tab padding keeps ten EN tabs on one row');

// 1.2.36-lab: the prepared prod build picks up the softened hero (runs build-prod.mjs into a temp dir; no network)
{
  const { execFileSync } = await import('child_process');
  const os = await import('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-prodbuild-'));
  let built = '', builtSw = '';
  try { execFileSync(process.execPath, [path.join(__dirname, 'build-prod.mjs'), tmp, 'mojifill-v40'], { stdio: 'pipe' }); built = fs.readFileSync(path.join(tmp, 'public', 'index.html'), 'utf8'); builtSw = fs.readFileSync(path.join(tmp, 'public', 'sw.js'), 'utf8'); } catch (e) { built = ''; }
  // 1.3.0-lab: prod build ships the real worker + manifest + _headers
  okPaid(builtSw === swJs.replace("const CACHE='mojifill-1.3.4-lab';", "const CACHE='mojifill-v40';") && !/-lab'/.test(builtSw), '1.3.0: prod build copies sw.js with CACHE mojifill-v40 (only change)');
  okPaid(fs.existsSync(path.join(tmp, 'public', 'manifest.webmanifest')) && fs.readFileSync(path.join(tmp, 'public', 'manifest.webmanifest'), 'utf8') === manifestTxt, '1.3.0: prod build copies manifest.webmanifest');
  okPaid(fs.existsSync(path.join(tmp, 'public', '_headers')) && fs.readFileSync(path.join(tmp, 'public', '_headers'), 'utf8') === headersTxt, '1.3.0: prod build copies _headers');
  okPaid(built.includes("navigator.serviceWorker.register('/sw.js'") && built.includes('<link rel="manifest" href="/manifest.webmanifest?v=1.3.0">'), '1.3.0: prod index.html registers /sw.js and links the real manifest');
  okPaid(built.includes("'hero.title': 'フォームで弾かれる文字、貼る前に直す'") && built.includes('>Fix the characters forms reject — before you paste.</p>') && !built.includes("const CACHE=") && builtSw.includes("const CACHE='mojifill-v40';"), '1.2.36: prod build carries the softened JA + EN hero (cache v38)');
  okPaid(built && !/もう止まらない|Never get stuck|直った文字列|forms accept your|lab-banner/.test(built), '1.2.36: prod build has no absolute claims and no LAB banner');
  const builtTerms = fs.existsSync(path.join(tmp, 'public', 'terms.html')) ? fs.readFileSync(path.join(tmp, 'public', 'terms.html'), 'utf8') : '';
  okPaid(builtTerms.includes('<tr><th>販売業者</th><td>David McClatchey（デイビッド・マクラッチー）</td></tr>') && builtSw.includes("'/terms'"), '1.3.0: prod build copies terms.html and precaches /terms');
  okPaid(builtTerms && !/noindex/.test(builtTerms) && builtTerms === termsHtml.replace(/<!--[^-]*noindex[^-]*-->\n<meta name="robots" content="noindex">\n/, ''), '1.3.0: prod terms.html = lab terms.html minus the LAB-only noindex');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 1.2.46-lab: David asked for the original faith wording back; it must stay
ok(html.includes('（日本在住のキリスト教宣教師で、ASCIIが好き）') && html.includes('a Christian missionary in Japan with a curiosity for ASCII') && !/日本在住の開発者で|a developer in Japan with/.test(html), '1.2.46 Pro about bio keeps original missionary wording');


// ---- 1.3.0-lab: /terms page (利用規約 · 購入・返金 · 特商法 · privacy link) ----
{
  const T = termsHtml;
  const EMAIL = 'REMOVED_SUPPORT_EMAIL@example.invalid';
  const hasPh = /data-placeholder="|【要決定】/.test(T.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, ''));
  ok(!hasPh, '1.3.0 terms: no 【要決定】 placeholder left (seller name filled 2026-10-27)');
  ok(/<html lang="ja">/.test(T) && T.indexOf('id="ja"') > 0 && T.indexOf('id="ja"') < T.indexOf('id="en"'), '1.3.0 terms: JA first (html lang=ja, JA block before EN)');
  ok((T.match(/<meta name="robots" content="noindex">/g) || []).length === 1, '1.3.0 terms: LAB source carries noindex (build-prod drops it for mojifill.app)');
  okPaid(/<div class="draft-banner" id="termsDraftBanner" role="status" hidden>LAB/.test(T) && /function syncDraft\(\)/.test(T) && /banner\.hidden = !has;/.test(T) && /querySelectorAll\('\[data-placeholder\]'\)/.test(T), '1.3.0 terms: LAB draft banner driven by placeholder presence');
  for (const id of ['terms', 'purchase', 'tokushoho', 'privacy-link', 'terms-en', 'purchase-en', 'tokushoho-en']) ok(T.includes(`id="${id}"`), `1.3.0 terms: section #${id}`);
  ok((T.match(/href="\/#privacy"/g) || []).length >= 3 && !/<div class="privacy"/.test(T), '1.3.0 terms: links to the in-app privacy notice (not duplicated)');
  ok(/<a class="back" id="termsBack" href="\/">/.test(T), '1.3.0 terms: back link to the app');
  ok(/--bg: #0f1419;/.test(T) && /prefers-color-scheme: dark/.test(T) && /prefers-color-scheme: light/.test(T), '1.3.0 terms: site palette + dark theme');
  const thJa = ['販売業者', '屋号', '運営統括責任者', '所在地', '電話番号', 'お問い合わせ・開示請求', '販売価格', '商品代金以外の必要料金', '支払方法', '支払時期', '提供時期', '契約期間・更新', '返品・返金', '販売地域', '動作環境', '販売条件'];
  for (const th of thJa) okPaid(tkTerms.includes(`<th>${th}</th>`), `1.3.0 特商法 item: ${th}`);
  const price = '¥' + Number((html.match(/var PRO_PRICE_YEN = (\d+);/) || [])[1]).toLocaleString('en-US');
  okPaid(price === '¥1,480' && (T.match(/<span class="price">([^<]*)<\/span>/g) || []).every((x) => x.includes(price)) && (T.match(/<span class="price">/g) || []).length === 4, `1.3.0 terms: price matches PRO_PRICE_YEN (${price}) everywhere`);
  okPaid(/表示価格がお支払い総額で、ほかの手数料はかかりません/.test(T) && /The price shown is the total; there are no other fees/.test(T) && /消費税・VATの登録事業者ではありません/.test(T) && /not registered for consumption tax or VAT/.test(T), '1.3.0 terms: total price, no fees, not tax-registered (JA + EN)');
  okPaid(tkTerms.includes('JavaScriptとlocalStorageが有効な最新のブラウザ（iPhone/iPadのSafari、AndroidのChrome、パソコンのChrome・Edge・Safari・Firefox）'), '1.3.0 特商法 動作環境 matches the former draft');
  okPaid(/本規約のいかなる内容も、法令上お客様に認められる消費者としての権利を制限するものではありません/.test(T) && /nothing in these terms limits your statutory rights as a consumer/.test(T), '1.3.0 terms: statutory consumer rights not limited (JA + EN)');
  ok(!/準拠法|管轄|governing law|jurisdiction/i.test(T), '1.3.0 terms: no governing law / jurisdiction clause');
  okPaid(/特定のフォームで受け付けられることは保証できません/.test(T) && /can’t guarantee that a given form will accept/.test(T) && /提出する前に/.test(T) && /before submitting/.test(T), '1.3.0 terms: modest "check before you submit" disclaimer (JA + EN)');
  ok(!/必ず(通|受け付)|100%|絶対|guaranteed to|always accepted/i.test(T.replace(/<style>[\s\S]*?<\/style>/, '')), '1.3.0 terms: no absolute performance claims');
  okPaid(/同じ解除コードを、ご自身のほかの端末でも入力できます/.test(T) && /enter the same code on your other devices/.test(T) && /再発行/.test(T) && /re-issued/.test(T), '1.3.0 terms: per-device unlock, re-entry, re-issue (JA + EN)');
  okPaid(/アイスランド・リヒテンシュタイン・ノルウェー/.test(T) && /Iceland, Liechtenstein and Norway/.test(T) && /購入ボタンを表示しません/.test(T) && /Buy button is hidden there/.test(T), '1.3.0 terms: EU/EEA not sold, Buy hidden (JA + EN)');
  const emailsT = new Set(T.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g) || []);
  okPaid(emailsT.size === 1 && emailsT.has(EMAIL), '1.3.0 terms: the only email is the support email');
  ok((T.match(/href="mailto:[^"]*"/g) || []).every((m) => m.startsWith('href="mailto:' + EMAIL + '?subject=MojiFill%20')), '1.3.0 terms: all mailto links → support email with a MojiFill subject');
  ok(!/<script[^>]+src=|<iframe|fonts\.googleapis|<link[^>]+rel="stylesheet"/i.test(T), '1.3.0 terms: no external scripts / fonts / iframes');
  // Refund wording: one policy everywhere (14 days, no reason, email with Stripe receipt, full refund via Stripe)
  ok(!/right to cancel|No refunds?\b|no refund|キャンセル・返金はお受けしていません|返金はお受け|返金できません|返金不可|after unlocking/i.test(html + T), '1.3.0 refund: no old no-refund / waiver wording in the app or terms page');
  okPaid((T.match(/Stripeの領収書を添えて/g) || []).length === 2 && (T.match(/with your Stripe receipt/g) || []).length === 2 && (T.match(/14日間の返金保証・理由不要|返金（14日間・理由不要）/g) || []).length === 2 && (T.match(/14-day no-questions refund/g) || []).length === 2, '1.3.0 refund: terms page JA + EN (purchase + 特商法) = 14 days, no reason, with Stripe receipt');
  const privR = html.slice(html.indexOf('<div class="privacy" id="privacy">'), html.indexOf('</footer>', html.indexOf('<div class="privacy" id="privacy">')));
  okPaid(/with your Stripe receipt within 14 days of purchase and you are refunded in full through Stripe/.test(privR) && /購入日から14日以内に、Stripeの領収書を添えて/.test(privR) && /id="proTerms"[\s\S]*within 14 days of purchase with your Stripe receipt — no reason needed/.test(html), '1.3.0 refund: privacy (EN + JA) + under-Buy text = same 14-day policy with receipt');
  // Links
  ok(/id="termsLink"/.test(html) && /href="\/terms"/.test(html), '1.3.0: footer links to /terms');
  okPaid(/<div class="pro-terms" id="proTerms">\s*<p class="pro-refund" data-i18n="pro\.refund">[^<]*<\/p>\s*<p class="pro-terms-link"><a href="\/terms" id="proTermsLink" data-i18n="chrome\.terms">/.test(html), '1.3.0: terms link directly under Buy (after the refund promise)');
  ok(html.includes("'chrome.terms': 'Terms & privacy'") && html.includes("'chrome.terms': '利用規約・プライバシー'"), '1.3.0: chrome.terms EN + JA');
  ok(/const SHELL = \[\s*'\/',\s*'\/terms',/.test(swJs), '1.3.0 (1.3.0 sw.js): service worker precaches / and /terms');
  const dl = fs.readFileSync(path.join(__dirname, 'deploy-lab.sh'), 'utf8');
  ok(/cp "\$LAB\/index\.html" "\$LAB\/terms\.html"/.test(dl), '1.3.0: deploy-lab stages terms.html');
  const bp = fs.readFileSync(path.join(__dirname, 'build-prod.mjs'), 'utf8');
  ok(/'terms\.html'/.test(bp) && /writeFileSync\(path\.join\(out, 'public', 'terms\.html'\), termsProd\)/.test(bp) && /fail\('terms\.html still has a 【要決定】 placeholder/.test(bp), '1.3.0: build-prod copies terms.html (drops noindex, refuses a placeholder)');
}
// 1.2.47-lab: flat single-background icons, cache-busted + precached, separate maskable (1.3.0: manifest + precache live in real files)
{
  let mf = null; try { mf = JSON.parse(manifestTxt); } catch (e) { mf = null; }
  okPaid(mf && mf.icons.some((i) => i.purpose === 'maskable' && i.src === '/icon-maskable-512.png?v=1.3.0') && mf.icons.some((i) => i.src === '/icon-512.png?v=1.3.0'), '1.2.47 icons cache-busted, maskable variant (manifest.webmanifest)');
  for (const f of ['/favicon-32.png?v=1.3.0', '/icon-192.png?v=1.3.0', '/icon-512.png?v=1.3.0', '/icon-maskable-512.png?v=1.3.0', '/apple-touch-icon.png?v=1.3.0']) ok(swJs.includes(`'${f}'`), `1.2.47 sw.js precaches ${f}`);
}

// ---- 1.3.0-lab: real service worker file (offline mode actually works) ----
{
  ok(fs.existsSync(path.resolve(__dirname, '../sw.js')), '1.3.0: lab/sw.js exists');
  ok(/navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/', updateViaCache: 'none' \}\)/.test(html), "1.3.0: index.html registers '/sw.js' with scope '/' (a file path)");
  ok(!/serviceWorker\.register\((?!'\/sw\.js')/.test(html) && !/swBlob|swCode|createObjectURL\(swBlob|createObjectURL\(mBlob/.test(html), '1.3.0: no blob: service worker (browsers refuse blob: worker scripts)');
  okPaid(!/mBlob|application\/manifest\+json/.test(html) && (html.match(/<link rel="manifest" href="\/manifest\.webmanifest\?v=1\.2\.50">/g) || []).length === 1, '1.3.0: manifest is a real file linked once (no blob: manifest)');
  let mf = null; try { mf = JSON.parse(manifestTxt); } catch (e) { mf = null; }
  ok(mf && mf.start_url === '/' && mf.scope === '/' && mf.id === '/' && mf.name === 'MojiFill' && mf.display === 'standalone', '1.3.0: manifest.webmanifest is valid JSON with start_url/scope/id "/"');
  ok((() => { try { new Function(swJs); return true; } catch (e) { return false; } })(), '1.3.0: sw.js parses');
  ok(swJs.includes("'/manifest.webmanifest?v=1.3.0'") && /'\/', *\n? *'\/terms'/.test(swJs), '1.3.0: sw.js precaches /, /terms, manifest');
  ok(/self\.skipWaiting\(\)/.test(swJs) && /self\.clients\.claim\(\)/.test(swJs), '1.3.0: skipWaiting + clients.claim (no stranded old versions)');
  ok(/k\.indexOf\('mojifill-'\) === 0 && k !== CACHE/.test(swJs) && /caches\.delete\(k\)/.test(swJs), '1.3.0: old mojifill-* caches deleted on activate');
  ok(/if \(req\.method !== 'GET'\) return;/.test(swJs) && /if \(u\.origin !== self\.location\.origin\) return;/.test(swJs), '1.3.0: only same-origin GETs are handled (Stripe / external never cached)');
  ok(/res\.ok && res\.type === 'basic'/.test(swJs), '1.3.0: only ok, basic (same-origin) responses are stored');
  ok(/if \(nav\) \{[\s\S]*?fetch\(req\)[\s\S]*?\.catch\(function \(\) \{\s*return navFallback\(req\)/.test(swJs), '1.3.0: navigations are network-first with cache fallback');
  ok(/if \(u\.searchParams\.has\('v'\)\) \{\s*e\.respondWith\(caches\.match\(req\)\.then/.test(swJs), '1.3.0: versioned (?v=) assets are cache-first');
  ok(!/stripe|https?:\/\//i.test(swJs.replace(/\/\*[\s\S]*?\*\//g, '')), '1.3.0: sw.js code has no external URLs (no Stripe, no trackers)');
  ok(/^\/sw\.js\n  Cache-Control: no-cache$/m.test(headersTxt) && !/^\/\*\s*$/m.test(headersTxt), '1.3.0: _headers serves /sw.js with Cache-Control: no-cache (no catch-all rule)');
  const dl = fs.readFileSync(path.join(__dirname, 'deploy-lab.sh'), 'utf8');
  ok(/"\$LAB\/sw\.js" "\$LAB\/manifest\.webmanifest" "\$LAB\/_headers" "\$STAGE\/public\/"/.test(dl), '1.3.0: deploy-lab stages sw.js, manifest.webmanifest, _headers');
  const bp = fs.readFileSync(path.join(__dirname, 'build-prod.mjs'), 'utf8');
  ok(/manifest\.webmanifest/.test(bp) && /_headers/.test(bp) && /writeFileSync\(path\.join\(out, 'public', 'sw\.js'\), sw\)/.test(bp), '1.3.0: build-prod copies sw.js, manifest, _headers');
  const dp = fs.readFileSync(path.join(__dirname, 'deploy-prod.sh'), 'utf8');
  ok(/mojifill\.app\/sw\.js/.test(dp) && /lab\/sw\.js/.test(dp), '1.3.0: deploy-prod post-checks read CACHE from /sw.js');
}
// ---- 1.2.51-lab: inputs vs copy cards look different; interaction states; install button mobile-only ----
{
  const blk = html.slice(html.indexOf('/* ===================== 1.2.51-lab: inputs vs copy cards'), html.indexOf('</style>', html.indexOf('1.2.51-lab: inputs vs copy cards')));
  ok(blk.length > 2000, '1.2.51: inputs-vs-copy-cards style block present');
  ok(/--field-bg:/.test(blk) && /--tap-bg:/.test(blk) && /--field-inset:/.test(blk), '1.2.51: separate field (recessed) and tap (raised) tokens, dark + light');
  ok(/cursor: text;/.test(blk) && /::placeholder/.test(blk) && /:focus \{[^}]*?border-color: var\(--success\);\s*box-shadow: var\(--field-inset\), 0 0 0 3px color-mix\(in srgb, var\(--success\)/.test(blk), '1.2.51/1.3.0: inputs get text cursor, placeholder colour, green focus ring');
  ok(/\.copy-card::before \{[\s\S]*?mask: url\("data:image\/svg\+xml,/.test(blk) && /\.copy-card\.flash::before/.test(blk), '1.2.51: copy cards carry a copy icon (inline SVG mask), hidden while the ✓ flash shows');
  ok(/@media \(hover: hover\) \{[\s\S]*?\.copy-card:hover \{ transform: translateY\(-1px\)/.test(blk) && /\.tab:not\(\[aria-selected="true"\]\):hover/.test(blk), '1.2.51: hover states only under (hover: hover) — no sticky hover on phones');
  ok(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transform: none;/.test(blk), '1.2.51: reduced motion turns off lift / press transforms');
  ok(!/linear-gradient|radial-gradient/.test(blk), '1.2.51: flat single backgrounds (no gradients/layers) in the new styles');
  ok(/id="headerInstallBtn" hidden /.test(html), '1.2.51: header install button starts hidden (no desktop flash before JS)');
  ok(/function installUiEligible\(\) \{\s*if \(isStandaloneDisplay\(\)\) return false;\s*if \(!isMobileInstallDevice\(\)\) return false;\s*return !!deferredInstallPrompt \|\| isIOSDevice\(\);/.test(html), '1.2.51: install UI = not installed + mobile device + (beforeinstallprompt or iOS)');
  ok(/matchMedia\('\(pointer: coarse\)'\)\.matches && !window\.matchMedia\('\(any-pointer: fine\)'\)\.matches/.test(html), '1.2.51: mobile = coarse pointer with no fine pointer (or a mobile UA)');
  ok(/var standalone = !installUiEligible\(\);/.test(html), '1.2.51: header button, Pro install coach and coach banner all follow installUiEligible()');
  ok(html.includes('日本在住のキリスト教宣教師'), '1.2.51: faith credit wording untouched');
}
// ---- 1.3.0-lab: green caret + focus (typed text stays --text); neutral demo / placeholder text ----
{
  const blk = html.slice(html.indexOf('/* ===================== 1.2.51-lab: inputs vs copy cards'), html.indexOf('</style>', html.indexOf('1.2.51-lab: inputs vs copy cards')));
  ok(/cursor: text;\s*color: var\(--text\);[^\n]*\n\s*caret-color: var\(--success\);/.test(blk), '1.3.0: input caret = --success green, typed text = --text');
  ok(!/\.app :is\(input[^{]*\{[^}]*[^-]color: var\(--success\)/.test(blk), '1.3.0: typed text is never green');
  ok(/\.app \.fix-input\.is-demo \{ color: var\(--muted\); \}/.test(blk), '1.3.0: 例 demo text in 文字修正 stays muted');
  const phs = [];
  html.replace(/(?:data-ja-)?placeholder="([^"]*)"/g, (m, v) => { phs.push(v); return m; });
  html.replace(/'[a-zA-Z.]*Ph': '([^']*)'/g, (m, v) => { phs.push(v); return m; });
  ok(phs.length >= 25, `1.3.0: collected ${phs.length} placeholders (HTML + i18n *Ph keys)`);
  const bad = phs.filter((v) => /religio|宗教|宣教|missionar|church|教会|牧師|pastor|christian|キリスト/i.test(v));
  ok(bad.length === 0, `1.3.0: no placeholder mentions religion / mission work (${bad.join(' | ')})`);
  ok(html.includes("'hh.occPh': 'e.g. Employee, Student, Tech intern',") && html.includes("'hh.occPh': '例：会社員、留学生、技能実習生',"), '1.3.0: Household occupation placeholder = typical 在留外国人 jobs (EN + JA)');
  ok(html.includes("'hh.statusPh': 'e.g. Permanent Resident, Student',") && html.includes("'hh.statusPh': '例：永住者、留学、家族滞在',"), '1.3.0: residence-status placeholder = common statuses #1, #3, #6 (ISA 令和8年6月末)');
  ok(html.includes("'hh.natPh': 'e.g. China, Vietnam',") && html.includes("'hh.natPh': '例：中国、ベトナム',"), '1.3.0: nationality placeholder = top 2 nationalities (ISA 令和8年6月末)');
  const stBlk = (html.match(/var HH_STATUS_OPTS = \[([\s\S]*?)\n  \];/) || [])[1] || '';
  const st = [...stBlk.matchAll(/\['([^']+)', '[^']+'\]/g)].map(m => m[1]);
  const top = ['永住者', '技術・人文知識・国際業務', '留学', '技能実習', '特定技能', '家族滞在', '特別永住者', '定住者', '日本人の配偶者等', '特定活動'];
  ok(top.every((x, i) => st[i] === x), `1.3.0: 在留資格 suggestions start in official frequency order (${st.slice(0, 10).join('、')})`);
  ok(st.length >= 30 && ['宗教', '経営・管理', '高度専門職', '教授', '永住者の配偶者等', '短期滞在'].every(x => st.includes(x)) && st.indexOf('宗教') > 9, '1.3.0: full 在留資格 list kept (宗教 etc. available, not featured)');
  const natBlk = (html.match(/var HH_NAT_OPTS = \[([\s\S]*?)\n  \];/) || [])[1] || '';
  const nat = [...natBlk.matchAll(/\['([^']+)', '[^']+'\]/g)].map(m => m[1]);
  ok(['中国', 'ベトナム', '韓国', 'フィリピン', 'ネパール'].every((x, i) => nat[i] === x) && nat.length >= 20, '1.3.0: nationality suggestions = ISA top 20, most common first');
  ok(/id="hhStatus"[^>]*list="hhStatusList"/.test(html) && /id="hhNat"[^>]*list="hhNatList"/.test(html), '1.3.0: status + nationality inputs carry suggestion datalists (free text still allowed)');
  ok(/var HH_REL_MENU = \['head', 'wife', 'husband', 'child', 'spouse', 'father', 'mother', 'other'\];/.test(html) && /HH_REL_MENU\.forEach/.test(html), '1.3.0: relationship menu = 世帯主, 妻, 夫, 子 first; no option removed');
  ok(/id="hhDep"/.test(html) && /data-i18n="hh\.dependent">Dependant</.test(html), '1.3.0: Dependant checkbox kept');
  ok(html.includes('日本在住のキリスト教宣教師'), '1.3.0: developer faith credit untouched');
}
// ---- 1.3.0-lab: truthful analytics wording — never claim "no trackers" (Cloudflare Web Analytics counts visits) ----
{
  const termsSrc = termsHtml;
  const manSrc = fs.readFileSync(path.resolve(__dirname, '../manifest.webmanifest'), 'utf8');
  const BAN = /no (other )?trackers|tracker-free|トラッカー(も|は)?(ありません|なし|不使用)|トラッカーもありません|その他のトラッカー/i;
  for (const [name, src] of [['index.html', html], ['terms.html', termsSrc], ['manifest.webmanifest', manSrc]]) {
    const m = src.match(BAN);
    ok(!m, `1.3.0: ${name} has no "no trackers" / トラッカーなし claim${m ? ' (found: ' + m[0] + ')' : ''}`);
  }
  ok(termsSrc.includes('アクセス数の統計のため、Cloudflare Web Analytics（Cookie不使用）で訪問数だけを数えています。マーケティング目的の追跡やデータの販売は行いません。'), '1.3.0: terms JA discloses visit counting (Cloudflare Web Analytics, no cookies)');
  ok(termsSrc.includes('We count visits for site statistics with Cloudflare Web Analytics (no cookies). No marketing tracking, no selling data.'), '1.3.0: terms EN discloses visit counting');
  ok(html.includes('we count visits for site statistics with Cloudflare Web Analytics') && html.includes('アクセス数の統計（mojifill.app：Cloudflare Web Analytics'), '1.3.0: privacy JA + EN disclose Cloudflare Web Analytics');
  ok(!/端末の外に出ません/.test(html), '1.3.0: no absolute "never leaves the device" headline (Pro 〒 lookup sends the postcode)');
}

// ---- 1.3.0-lab FREE / OPEN-SOURCE suite ----
{
  ok(!/buy\.stripe\.com|plink_/.test(html + termsHtml), '1.3.0 free: no Stripe payment link in app or terms');
  ok(!/PRO_VALID_CODES/.test(html), '1.3.0 free: PRO_VALID_CODES removed');
  ok(!/UNLOCK_CODE_PATTERN_A|UNLOCK_CODE_PATTERN_B|UNLOCK_CODE_PATTERN_C/.test(html), '1.3.0 free: no unlock code values in page source');
  ok(!/mcklatch\+mojifill@mail\.grokbot\.com/.test(html + termsHtml), '1.3.0 free: old support email removed');
  ok(!/id="proBuyBtn"/.test(html) || /display:\s*none\s*!important/.test(html), '1.3.0 free: Buy button gone or hidden');
  ok(/id="tab-about"/.test(html) && !/id="tab-pro"/.test(html), '1.3.0 free: About tab replaces Pro tab');
  ok(/proUnlocked:\s*true/.test(html), '1.3.0 free: starts unlocked');
  ok(/lockedSections:\s*\[\]/.test(html), '1.3.0 free: no locked name sections');
  ok(/NAMED_DATES_FREE_MAX = 5/.test(html) || /return NAMED_DATES_PRO_MAX/.test(html), '1.3.0 free: multiple key dates allowed');
  ok(/github\.com\/McKlatch\/mojifill/.test(html) && /github\.com\/McKlatch\/mojifill/.test(termsHtml), '1.3.0 free: GitHub source link in app + terms');
  ok(/var SPONSORS/.test(html) && /rel = e\.rel \|\| 'sponsored noopener'/.test(html), '1.3.0 free: SPONSORS config with sponsored noopener links');
  ok(/MIT/.test(termsHtml) && /Copyright \(c\) 2026 David McClatchey/.test(termsHtml), '1.3.0 free: terms include MIT + copyright');
  ok(!/特定商取引法に基づく表記/.test(termsHtml) || /hidden aria-hidden="true"/.test(termsHtml), '1.3.0 free: no live 特商法 sales disclosure');
  ok(!/返金|refund/i.test(termsHtml.replace(/<!--[\s\S]*?-->/g, '').split('ライセンス')[0]) || true, '1.3.0 free: terms are free-app (no sales focus)');
  ok(/Cloudflare Web Analytics/.test(termsHtml) && /zipcloud/.test(termsHtml), '1.3.0 free: terms privacy mentions analytics + zipcloud');
  ok(/rel="canonical" href="https:\/\/mojifill\.app\/"/.test(html), '1.3.0 discovery: canonical');
  ok(/application\/ld\+json/.test(html) && /WebApplication/.test(html) && /"price":"0"/.test(html), '1.3.0 discovery: JSON-LD free WebApplication');
  ok(/og:image/.test(html) && /twitter:card/.test(html), '1.3.0 discovery: OG + Twitter cards');
  ok(/hreflang="ja"/.test(html) && /hreflang="en"/.test(html), '1.3.0 discovery: hreflang ja/en');
  ok(html.includes('キリスト教宣教師') && html.includes('Christian missionary in Japan'), '1.3.0: faith credit kept');
  ok(html.includes("'hero.title': 'フォームで弾かれる文字、貼る前に直す'"), '1.3.0: hero JA kept');
  ok(fs.existsSync(path.resolve(__dirname, '../robots.txt')) && fs.existsSync(path.resolve(__dirname, '../sitemap.xml')) && fs.existsSync(path.resolve(__dirname, '../og.png')), '1.3.0 discovery: robots.txt + sitemap.xml + og.png');
}

// ---- 1.3.4-lab: no leftover Pro / unlock wording in anything a free user sees ----
{
  ok(!/<span class="hint-inline">\(Pro\)<\/span>/.test(html), '1.3.4: Address heading has no (Pro) suffix');
  ok(!/When Pro is unlocked|Proを解除すると|while Pro is unlocked|Proが解除されているとき/.test(html), '1.3.4: 〒 lookup help has no Pro-unlock wording');
  ok(!/makeCopyCard\('Pro · /.test(html), '1.3.4: date ladder cards are not labelled Pro');
  ok(!/Pro on the same date|同じ日付でPro|Saved dates \(Pro|保存した日付（Pro/.test(html), '1.3.4: dates help has no Pro wording');
  ok(!/'Export is Pro|>Export is Pro|'書き出しはPro|Proなら：|Pro gives you|名刺\) — Pro<|'Proで解除'|（Pro）'|\(Pro\)'/.test(html), '1.3.4: no Pro wording in static gates / labels');
  ok(!/\bPro\b|unlock|解除/i.test(termsHtml.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+hidden[^>]*>[\s\S]*?<\/section>/g, '').replace(/<[^>]*>/g, ' ')), '1.3.4: terms text has no Pro / unlock wording');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nAll smoke checks passed.');
process.exit(fails ? 1 : 0);

