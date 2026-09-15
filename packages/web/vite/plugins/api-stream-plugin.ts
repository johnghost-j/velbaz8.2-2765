import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * [2026-09-05 bug 19.D] CAUSE RÉELLE des `/genesis` qui « s'arrêtent tout seuls ».
 *
 * En dev, l'API passe par `vite/__plugins/hono-dev-plugin.ts`, qui termine par :
 *
 *     res.end(Buffer.from(await response.arrayBuffer()));
 *
 * `await response.arrayBuffer()` attend la réponse ENTIÈRE avant d'écrire le
 * premier octet. Pour une réponse JSON c'est sans effet. Pour `/api/genesis/stream`,
 * qui est un flux SSE de plusieurs MINUTES, les conséquences sont exactement le
 * bug observé :
 *   · le navigateur ne reçoit RIEN (pas même les en-têtes) tant que le run n'est
 *     pas fini — donc aucune image, aucune phase, aucune progression ;
 *   · le heartbeat SSE de 15 s envoyé par la route ne protège plus rien, puisqu'il
 *     n'atteint jamais la socket : elle reste « muette » vue du réseau ;
 *   · le premier timeout venu (navigateur, Bun `idleTimeout`) coupe la connexion,
 *     et le run meurt sans cause lisible → « Error … (125s) », ligne `genesis_runs`
 *     bloquée en `running`, site reconstruit sur des images de stock.
 *
 * Reproduit en local : le serveur logue bien ses 5 phases pendant que le client
 * reçoit 0 octet.
 *
 * Le fichier fautif est préfixé `__` (interdit de modification), donc on ne le
 * corrige pas : ce plugin est monté AVANT lui dans `vite.config.ts` et prend
 * en charge tout `/api`. Il écrit les en-têtes immédiatement puis pousse chaque
 * morceau dès qu'il arrive. `hono-dev-plugin` ne voit donc plus passer `/api`.
 *
 * Ce n'est ni un timer, ni une reprise, ni un repli : c'est le transport remis
 * dans le bon sens. Si le moteur casse, l'erreur arrive maintenant en clair au
 * client au lieu d'être avalée avec le reste du flux.
 */
export default function apiStreamPlugin(): Plugin {
  return {
    name: "api-stream-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();

        try {
          const request = toWebRequest(req);
          const app = await loadApp(server);
          const response = await app.fetch(request);

          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
          });
          const setCookies = response.headers.getSetCookie?.();
          if (setCookies?.length) res.setHeader("set-cookie", setCookies);

          if (!response.body) {
            res.end();
            return;
          }

          // Un flux long ne doit jamais être coupé par une horloge de socket :
          // la fin d'un run est un ÉVÉNEMENT, pas un délai.
          res.socket?.setTimeout(0);
          res.socket?.setNoDelay(true);
          // Les en-têtes partent AVANT le premier octet de corps : le client sait
          // tout de suite que le flux est ouvert.
          res.flushHeaders?.();

          const reader = response.body.getReader();
          let clientGone = false;
          const onClose = () => {
            clientGone = true;
            void reader.cancel().catch(() => { /* déjà fermé */ });
          };
          res.on("close", onClose);

          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done || clientGone) break;
              if (value?.length) res.write(Buffer.from(value));
            }
          } finally {
            res.off("close", onClose);
          }
          res.end();
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          console.error("[api-stream]", err);
          if (!res.headersSent) res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    },
  };
}

async function loadApp(server: ViteDevServer) {
  const mod = await server.ssrLoadModule("/src/api/index.ts");
  return mod.default;
}

function toWebRequest(req: IncomingMessage): Request {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error duplex needed for streaming request bodies
    duplex: hasBody ? "half" : undefined,
  });
}

export type { ServerResponse };
