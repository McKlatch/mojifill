/* MojiFill /api/geo — Cloudflare Pages Function.
 * Returns only the 2-letter country Cloudflare already derived for THIS request (request.cf.country).
 * Kept for optional regional UX; MojiFill 1.3+ is fully free (no Buy button / no geo paywall).
 * No logging, no cookies, no storage, no IP echo, no caching. */
export function onRequestGet(context) {
  const cf = context.request.cf || {};
  const c = typeof cf.country === 'string' && /^[A-Z0-9]{2}$/.test(cf.country) ? cf.country : null;
  return new Response(JSON.stringify({ country: c }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff'
    }
  });
}
