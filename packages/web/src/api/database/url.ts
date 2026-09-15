// Normalise DATABASE_URL en transport HTTP stateless AVANT que le client
// template (__client.ts) ne lise process.env.
//
// Le schéma `libsql://` garde un socket WebSocket/Hrana ouvert que Turso peut
// fermer sans prévenir ("The socket connection was closed unexpectedly"), ce
// qui gelait toutes les requêtes (sessions, users, companies) et blanchissait
// l'app. En `https://`, chaque requête est indépendante — rien à perdre — sans
// changer le comportement ni les résultats des requêtes.
export function toHttpUrl(raw: string): string {
  if (!raw) return raw;
  return raw
    .replace(/^libsql:\/\//i, "https://")
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://");
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = toHttpUrl(process.env.DATABASE_URL);
}
