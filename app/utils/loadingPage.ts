/**
 * A standalone "loading…" page for a window CONNECT opens and then points
 * somewhere else — written into the fresh window straight away so it is never a
 * blank white `about:blank` while the real destination loads. Chrome keeps
 * showing it until the next page arrives.
 *
 * Used by the PDF viewer tab (useDocumentDownload) and the Cloudflare Access
 * renew popup (useCloudflareAccess).
 *
 * A separate document, so it can't use <BaseSpinner> or the design tokens; this
 * mirrors BaseSpinner's planetary 3-dot animation with the same colors (primary
 * #009bd4, muted #9ca3a7). `public/access-renew.html` carries its own copy
 * because it has to be a static file.
 *
 * @param label shown as the window title and under the spinner, e.g.
 *        "Loading document…". Escaped, though every caller passes a constant.
 */
export function buildLoadingPageHtml(label: string): string {
  const text = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${text}</title><style>
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;gap:20px;align-items:center;justify-content:center;font-family:"TT Norms Pro",system-ui,-apple-system,sans-serif;background:#f8fafc}
.loading-label{font-size:14px;font-weight:300;color:#9ca3a7}
.base-spinner{position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;perspective:800px}
.base-spinner__orbit,.base-spinner__scene{position:absolute;width:100%;height:100%;transform-style:preserve-3d}
.base-spinner__orbit{animation:spinner-planetary 3s linear infinite}
.base-spinner__dot{position:absolute;width:22%;height:22%;margin:-11%;border-radius:50%;background:#9ca3a7;top:50%;left:50%}
.base-spinner__dot:nth-child(1){animation:spinner-chaos-x 1.5s cubic-bezier(0.7,0,0.3,1) infinite}
.base-spinner__dot:nth-child(2){animation:spinner-chaos-y 1.5s cubic-bezier(0.7,0,0.3,1) infinite}
.base-spinner__dot:nth-child(3){animation:spinner-chaos-z 1.5s cubic-bezier(0.7,0,0.3,1) infinite}
@keyframes spinner-planetary{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
@keyframes spinner-chaos-x{0%,100%{transform:translate3d(-200%,0,-50px) scale(0.7)}50%{transform:translate3d(200%,0,50px) scale(1.4);background:#009bd4}}
@keyframes spinner-chaos-y{0%,100%{transform:translate3d(0,-200%,-50px) scale(0.7)}50%{transform:translate3d(0,200%,50px) scale(1.4);background:#009bd4}}
@keyframes spinner-chaos-z{0%,100%{transform:translate3d(150%,150%,-100px) scale(0.7)}50%{transform:translate3d(-150%,-150%,100px) scale(1.4);background:#009bd4}}
</style></head><body><div class="base-spinner"><div class="base-spinner__orbit"><div class="base-spinner__scene"><div class="base-spinner__dot"></div><div class="base-spinner__dot"></div><div class="base-spinner__dot"></div></div></div></div><div class="loading-label">${text}</div></body></html>`
}
