// [2026-09-10] Les variables d'environnement vivent dans le .env à la racine du
// monorepo, que `vitest` ne charge pas dans process.env (contrairement à
// `bun --env-file`). Résultat : tout fichier de test important, même
// indirectement, src/api/database plantait au chargement avec
// « URL_INVALID: The URL 'undefined' is not in a valid format » et faisait
// échouer `bun run test` alors que les tests eux-mêmes passaient.
// On charge donc le .env ici, sans écraser une variable déjà définie.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const rel of ['../../.env', '.env']) {
  const file = resolve(__dirname, rel);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
