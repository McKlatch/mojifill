#!/usr/bin/env node
/**
 * MojiFill lab — 文字修正 (Fix text) converter + 家族/書き出し household core regression tests. No browser.
 * Extracts the pure FIXER CORE block from lab/index.html and runs it in a vm.
 * Run: node lab/tests/fixer-tests.mjs   (deploy-lab.sh runs it before deploy)
 * Demo strings: SMITH / 山田 style only — never real users.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; console.log('  PASS', msg); }
  else { fails++; console.error('  FAIL', msg); }
}
const a = html.indexOf('/* ---------- FIXER CORE');
const b = html.indexOf('/* ---------- /FIXER CORE ---------- */');
if (a < 0 || b < 0) { console.error('FIXER CORE markers missing'); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + '\nthis.fixChars = fixChars; this.fxCells = fxCells; this.fxMarks = fxMarks; this.fxLimitUnits = fxLimitUnits; this.fxOverflowIndex = fxOverflowIndex; this.fxShortenOptions = fxShortenOptions; this.fxApplyShorten = fxApplyShorten;', ctx);
const fix = (s, o) => ctx.fixChars(s, o || {});
const codes = (r) => r.changes.map((c) => c.code);
const has = (r, from, to, code) => r.changes.some((c) => c.from === from && c.to === to && (!code || c.code === code));
const sug = (r, from, to, code) => r.suggestions.some((c) => c.from === from && c.to === to && (!code || c.code === code));
function eq(input, opts, want, msg) {
  const r = fix(input, opts);
  ok(r.output === want, `${msg}: ${JSON.stringify(input)} → ${JSON.stringify(want)} (got ${JSON.stringify(r.output)})`);
  return r;
}

console.log('MojiFill fixer regression');

// --- Kanji ↔ katakana confusables (only inside a katakana run) ---
let r = eq('ジョ二ー', {}, 'ジョニー', '二 (漢数字) → ニ in kana run');
ok(has(r, '二', 'ニ', 'kansujiKana'), '二→ニ reason kansujiKana');
eq('二丁目', {}, '二丁目', "don't convert 二 in 二丁目");
eq('ノ二丁目', {}, 'ノ二丁目', "don't convert 二 before kanji even after kana");
eq('佐藤二コ', {}, '佐藤二コ', 'kanji on one side → not converted');
eq('一つ', {}, '一つ', "don't convert 一 before hiragana okurigana");
eq('二人', {}, '二人', '二人 untouched');
r = eq('ヤマダ タ口ウ', {}, 'ヤマダ タロウ', '口 → ロ in kana run');
ok(has(r, '口', 'ロ', 'kanjiKana'), '口→ロ reason kanjiKana');
eq('入口', {}, '入口', '入口 untouched');
eq('力夕力ナ', {}, 'カタカナ', '力→カ, 夕→タ chained confusables');
eq('工レベーター', {}, 'エレベーター', '工 → エ');
eq('工場', {}, '工場', '工場 untouched');
eq('ハ八ー', {}, 'ハハー', '八 → ハ');
eq('八百屋', {}, '八百屋', '八百屋 untouched');
eq('夕方', {}, '夕方', '夕方 untouched');
eq('力持ち', {}, '力持ち', '力持ち untouched');

// --- 一 → ー (長音) ---
r = eq('ス一パー', {}, 'スーパー', '一 → ー after katakana');
ok(has(r, '一', 'ー', 'choonKanji'), '一→ー reason choonKanji');
eq('ジョ二一', {}, 'ジョニー', '二一 → ニー (confusable then long vowel)');
eq('タ一郎', {}, 'タ一郎', '一 before kanji stays');
eq('一丁目', {}, '一丁目', '一丁目 untouched');

