# MojiFill

**Fix the characters Japanese forms reject — before you paste.**

Free, open-source PWA for foreign residents in Japan. Names, furigana, dates, phone/〒, household export — processed **on your device**. No account. No ads.

🌐 https://mojifill.app/  
🧪 Lab: https://lab.mojifill.app/

日本語の政府・銀行・会社のフォームで弾かれがちな全角/半角・カタカナ・日付・電話/〒を、端末内で直してコピーする無料PWAです。

## Screenshots

See the live app, or drop PNGs into `docs/shots/` when publishing release notes.

| Fix text | Names | Terms |
| --- | --- | --- |
| paste → copy | household ready | MIT + privacy |

## Privacy (truthful)

- Form data stays in the browser (`localStorage` only when you save a profile). **Never** stores a 在留カード number.
- Visit counting: [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) (cookie-free). No marketing trackers.
- Optional 〒 lookup sends **only the postcode** to [zipcloud](https://zipcloud.ibsnet.co.jp/) (Japan Post data).
- `/api/geo` (if deployed) returns country only for legacy tooling — not required for the free app.

## Self-host

Any static host works. Cloudflare Pages is what we use:

```bash
# App files live under lab/
npx wrangler pages deploy lab --project-name=YOUR_PROJECT
# Optional: include lab/functions for /api/geo
```

Or copy `lab/index.html`, `terms.html`, `sw.js`, `manifest.webmanifest`, icons, `_headers`, `robots.txt`, `sitemap.xml`, `og.png` to any static origin. HTTPS required for the service worker.

Env for our deploy scripts (optional):

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `MOJIFILL_LAB_PROJECT` (default `mojifill-lab`)
- `MOJIFILL_PROD_PROJECT` (default `mojifill`)

**Never commit tokens or account IDs.**

## Develop / test

```bash
node lab/tests/smoke-check.mjs
node lab/tests/fixer-tests.mjs
node lab/tests/headless-smoke.mjs   # needs Chrome + ws
```

## Sponsors

Plain links only (`rel="sponsored noopener"`), configured in `SPONSORS` inside `lab/index.html`. Ship with the GitHub source link; fill partner URLs when you have them (e.g. Sakura Mobile, Mobal, Wise, Amazon JP). No scripts or pixels.

Optional funding (`githubSponsors` / `koFi`) stays disabled until you turn it on in that config.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues: this repo. Built by a Christian missionary in Japan（日本在住のキリスト教宣教師）.

## Licence

[MIT](LICENSE) © 2026 David McClatchey / McKlatch
