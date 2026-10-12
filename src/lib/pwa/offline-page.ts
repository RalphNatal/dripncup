/**
 * The offline page: what the service worker shows for a page that can't be
 * loaded and isn't kept (src/lib/pwa/cache-rules.ts), served by
 * src/app/offline/route.ts and precached at install.
 *
 * One self-contained HTML document: inline styles, no scripts and no web
 * fonts (it has to work with nothing else cached). The logo is the 192 px
 * app icon, precached with it. "Try again" is a link to the current
 * address, so it reloads the page the customer wanted.
 */
import { BRAND, BRAND_COLORS } from "@/lib/brand";

export const OFFLINE_TITLE = "You're offline";

/** The page's own policy: no scripts at all, inline styles, our images. */
export const OFFLINE_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function offlinePageHtml(): string {
  const c = BRAND_COLORS;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${c.teal}">
<meta name="robots" content="noindex">
<title>${OFFLINE_TITLE} · ${BRAND.name}</title>
<style>
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;
    font-family:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,-apple-system,sans-serif;color:${c.ink};
    background:linear-gradient(160deg,${c.tealSoft} 0%,${c.sand} 55%,${c.pinkSoft} 100%)}
  main{width:100%;max-width:26rem;text-align:center;background:#fff;border-radius:2rem;padding:2.5rem 1.5rem;
    box-shadow:0 1px 3px rgba(16,17,20,.08)}
  img{width:88px;height:88px;border-radius:22px}
  .word{margin:.75rem 0 0;font-weight:800;font-size:1.25rem;color:${c.tealDeep};text-transform:lowercase}
  svg{display:block;margin:.25rem auto 0;width:96px;height:20px;color:${c.magenta}}
  h1{margin:1.25rem 0 .5rem;font-size:1.75rem;line-height:1.15}
  p{margin:.5rem 0;font-size:1rem;line-height:1.5;color:#5d5a56}
  strong{color:${c.ink}}
  a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;margin-top:1.5rem;padding:0 1.5rem;
    border-radius:999px;background:${c.tealDeep};color:#fff;font-weight:700;font-size:1rem;text-decoration:none}
  a:focus-visible{outline:3px solid ${c.magentaDeep};outline-offset:3px}
  @media (prefers-reduced-motion:no-preference){a{transition:background-color .15s}}
  a:hover{background:#0a5b63}
</style>
</head>
<body>
<main>
  <img src="/icons/icon-192.png" alt="" width="88" height="88">
  <p class="word">${BRAND.wordmark}</p>
  <svg viewBox="0 0 120 40" fill="none" aria-hidden="true" focusable="false"><path d="M4 28c10-14 22-18 30-10s-2 20 6 20 14-14 22-20 18-6 24 2" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <h1>${OFFLINE_TITLE}</h1>
  <p><strong>Your cart is saved on this device.</strong></p>
  <p>Reconnect to place your order.</p>
  <a href="">Try again</a>
</main>
</body>
</html>
`;
}