// --- Dashes: - or ー by context ---
r = eq('コ-ヒ-', {}, 'コーヒー', 'ASCII - after kana → ー');
ok(codes(r).every((c) => c === 'choon'), 'reason choon');
eq('ラ―メン', {}, 'ラーメン', '― after kana → ー');
eq('ら－めん', {}, 'らーめん', '－ after hiragana → ー');
eq('セ−ル', {}, 'セール', '− (minus) after kana → ー');
eq('ﾊﾟｰﾃｨ-', {}, 'ﾊﾟｰﾃｨｰ', 'halfwidth kana run keeps halfwidth ｰ');
r = eq('090―1234―5678', {}, '090-1234-5678', '― between digits → -');
ok(has(r, '―', '-', 'hyphen'), '―→- reason hyphen');
eq('090‐1234−5678', {}, '090-1234-5678', '‐ and − between digits → -');
eq('090ー1234ー5678', {}, '090-1234-5678', 'ー between digits → -');
eq('０９０ー１２３４', {}, '０９０－１２３４', 'ー between fullwidth digits → －');
eq('090－1234', {}, '090-1234', '－ in ASCII digits → -');
eq('０９０－１２３４', {}, '０９０－１２３４', 'consistent fullwidth － kept in auto');
eq('090-1234-5678', {}, '090-1234-5678', 'clean ASCII phone untouched');
eq('090－1234', { width: 'fw' }, '０９０－１２３４', '全角 target → －');
eq('東京ー大阪', {}, '東京ー大阪', 'ー after kanji not a clear mistake (auto)');

// --- Bank chip: ヴ→ブ, small kana → large (only with chip) ---
eq('ヴィクトリア', {}, 'ヴィクトリア', 'ヴ kept without bank chip');
r = eq('ヴィクトリア', { bank: true }, 'ビクトリア', 'ヴィ → ビ with bank chip');
ok(codes(r).includes('bankVu'), 'reason bankVu');
eq('ヴ', { bank: true }, 'ブ', 'ヴ → ブ (銀行向け)');
eq('ティ', {}, 'ティ', 'small ィ kept without chip');
r = eq('ティ', { bank: true }, 'テイ', 'small ィ → イ with bank chip');
ok(has(r, 'ィ', 'イ', 'bankSmall'), 'reason bankSmall');
eq('ジョッシュ', { bank: true }, 'ジヨツシユ', 'all small kana large (bank)');
eq('ｳﾞｪ', { bank: true }, 'ﾍﾞ', 'halfwidth ｳﾞｪ → ﾍﾞ (bank)');

// --- Spaces: fullwidth vs ideographic vs double, NBSP, TAB ---
r = eq('山田\u3000\u3000太郎', {}, '山田\u3000太郎', 'double ideographic → one');
ok(codes(r).includes('spaceCollapse'), 'reason spaceCollapse');
eq('SMITH  JOHN', {}, 'SMITH JOHN', 'double ASCII → one');
eq('山田\u3000 太郎', {}, '山田\u3000太郎', 'mixed ideographic+ASCII run → first kind');
eq('山田 太郎', {}, '山田 太郎', 'single ASCII between kanji kept (auto)');
eq('山田\u3000太郎', {}, '山田\u3000太郎', 'single ideographic between kanji kept (auto)');
eq('SMITH\u3000John', {}, 'SMITH John', 'ideographic space between ASCII → ASCII');
r = eq('山田\u00A0太郎', {}, '山田\u3000太郎', 'NBSP between kanji → ideographic');
ok(codes(r).includes('spaceOdd'), 'reason spaceOdd');
eq('SMITH\tJohn', {}, 'SMITH John', 'TAB → ASCII space');
eq('SMITH\nJohn', {}, 'SMITH John', 'newline → space');
eq('  山田 ', {}, '山田', 'leading/trailing spaces trimmed');
eq('山田 太郎', { width: 'fw' }, '山田\u3000太郎', '全角 target → ideographic space');
eq('山田\u3000太郎', { width: 'hw' }, '山田 太郎', '半角 target → ASCII space');

// --- Invisible / control chars removed ---
r = eq('ス\u200Bミス', {}, 'スミス', 'ZWSP removed');
ok(has(r, '[ZWSP]', '', 'invisible'), 'ZWSP change shows [ZWSP] → removed');
eq('\uFEFF山田', {}, '山田', 'BOM removed');
eq('山\u200D田\u200C', {}, '山田', 'ZWJ/ZWNJ removed');
eq('SMI\u00ADTH', {}, 'SMITH', 'soft hyphen removed');
eq('\u200E山田\u200F', {}, '山田', 'LRM/RLM removed');
r = eq('山田\u0007太郎', {}, '山田太郎', 'control char removed');
ok(codes(r).includes('control'), 'reason control');
eq('👨\u200D👩', {}, '👨\u200D👩', 'ZWJ inside emoji kept');

