// ─── Mobile App Scaffold (Expo / React Native) ──────────────────────────────
// Vraie app mobile : projet Expo SDK 54 + expo-router. Le même codebase donne :
//   • l'app NATIVE chargée dans Expo Go via le tunnel (QR code exp://…)
//   • la preview WEB statique (expo export -p web) affichée dans le cadre
//     iPhone du panneau preview, servie sous /api/companies/:id/mobile-preview.
// Les écrans (app/*.tsx) et composants sont générés par l'IA (engine-mobile).

import type { ScaffoldFile } from "./scaffold";

export interface MobileAppMeta {
  companyId: string;
  appName: string;
  slug: string;
  tagline?: string;
  colors: { bg: string; surface: string; primary: string; accent: string; text: string; textDim: string };
  screens: Array<{ name: string; file: string; route: string; purpose: string }>;
}

const PACKAGE_JSON = (meta: MobileAppMeta) => JSON.stringify({
  name: meta.slug,
  version: "1.0.0",
  main: "expo-router/entry",
  scripts: {
    start: "expo start",
    web: "expo start --web",
    "export:web": "expo export -p web",
    tunnel: "expo start --tunnel",
  },
  dependencies: {
    "expo": "~54.0.0",
    "expo-router": "~6.0.1",
    "expo-status-bar": "~3.0.8",
    "expo-linking": "~8.0.8",
    "expo-constants": "~18.0.9",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-native": "0.81.4",
    "react-native-web": "^0.21.0",
    "@expo/metro-runtime": "~6.1.2",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
  },
  devDependencies: {
    "@expo/ngrok": "^4.1.0",
    "@types/react": "~19.1.0",
    "typescript": "~5.9.2",
  },
  private: true,
}, null, 2);

// experiments.baseUrl fait pointer TOUS les assets de l'export web statique
// sous le chemin proxy /api/companies/:id/mobile-preview — indispensable pour
// que l'iframe du cadre iPhone charge le bundle JS correctement.
const APP_JSON = (meta: MobileAppMeta) => JSON.stringify({
  expo: {
    name: meta.appName,
    slug: meta.slug,
    version: "1.0.0",
    scheme: meta.slug,
    orientation: "portrait",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    backgroundColor: meta.colors.bg,
    splash: { backgroundColor: meta.colors.bg, resizeMode: "contain" },
    ios: { supportsTablet: false },
    android: { edgeToEdgeEnabled: true },
    web: { bundler: "metro", output: "static" },
    experiments: { baseUrl: `/api/companies/${meta.companyId}/mobile-preview` },
    plugins: ["expo-router"],
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  extends: "expo/tsconfig.base",
  compilerOptions: { strict: true, paths: { "@/*": ["./*"] } },
  include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
}, null, 2);

const THEME_TS = (meta: MobileAppMeta) => `// Thème global de l'app — généré depuis le plan IA.
export const theme = {
  bg: "${meta.colors.bg}",
  surface: "${meta.colors.surface}",
  primary: "${meta.colors.primary}",
  accent: "${meta.colors.accent}",
  text: "${meta.colors.text}",
  textDim: "${meta.colors.textDim}",
  radius: 16,
  spacing: (n: number) => n * 4,
};
export type Theme = typeof theme;
`;

// Visuels générés par l'IA (data URIs WebP). Vide au scaffold — le build
// réécrit ce fichier avec le manifeste réel une fois les visuels générés.
export const MOBILE_IMAGES_TS = (urls: Record<string, string> = {}) =>
  `// Visuels générés par l'IA. Clés stables réutilisables dans les écrans.\n` +
  `export const IMAGES: Record<string, string> = ${JSON.stringify(urls, null, 2)};\n`;

// _layout racine : Stack expo-router + status bar. Chaque écran du plan est
// déclaré explicitement pour contrôler les titres.
export const ROOT_LAYOUT = (meta: MobileAppMeta) => `import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "../lib/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
          animation: "slide_from_right",
        }}
      />
    </>
  );
}
`;

/** Fichiers de base du projet Expo (avant génération IA des écrans). */
export function buildMobileScaffold(meta: MobileAppMeta): ScaffoldFile[] {
  return [
    { path: "package.json", content: PACKAGE_JSON(meta) },
    { path: "app.json", content: APP_JSON(meta) },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "lib/theme.ts", content: THEME_TS(meta) },
    { path: "lib/images.ts", content: MOBILE_IMAGES_TS() },
    { path: "app/_layout.tsx", content: ROOT_LAYOUT(meta) },
  ];
}
