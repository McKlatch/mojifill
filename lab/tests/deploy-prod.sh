#!/usr/bin/env bash
# 1.2.35-lab (updated 1.2.36): PREPARED, NOT RUN. Promote lab → production (Pages project `mojifill`, https://mojifill.app).
#
#   bash lab/tests/deploy-prod.sh            # default --dry-run: tests + build + diff vs live prod. Never deploys.
#   MOJIFILL_PROD_OK=david-yes-YYYY-MM-DD bash lab/tests/deploy-prod.sh --deploy
#
# Deploy refuses unless: David's explicit yes is recorded in MOJIFILL_PROD_OK, the artifact is free
# (no Stripe links / unlock codes), and all three test suites pass. Stages functions/ so /api/geo works on prod.
# After prod is live, deactivate the old Stripe payment link (see PROMOTE-v39-CHECKLIST.md).
set -euo pipefail
MODE="${1:---dry-run}"
case "$MODE" in --dry-run|--deploy) ;; *) echo "usage: $0 [--dry-run|--deploy]"; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/lab"
NEW_CACHE="${NEW_CACHE:-mojifill-v38}"
OUT="${TMPDIR:-/tmp}/mojifill-prod-stage"
cd "$ROOT"

echo "== tests (lab source) =="
node lab/tests/smoke-check.mjs >/dev/null && echo "smoke ok"
node lab/tests/fixer-tests.mjs | tail -1
node lab/tests/headless-smoke.mjs | tail -1

echo "== build prod artifact ($NEW_CACHE) =="
rm -rf "$OUT"
node lab/tests/build-prod.mjs "$OUT" "$NEW_CACHE"

echo "== live prod (read-only) =="
LIVE="$OUT/live-index.html"
curl -fsS --max-time 20 https://mojifill.app/ -o "$LIVE"
# Cloudflare Web Analytics beacon is injected at the edge; it is not in the source.
sed -i -E "s#<!-- Cloudflare Pages Analytics --><script defer src=.https://static\.cloudflareinsights\.com/beacon\.min\.js[^>]*></script><!-- Cloudflare Pages Analytics -->##g" "$LIVE"
LIVE_CACHE="$(grep -o "const CACHE='[^']*'" "$LIVE" | head -1 || true)"  # v36 still has the inline (blob:) worker
echo "live: $LIVE_CACHE · repo root index.html $(cmp -s "$LIVE" "$ROOT/index.html" && echo '== live' || echo '!= live (check before promoting)')"
GEO_CT="$(curl -sS --max-time 10 -o /dev/null -w '%{content_type}' https://mojifill.app/api/geo || true)"
echo "live /api/geo content-type: $GEO_CT (text/html = no Functions on prod yet → app fails open)"

echo "== diff live → new =="
diff -u "$LIVE" "$OUT/public/index.html" > "$OUT/prod-diff.patch" || true
echo "lines: -$(grep -c '^-[^-]' "$OUT/prod-diff.patch" || true) +$(grep -c '^+[^+]' "$OUT/prod-diff.patch" || true) · full diff: $OUT/prod-diff.patch"
for k in "PRO_PRICE_YEN = 1480" "no analytics" "PRO_BLOCKED_COUNTRIES" "REMOVED_SUPPORT_EMAIL@example.invalid" "Cloudflare Web Analytics"; do
  printf '  %-40s live:%s new:%s\n' "$k" "$(grep -c -F "$k" "$LIVE" || true)" "$(grep -c -F "$k" "$OUT/public/index.html" || true)"
done

if [ "$MODE" != "--deploy" ]; then
  echo "DRY RUN ONLY — nothing deployed. Prod untouched."
  exit 0
fi

echo "== deploy guards =="
[[ "${MOJIFILL_PROD_OK:-}" =~ ^david-yes-[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "REFUSED: set MOJIFILL_PROD_OK=david-yes-YYYY-MM-DD after David says yes."; exit 1; }
# 1.3.0 free: refuse if Stripe payment links or unlock codes remain
if grep -qE 'buy\.stripe\.com|plink_' "$OUT/public/index.html"; then echo "REFUSED: Stripe payment link still in prod artifact."; exit 1; fi
if grep -qE "PRO_VALID_CODES" "$OUT/public/index.html"; then echo "REFUSED: PRO_VALID_CODES still present."; exit 1; fi
if grep -qE 'UNLOCK_CODE_PATTERN_A|UNLOCK_CODE_PATTERN_B|UNLOCK_CODE_PATTERN_C' "$OUT/public/index.html"; then echo "REFUSED: unlock code values in artifact."; exit 1; fi
[ -f "$OUT/functions/api/geo.js" ] || { echo "REFUSED: functions/api/geo.js missing"; exit 1; }

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID="$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 'https://api.cloudflare.com/client/v4/accounts?per_page=5' \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d).result||[];if(r.length===1)process.stdout.write(r[0].id)})' || true)"
  [ -n "$CLOUDFLARE_ACCOUNT_ID" ] && export CLOUDFLARE_ACCOUNT_ID
fi
export WRANGLER_CACHE_DIR="${WRANGLER_CACHE_DIR:-/tmp/wrangler-cache}"
mkdir -p "$WRANGLER_CACHE_DIR"
cd "$OUT"
npx --yes wrangler@4 pages deploy public --project-name="${MOJIFILL_PROD_PROJECT:-mojifill}" --branch=main --commit-dirty=true

echo "== post-deploy checks =="
sleep 5
# 1.2.50-lab: CACHE lives in /sw.js (a real file; it used to be an inline blob: worker that browsers refused).
curl -fsS https://mojifill.app/sw.js | grep -q "const CACHE='$NEW_CACHE'" && echo "live /sw.js CACHE $NEW_CACHE" || echo "WARN: live /sw.js cache not $NEW_CACHE yet"
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://mojifill.app/sw.js | grep -q '^200 .*javascript' && echo "/sw.js is 200 JavaScript" || echo "WARN: /sw.js not 200 JavaScript"
curl -fsS https://mojifill.app/api/geo | grep -q '"country"' && echo "/api/geo returns JSON" || echo "WARN: /api/geo not JSON"
curl -fsS https://mojifill.app/ -o "$OUT/live-after.html"; grep -q "フォームで弾かれる文字、貼る前に直す" "$OUT/live-after.html" && echo "live hero is the 1.2.36 line" || echo "WARN: live hero not updated"
LABVER="$(grep -o "const CACHE='mojifill-[0-9.]*-lab'" "$ROOT/lab/sw.js" | sed "s/.*mojifill-//;s/'//")"
echo "Next: copy $OUT/public/{index.html,sw.js,manifest.webmanifest,_headers} to the repo root, commit 'prod: promote $LABVER → $NEW_CACHE', phone QA (lab/PROMOTE-v37-CHECKLIST.md)."