// --- Combined dakuten (macOS NFD paste) ---
r = eq('カ\u3099ス', {}, 'ガス', 'combining dakuten composed');
ok(codes(r).includes('dakuten'), 'reason dakuten');
eq('ハ\u309Aン', {}, 'パン', 'combining handakuten composed');

// --- 環境依存 / 異体字: suggestion + warning, never silent ---
r = eq('髙橋', {}, '髙橋', '髙 NOT silently swapped');
ok(sug(r, '髙', '高', 'variant'), '髙→高 suggested');
ok(r.withSuggestions === '高橋', 'withSuggestions 高橋');
r = eq('山﨑', {}, '山﨑', '﨑 NOT silently swapped');
ok(sug(r, '﨑', '崎'), '﨑→崎 suggested');
r = eq('①', {}, '①', '① NOT silently swapped');
ok(sug(r, '①', '(1)', 'envDep'), '①→(1) suggested');
r = eq('㈱山田', {}, '㈱山田', '㈱ NOT silently swapped');
ok(sug(r, '㈱', '(株)', 'envDep'), '㈱→(株) suggested');
r = fix('Ⅲ'); ok(sug(r, 'Ⅲ', 'III'), 'Roman numeral Ⅲ→III suggested');
r = fix('㍻'); ok(sug(r, '㍻', '平成'), '㍻→平成 suggested');
r = fix('入ロ'); ok(r.output === '入ロ' && sug(r, 'ロ', '口', 'kataInKanji'), 'katakana ロ inside kanji → 口 suggested only');
r = fix('葛\u{E0100}'); ok(r.output === '葛\u{E0100}' && r.suggestions.some((s) => s.code === 'ivs') && r.withSuggestions === '葛', 'IVS kept, removal suggested');

// --- Target chips ---
eq('やまだ たろう', { script: 'kata' }, 'ヤマダ タロウ', 'カタカナ target');
eq('ヤマダ タロウ', { script: 'hira' }, 'やまだ たろう', 'ひらがな target');
eq('ｽﾐｽ ｼﾞｮﾝ', { width: 'fw' }, 'スミス\u3000ジョン', '全角 target: halfwidth kana → fullwidth');
eq('ｽﾐｽ', { script: 'kata' }, 'スミス', 'カタカナ target normalises halfwidth kana');
eq('スミス　ジョン', { width: 'hw' }, 'ｽﾐｽ ｼﾞｮﾝ', '半角 target: katakana → halfwidth');
eq('ＳＭＩＴＨ　１２３', { width: 'hw' }, 'SMITH 123', '半角 target: fullwidth ASCII → ASCII');
eq('SMITH 123', { width: 'fw' }, 'ＳＭＩＴＨ\u3000１２３', '全角 target: ASCII → fullwidth');
eq('コーヒー', { width: 'hw' }, 'ｺｰﾋｰ', '半角 target: ー → ｰ');
eq('ｽﾐｽ', {}, 'ｽﾐｽ', 'auto leaves halfwidth kana alone');
eq('ＳＭＩＴＨ', {}, 'ＳＭＩＴＨ', 'auto leaves fullwidth ASCII alone');
eq('ヤマダ', {}, 'ヤマダ', 'clean text → no change');
ok(fix('ヤマダ').changes.length === 0, 'clean text → empty change list');

// --- Counts (raw chars + byte-style, fullwidth = 2) ---
r = fix('山田 Taro');
ok(r.counts.inChars === 7 && r.counts.inCells === 9, `counts 山田 Taro = 7 chars / 9 bytes (got ${r.counts.inChars}/${r.counts.inCells})`);
ok(ctx.fxCells('ｽﾐｽ') === 3 && ctx.fxCells('スミス') === 6, 'halfwidth kana = 1, fullwidth = 2');
r = fix('スミス\u3000\u3000ジョ二一\u200B');
ok(r.output === 'スミス\u3000ジョニー' && r.counts.inChars === 10 && r.counts.outChars === 8 && r.counts.outCells === 16, 'demo string counts 10→8 chars, 16 bytes');

