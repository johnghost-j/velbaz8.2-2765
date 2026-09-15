import { describe, it, expect } from 'bun:test';
import { sanitizeModelCode } from './code-sanitize';

describe('sanitizeModelCode — préambule de raisonnement', () => {
  it('retire le préambule exact du bug constaté sur Footer.tsx', () => {
    const raw = `Je dois vérifier: le fichier actuel contient déjà "Paiement sécurisé" dans la barre copyright (avec accent). L'instruction demande d'ajouter "Paiement securise" (sans accent) exactement une fois.

En regardant le fichier, je vois que "Paiement sécurisé" existe déjà dans la barre copyright.

Je vais ajouter "Paiement securise" dans la section "Mention légale" du bas.

import { useState } from "react";
import { Link } from "react-router-dom";

export default function Footer() {
  return <footer>ok</footer>;
}`;
    const out = sanitizeModelCode(raw);
    expect(out.startsWith('import { useState } from "react";')).toBe(true);
    expect(out).not.toContain('Je dois vérifier');
    expect(out).not.toContain('Je vais ajouter');
    expect(out).toContain('export default function Footer()');
  });

  it('garde un fichier propre intact', () => {
    const code = `import React from "react";\n\nexport const A = () => <div />;`;
    expect(sanitizeModelCode(code)).toBe(code);
  });

  it('garde une directive "use client" en première ligne', () => {
    const code = `"use client";\nimport React from "react";\nexport const A = 1;`;
    expect(sanitizeModelCode(code)).toBe(code);
  });

  it('garde un commentaire d’en-tête', () => {
    const code = `// Footer du site\nimport React from "react";\nexport const A = 1;`;
    expect(sanitizeModelCode(code)).toBe(code);
  });
});

describe('sanitizeModelCode — clôtures Markdown', () => {
  it('retire une clôture en début et fin (ancien comportement conservé)', () => {
    const out = sanitizeModelCode('```tsx\nimport a from "a";\nexport const B = 1;\n```');
    expect(out).toBe('import a from "a";\nexport const B = 1;');
  });

  it('extrait le bloc même quand du texte le précède', () => {
    const raw = `Voici le fichier corrigé :\n\n\`\`\`tsx\nimport a from "a";\nexport const B = 1;\n\`\`\`\n\nDis-moi si ça te va.`;
    const out = sanitizeModelCode(raw);
    expect(out).toBe('import a from "a";\nexport const B = 1;');
  });

  it('garde le plus gros bloc quand il y en a plusieurs', () => {
    const raw = "Avant :\n```tsx\nconst x = 1;\n```\nAprès :\n```tsx\nimport a from \"a\";\nexport const B = 2;\nexport const C = 3;\n```";
    const out = sanitizeModelCode(raw);
    expect(out).toContain('export const C = 3;');
    expect(out).not.toContain('const x = 1;');
  });

  it('gère un bloc ouvert et jamais refermé (réponse tronquée)', () => {
    const out = sanitizeModelCode('```tsx\nimport a from "a";\nexport const B = 1;');
    expect(out).toBe('import a from "a";\nexport const B = 1;');
  });
});

describe('sanitizeModelCode — queue en prose', () => {
  it('retire une phrase de conclusion après le code', () => {
    const raw = `import a from "a";\nexport const B = 1;\n\nVoilà le fichier est à jour.`;
    const out = sanitizeModelCode(raw);
    expect(out).toBe('import a from "a";\nexport const B = 1;');
  });
});

describe('sanitizeModelCode — autres langages', () => {
  it('garde du CSS', () => {
    const code = `.footer {\n  color: red;\n}`;
    expect(sanitizeModelCode(code)).toBe(code);
  });

  it('garde du JSON', () => {
    const code = `{\n  "a": 1\n}`;
    expect(sanitizeModelCode(code)).toBe(code);
  });

  it('ne vide jamais une réponse sans code reconnaissable', () => {
    const raw = 'Je ne peux pas modifier ce fichier.';
    expect(sanitizeModelCode(raw)).toBe(raw);
  });

  it('renvoie une chaîne vide pour une entrée vide', () => {
    expect(sanitizeModelCode('')).toBe('');
    expect(sanitizeModelCode('   \n  ')).toBe('');
  });
});
