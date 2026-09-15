import app from "./api";
import { SECURITY_HEADERS } from "./api/security";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dir}/../dist`;
const indexPath = `${distDir}/index.html`;

// Applique les en-têtes de sécurité (CSP, X-Frame-Options, HSTS…) sur toute
// réponse statique/HTML servie par ce process (le site Velbaz lui-même).
function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const server = Bun.serve({
  port,
  // Les réponses de chat sont en STREAMING et un appel IA peut prendre >10s
  // (analyse, clone de site, équipe d'agents). Bun.serve coupe par défaut toute
  // requête « idle » après 10s → le stream mourait avant la 1re réponse et le
  // chargement « Structuration de la réponse » tournait à l'infini. On pousse le
  // timeout d'inactivité au maximum autorisé par Bun (255s).
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api")) {
      return app.fetch(request);
    }

    // Sites publiés servis sur une URL propre : /s/:subdomain → API interne.
    // (Permet un lien "publish" lisible sans /api.)
    if (url.pathname === "/s" || url.pathname.startsWith("/s/")) {
      const apiUrl = new URL(request.url);
      apiUrl.pathname = "/api" + url.pathname;
      return app.fetch(new Request(apiUrl.toString(), request));
    }

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return withSecurityHeaders(new Response(file));
    }

    const index = Bun.file(indexPath);
    if (await index.exists()) {
      return withSecurityHeaders(new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }));
    }

    return withSecurityHeaders(new Response("Build output not found. Run `bun run build` first.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }));
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replaceAll("..", "");

  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}
