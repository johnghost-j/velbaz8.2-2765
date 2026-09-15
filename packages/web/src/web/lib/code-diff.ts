// ─── Diff ligne à ligne partagé (EditTool + CodePreviewPane) ────────────────
//
// [2026-09-14] Extrait de components/EditTool.tsx pour que la carte de code du
// chat ET le grand aperçu de code (rectangle de preview) calculent EXACTEMENT
// le même diff, avec les mêmes couleurs.

export type DiffOp = { type: 'context' | 'remove' | 'add'; text: string };

/** LCS classique : renvoie la suite d'opérations context / remove / add. */
export function lineDiff(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: 'remove', text: a[i] });
    i++;
  }
  while (j < n) {
    ops.push({ type: 'add', text: b[j] });
    j++;
  }
  return ops;
}

export function countDiffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'remove') removed++;
  }
  return { added, removed };
}

// ── Couleurs d'une ligne de diff ──────────────────────────────────────────────
// [2026-09-14] Bug signalé : « dans les parties code colorées, quand le texte
// est grand ça ne montre qu'une partie en rouge, le reste est en gris ». Le
// code ne colorait QUE le signe +/- ; le texte de la ligne restait
// var(--text-secondary) (gris). Le texte de la ligne porte maintenant la même
// couleur que son signe, sur TOUTE la ligne, retours à la ligne compris.

/** Couleur du texte (et du signe) d'une ligne, par type. */
export function diffLineColor(type: DiffOp['type']): string {
  if (type === 'add') return 'var(--green-text, #4ade80)';
  if (type === 'remove') return 'var(--red-text, #ff6b6b)';
  return 'var(--text-secondary)';
}

/** Fond d'une ligne, par type. */
export function diffLineBg(type: DiffOp['type']): string {
  if (type === 'add') return 'var(--green-subtle-bg, rgba(34,197,94,0.10))';
  if (type === 'remove') return 'var(--red-subtle-bg, rgba(239,68,68,0.10))';
  return 'transparent';
}

/** Signe affiché en marge. */
export function diffLineSign(type: DiffOp['type']): string {
  if (type === 'add') return '+';
  if (type === 'remove') return '-';
  return ' ';
}
