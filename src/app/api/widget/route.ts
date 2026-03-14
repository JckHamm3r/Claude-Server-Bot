import { NextRequest, NextResponse } from "next/server";

const slug = process.env.CLAUDE_BOT_SLUG ?? "";
const prefix = process.env.CLAUDE_BOT_PATH_PREFIX ?? "c";
const basePath = slug ? `/${prefix}/${slug}` : "";

export async function GET(req: NextRequest) {
  const port = process.env.PORT ?? "3000";
  const useHttps = !!(process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH);
  const scheme = useHttps ? "https" : "http";

  const script = `
(function() {
  if (window.__claudeWidget) return;
  window.__claudeWidget = true;

  var ORIGIN = "${scheme}://"+location.hostname+":${port}";
  var BASE   = "${basePath}";
  var AUTH_URL = ORIGIN + BASE + "/api/widget/auth";
  var APP_URL  = ORIGIN + BASE + "/";

  fetch(AUTH_URL, { credentials: "include" })
    .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function(data) { render(data.name || "Claude"); })
    .catch(function() { /* not authenticated — widget stays hidden */ });

  function render(botName) {
    var btn = document.createElement("button");
    btn.id = "claude-widget-bubble";
    btn.title = "Chat with " + botName;
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    Object.assign(btn.style, {
      position:"fixed", bottom:"24px", right:"24px", zIndex:"2147483647",
      width:"56px", height:"56px", borderRadius:"50%",
      background:"#6366f1", color:"#fff", border:"none", cursor:"pointer",
      boxShadow:"0 4px 12px rgba(0,0,0,0.3)", display:"flex",
      alignItems:"center", justifyContent:"center", transition:"transform 0.15s",
      fontFamily:"system-ui, sans-serif",
    });
    btn.onmouseenter = function() { btn.style.transform = "scale(1.1)"; };
    btn.onmouseleave = function() { btn.style.transform = "scale(1)"; };
    btn.onclick = togglePanel;
    document.body.appendChild(btn);

    var panel = document.createElement("div");
    panel.id = "claude-widget-panel";
    Object.assign(panel.style, {
      position:"fixed", bottom:"88px", right:"24px", zIndex:"2147483646",
      width:"420px", height:"600px", maxHeight:"80vh", maxWidth:"calc(100vw - 48px)",
      borderRadius:"12px", overflow:"hidden",
      boxShadow:"0 8px 32px rgba(0,0,0,0.4)", display:"none",
      border:"1px solid rgba(255,255,255,0.1)",
    });

    var iframe = document.createElement("iframe");
    iframe.src = APP_URL;
    iframe.style.cssText = "width:100%;height:100%;border:none;background:#1a1a2e;";
    iframe.allow = "clipboard-write";
    panel.appendChild(iframe);
    document.body.appendChild(panel);

    var open = false;
    function togglePanel() {
      open = !open;
      panel.style.display = open ? "block" : "none";
      btn.innerHTML = open
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    }
  }
})();
`;

  const origin = req.headers.get("origin") ?? "*";
  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": origin,
    },
  });
}