// --- Per-character marks ---
const m = ctx.fxMarks(Array.from('ス\u200Bミ二ー\u00A0―髙ｶ'));
const kinds = m.map((x) => x.kind);
ok(kinds[1] === 'invisible' && m[1].show === '[ZWSP]', 'ZWSP badge [ZWSP]');
ok(kinds[3] === 'confuse', '二 next to kana flagged confusable');
ok(kinds[5] === 'invisible' && m[5].show === '[NBSP]', 'NBSP badge');
ok(kinds[6] === 'confuse', '― flagged');
ok(kinds[7] === 'env', '髙 flagged 環境依存');
ok(kinds[8] === 'hw', 'ｶ flagged halfwidth');
ok(ctx.fxMarks(Array.from('二丁目')).every((x) => !x.kind), '二丁目 no badges');
{ const mk2 = ctx.fxMarks(Array.from('ジョ二一\u200B')); ok(mk2[2].kind === 'confuse' && mk2[3].kind === 'confuse', '二一 chain next to kana both flagged'); }

// --- No network / storage inside core ---
const core = html.slice(a, b);
ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\./.test(core), 'core is pure (no network/storage/DOM)');


// ---------- 1.2.30-lab: HOUSEHOLD CORE (family profiles + export) ----------
{
  const ha = html.indexOf('/* ---------- HOUSEHOLD CORE');
  const hb = html.indexOf('/* ---------- /HOUSEHOLD CORE ---------- */');
  ok(ha > 0 && hb > ha, 'household core markers');
  const hctx = {};
  vm.createContext(hctx);
  vm.runInContext(html.slice(ha, hb) + '\nthis.H = { hhReconcile, hhBuildExport, hhSanitizeMember, hhStripCardNo, hhOrder, hhLot, hhDaysUntil, HH_EXPORT_DEFAULTS, HH_KEY };', hctx);
  const H = hctx.H;
  const D = {
    kataToHira: (s) => String(s).replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)),
    toHalfwidth: (s) => String(s).replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' '),
    toFullwidth: (s) => String(s).replace(/[\x21-\x7e]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)),
    toWareki: (iso) => (iso === '1985-04-12' ? { full: '昭和60年4月12日' } : null),
    kanaToRomaji: (s) => ({ 'ヤマダ': 'yamada', 'タロウ': 'tarou', 'ハナコ': 'hanako' }[s] || '')
  };
  ok(H.HH_KEY === 'mf.household', 'key mf.household');
  // model
  const m = H.hhSanitizeMember({ id: 'x', relation: 'wife', nationality: '英国', occupation: '扶養家族', residenceStatus: '家族滞在 AB12345678CD', cardExpiry: '2027-01-15', dependent: 1, cardNumber: 'AB12345678CD', evil: '<x>' });
  ok(m.relation === 'wife' && m.nationality === '英国' && m.occupation === '扶養家族' && m.dependent === true && m.cardExpiry === '2027-01-15', 'member model: 続柄/国籍/職業/扶養/在留期間');
  ok(!('cardNumber' in m) && !('evil' in m) && m.residenceStatus === '家族滞在', 'member model: whitelist only, card number stripped');
  ok(H.hhStripCardNo('ＡＢ１２３４５６７８ＣＤ').hit && H.hhStripCardNo('永住者').hit === false, 'card number detection (full/halfwidth)');
  ok(H.hhSanitizeMember({ relation: 'boss' }).relation === 'other' && H.hhSanitizeMember({ cardExpiry: '2027/1/1' }).cardExpiry === '', 'unknown 続柄 → other; bad dates dropped');
  ok(H.hhOrder([{ id: 'c', relation: 'child' }, { id: 'h', relation: 'head' }, { id: 'w', relation: 'wife' }]).map((x) => x.id).join('') === 'hwc', 'members ordered by 続柄 (世帯主 → 妻 → 子)');
  ok(H.hhDaysUntil('2026-12-31', '2026-10-21') === 71 && H.hhDaysUntil('', '2026-10-21') === null, 'days until expiry (90-day reminder input)');
  // migration
  let r = H.hhReconcile(null, { pro: false });
  ok(r.migrated && r.hh.members.length === 1 && r.hh.members[0].id === 'solo' && r.hh.members[0].relation === 'head', 'free migration: single profile → head member');
  r = H.hhReconcile(null, { pro: true, profileIds: ['a', 'b'], activeId: 'b', addresses: { a: {}, b: { pref: '東京都' } } });
  ok(r.hh.members.find((x) => x.id === 'b').relation === 'head' && r.hh.members.find((x) => x.id === 'a').relation === 'other' && r.hh.sharedAddress === true, 'Pro migration: active profile → head, others → その他, shared address');
  r = H.hhReconcile(null, { pro: true, profileIds: ['a', 'b'], activeId: 'a', addresses: { a: { pref: '東京都' }, b: { pref: '大阪府' } } });
  ok(r.hh.sharedAddress === false, 'Pro migration: different saved addresses kept (sharedAddress off → no address loss)');
  const solo = { v: 1, sharedAddress: true, members: [{ id: 'solo', relation: 'head', nationality: '英国', occupation: '会社員', residenceStatus: '永住者', cardExpiry: '2028-03-31', dependent: false }] };
  r = H.hhReconcile(JSON.parse(JSON.stringify(solo)), { pro: true, profileIds: ['p1'], activeId: 'p1' });
  ok(r.hh.members.length === 1 && r.hh.members[0].id === 'p1' && r.hh.members[0].occupation === '会社員' && r.hh.members[0].residenceStatus === '永住者', 'free → Pro: head details carried to the profile id (no loss)');
  r = H.hhReconcile(JSON.parse(JSON.stringify(r.hh)), { pro: true, profileIds: ['p1'], activeId: 'p1' });
  ok(!r.changed, 'reconcile is idempotent');
  // export honours unticked fields
  const entries = [
    { member: { id: 'h', relation: 'head', occupation: '会社員', nationality: '英国', residenceStatus: '永住者', cardExpiry: '2028-03-31' }, profile: { family: '山田', given: '太郎', familyKana: 'ヤマダ', givenKana: 'タロウ', birthDate: '1985-04-12', phone: '０９０－１２３４－５６７８' } },
    { member: { id: 'w', relation: 'wife', dependent: true, residenceStatus: '家族滞在' }, profile: { family: '山田', given: '花子', familyKana: 'ヤマダ', givenKana: 'ハナコ' } }
  ];
  const addr = { postal: '150-0001', pref: '東京都', city: '渋谷区', town: '神宮前', banchi: '１丁目２－３４' };
  let x = H.hhBuildExport(entries, addr, H.HH_EXPORT_DEFAULTS, { today: '2026-10-21' }, D);
  const s0 = JSON.stringify(x.json) + x.md;
  ok(x.json.mojifill === 'profile/1' && x.json.people.length === 2 && x.json.people[0].relation === '世帯主' && x.json.people[1].relation === '妻', 'export defaults: names + 続柄');
  ok(!/1985|090|東京都|在留資格|英国|2028|家族滞在/.test(s0) && !x.json.address && !x.json.people[0].residence, 'export defaults: birth/phone/address/residence excluded');
  ok(x.json.people[0].name.hiragana.given === 'たろう' && x.json.people[0].name.latin.family === 'YAMADA', 'export: kana + hiragana + Latin');
  ok(x.md.indexOf('AIに渡すと、そのサービスに送信されます') >= 0, 'brief carries the AI warning');
  x = H.hhBuildExport(entries, addr, { relation: true, birth: true, residence: true, phone: true, address: true }, { today: '2026-10-21', lang: 'en' }, D);
  ok(x.json.people[0].birth.wareki === '昭和60年4月12日' && x.json.people[0].residence.status === '永住者' && x.json.people[0].phone.digits === '09012345678', 'export ticked: birth (和暦), residence, phone');
  ok(x.json.address.lot.half === '1丁目2-34' && x.json.address.lot.banchi === '1丁目2番34号', 'export address: 番地 halfwidth + 番・号');
  ok(x.md.indexOf('# MojiFill form brief') === 0 && x.md.indexOf('Pasting this into an AI sends it to that company.') >= 0, 'EN brief + warning');
  x = H.hhBuildExport(entries.slice(0, 1), addr, { name: false }, {}, D);
  ok(x.json.people[0].name.written.family === '山田' && !x.json.people[0].relation, 'name is always included; relation off when unticked');
  ok(H.hhLot('1-2-34', D).banchi === '1丁目2番34号' && H.hhLot('', D) === null, '番地 1-2-34 → 1丁目2番34号');
  const hcore = html.slice(ha, hb);
  ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\./.test(hcore), 'household core is pure (no network/storage/DOM)');
}

