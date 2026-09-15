/**
 * x-live-ws-plugin — pont WebSocket pour le navigateur X embarqué.
 *
 * Pourquoi : en dev, le plugin Hono met en tampon les réponses en flux (SSE et
 * MJPEG ressortent vides), donc chaque image devait passer par une requête HTTP
 * séparée → énorme latence. Ici on branche un vrai WebSocket sur le serveur de
 * dev Vite : une seule connexion, images JPEG poussées en binaire dès que
 * Chrome repeint, et les clics/molette/clavier remontent par le même tuyau.
 *
 * Le routeur `src/api/social/x-live.ts` publie `globalThis.__xLiveAttach` et
 * `globalThis.__xLiveInput` (même process, autre graphe de modules).
 * Purement additif : les routes HTTP existantes restent en place.
 */

import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';

const WS_PATH = '/x-live-ws';

export default function xLiveWsPlugin(): Plugin {
  return {
    name: 'x-live-ws',
    apply: 'serve',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname !== WS_PATH) return; // laisse le HMR de Vite tranquille

        wss.handleUpgrade(req, socket as any, head, (ws) => {
          const sessionId = url.searchParams.get('s') || '';
          const g = globalThis as any;
          const attach = g.__xLiveAttach as
            | ((id: string, send: (jpeg: Buffer) => void) => (() => void) | null)
            | undefined;

          if (!attach) {
            try { ws.close(1011, 'x-live indisponible'); } catch {}
            return;
          }

          const detach = attach(sessionId, (jpeg) => {
            // On n'empile pas : si le client est en retard, on saute l'image.
            if (ws.bufferedAmount > 2_000_000) return;
            try { ws.send(jpeg, { binary: true }); } catch {}
          });

          if (!detach) {
            try { ws.close(1008, 'Session inconnue'); } catch {}
            return;
          }

          ws.on('message', (raw) => {
            let body: any;
            try { body = JSON.parse(String(raw)); } catch { return; }
            const input = g.__xLiveInput as ((id: string, b: any) => Promise<void>) | undefined;
            input?.(sessionId, body).catch(() => {});
          });

          ws.on('close', () => { try { detach(); } catch {} });
          ws.on('error', () => { try { detach(); } catch {} });
        });
      });
    },
  };
}
