#!/usr/bin/env bash
# Lab-only Cloudflare Pages deploy. Refuses if smoke-check fails.
# Never deploys prod project `mojifill` / mojifill.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/lab"
cd "$ROOT"
echo "== smoke =="
node lab/tests/smoke-check.mjs
echo "== fixer regression =="
node lab/tests/fixer-tests.mjs
echo "== headless browser smoke =="
node lab/tests/headless-smoke.mjs
echo "== stage =="
STAGE="${TMPDIR:-/tmp}/mojifill-lab-upload-smoke"
rm -rf "$STAGE"
mkdir -p "$STAGE/public"
cp "$LAB/index.html" "$LAB/terms.html" "$LAB/favicon-32.png" "$LAB/apple-touch-icon.png" "$LAB/icon-192.png" "$LAB/icon-512.png" "$LAB/icon-maskable-512.png" "$LAB/sw.js" "$LAB/manifest.webmanifest" "$LAB/_headers" "$STAGE/public/"
# 1.3.0 discovery assets (optional if present)
for f in robots.txt sitemap.xml og.png; do
  [ -f "$LAB/$f" ] && cp "$LAB/$f" "$STAGE/public/"
done
# 1.2.50-lab: real service worker at /sw.js (scope '/'), real manifest, and _headers (Cache-Control: no-cache for /sw.js).
# 1.2.49-lab: terms.html is served by Pages at /terms (pretty URL; /terms.html redirects there).
# 1.2.34-lab: Pages Functions (/api/geo). Wrangler bundles ./functions from its cwd, so deploy from $STAGE.
cp -R "$LAB/functions" "$STAGE/functions"
echo "== deploy mojifill-lab only =="
# Account-scoped API tokens (cfat_…) can't call /memberships; resolve the account id so wrangler skips it.
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID="$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 'https://api.cloudflare.com/client/v4/accounts?per_page=5' \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d).result||[];if(r.length===1)process.stdout.write(r[0].id)})' || true)"
  [ -n "$CLOUDFLARE_ACCOUNT_ID" ] && export CLOUDFLARE_ACCOUNT_ID
fi
export WRANGLER_CACHE_DIR="${WRANGLER_CACHE_DIR:-/tmp/wrangler-cache}"
mkdir -p "$WRANGLER_CACHE_DIR"
cd "$STAGE"
npx --yes wrangler@4 pages deploy public --project-name=mojifill-lab --commit-dirty=true
echo "== post-deploy: /sw.js must be JavaScript, not the HTML fallback =="
sleep 3
SW_CT="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code} %{content_type}' https://lab.mojifill.app/sw.js || true)"
echo "lab /sw.js: $SW_CT"
case "$SW_CT" in "200 "*javascript*) ;; *) echo "WARN: lab /sw.js is not 200 JavaScript";; esac
echo "DONE lab deploy. Prod mojifill untouched."
