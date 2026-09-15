import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";
import runableAnalyticsPlugin from "./vite/__plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/__plugins/hono-dev-plugin";
import assetOptimizerPlugin from "./vite/__plugins/asset-optimizer-plugin";
import xLiveWsPlugin from "./vite/plugins/x-live-ws-plugin";
import apiStreamPlugin from "./vite/plugins/api-stream-plugin";
import ports from "../../__ports.cjs";

const root = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  Object.assign(process.env, env);

  return {
    // All env files live at the repo root — keep Vite's own env loading there too,
    // so packages/web/.env* files can never shadow the root .env.
    envDir: root,
    plugins: [
      // [2026-09-05 bug 19.D] AVANT honoDevPlugin : celui-ci met en tampon la
      // réponse entière (`await response.arrayBuffer()`), ce qui tuait tout flux
      // SSE long — dont /api/genesis/stream. Le nôtre prend /api en streaming.
      apiStreamPlugin(),
      honoDevPlugin(),
      react(),
      runableAnalyticsPlugin(),
      tailwind(),
      assetOptimizerPlugin(),
      xLiveWsPlugin(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src/web"),
      },
    },
    server: {
      port: ports.website,
      strictPort: true,
      allowedHosts: true,
      hmr: { overlay: false },
      // Le serveur écrit des fichiers de runtime (logs d'usage IA, aperçus de marque,
      // sites générés, réglages…) pendant que l'IA travaille. Sans cette liste,
      // le watcher de Vite les voit changer et renvoie un "full-reload" au navigateur :
      // la page se rafraîchissait toute seule en plein milieu d'une génération.
      watch: {
        ignored: [
          '**/data/**',
          '**/.genesis-history.json',
          '**/genesis-history.json',
          '**/.velbaz-settings/**',
          '**/.velbaz-apps/**',
          '**/generated/**',
          '**/*.jsonl',
          '**/*.log',
          '**/*.sqlite',
          '**/*.db',
          '**/public/uploads/**',
          '**/public/generated/**',
          // Assets écrits par l'IA pendant un run (labo test1, build de sites)
          // et sorties de build : rien de tout ça n'a besoin d'être surveillé.
          '**/skill_test1/**',
          '**/dist/**',
        ],
      },
      cors: false,
    },
  };
});
