import { defineConfig } from 'vitest/config';

export default defineConfig({
  // [2026-09-10] Les .env vivent à la racine du monorepo : sans envDir, tout
  // test important src/api/database échouait avec « URL 'undefined' is not in a
  // valid format » (DATABASE_URL absent), ce qui faisait sortir `bun run test`
  // en erreur alors que les tests eux-mêmes passaient.
  envDir: '../../',
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // Chaque test unitaire cible du code pur (pas de DB/serveur).
    testTimeout: 10_000,
  },
});
