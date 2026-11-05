# Contributing to MojiFill

Thanks for helping foreigners get through Japanese forms.

## Ground rules

- Keep privacy wording **strictly truthful** (Cloudflare Web Analytics visit counting is disclosed; do not claim “no trackers”).
- Never store a 在留カード number. Demo data stays neutral (not religious, not personal names of maintainers).
- Keep the developer credit 「日本在住のキリスト教宣教師」 / “Christian missionary in Japan”.
- Hero line stays 「フォームで弾かれる文字、貼る前に直す」. No absolute/superlative marketing claims (景表法).
- No secrets, unlock codes, Stripe links, or account IDs in the tree.
- Sponsors: plain `<a rel="sponsored noopener">` only — no pixels.

## Workflow

1. Fork and branch from `main`.
2. Edit under `lab/` (the app + `lab/tests`).
3. Run `node lab/tests/smoke-check.mjs`, `fixer-tests.mjs`, and ideally `headless-smoke.mjs`.
4. Open a PR with what changed and how you verified it.

## Language

UI is JA-first with EN. Match existing i18n key style in `lab/index.html`.