// ---------- 1.2.35-lab: length-fit helper (pure core) ----------
{
  const L = ctx.fxLimitUnits, OV = ctx.fxOverflowIndex, SO = ctx.fxShortenOptions, AP = ctx.fxApplyShorten;
  ok(L('東京都1-2', 'chars') === 6 && L('東京都1-2', 'bytes') === 9, 'limit units: chars vs SJIS-style bytes');
  ok(L('ｽﾐｽ　A', 'bytes') === 6 && L('😀', 'chars') === 1, 'limit units: half-width kana 1 byte, U+3000 2, emoji = 1 char');
  ok(OV('あいうabc', 5, 'bytes') === 2 && OV('あいう', 2, 'chars') === 2 && OV('a😀b', 1, 'chars') === 1, 'overflow index: first code point past the limit');
  ok(OV('あいう', 3, 'chars') === 3 && OV('あいう', 6, 'bytes') === 3, 'overflow index: fits → length (nothing marked)');
  const A = '東京都港区芝公園１丁目２番３号　サンプルハイツ１０１号室';
  let o = SO(A, 'chars', {});
  const codes = o.map((x) => x.code + (x.safe ? '+' : '-'));
  ok(codes.join(',') === 'pref-,addrNum+,spaces-', 'shorten (chars): pref + spaces are opt-in, 丁目/番/号 safe (' + codes.join(',') + ')');
  ok(AP(A, ['addrNum'], 'chars') === '東京都港区芝公園１-２-３　サンプルハイツ１０１号室', 'shorten: 1丁目2番3号 → 1-2-3, 101号室 kept');
  o = SO(A, 'bytes', {});
  ok(o.some((x) => x.code === 'fwAscii' && x.safe) && o.some((x) => x.code === 'hwKana' && !x.safe), 'shorten (bytes): 全角→半角 safe, 半角カナ opt-in');
  ok(AP(A, ['addrNum', 'fwAscii'], 'bytes') === '東京都港区芝公園1-2-3 サンプルハイツ101号室', 'shorten (bytes): combined result');
  ok(!SO(A, 'bytes', { width: 'fw' }).some((x) => x.code === 'fwAscii' && x.safe), 'shorten: 全角→半角 not "safe" when the form wants 全角');
  ok(AP('大阪市北区三丁目5番地12', ['addrNum'], 'chars') === '大阪市北区3-5-12', 'shorten: 三丁目5番地12 → 3-5-12');
  ok(AP('札幌市中央区北1条西2丁目3番地', ['addrNum'], 'chars') === '札幌市中央区北1条西2-3', 'shorten: trailing 番地 dropped, 条 kept');
  ok(AP('港区1号館3号室', ['addrNum'], 'chars') === '港区1号館3号室', 'shorten: 号館 / 号室 untouched');
  ok(SO('ABC', 'chars', {}).length === 0 && SO('', 'bytes', {}).length === 0, 'shorten: nothing to offer → empty');
  ok(AP('北海道札幌市', ['pref'], 'chars') === '札幌市' && AP('京都府京都市', ['pref'], 'chars') === '京都市', 'shorten: prefecture strip (opt-in) handles 北海道 / 京都府');
  ok(SO(A, 'chars', {}).every((x) => x.saved >= 1), 'shorten: only options that save ≥1 are listed');
}

console.log(fails ? `\n${fails} FAILURE(S), ${passes} passed` : `\nAll ${passes} fixer checks passed.`);
process.exit(fails ? 1 : 0);
