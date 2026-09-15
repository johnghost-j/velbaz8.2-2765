// ─── Ouverture du grand aperçu de code depuis n'importe quelle carte de code ──
//
// [2026-09-14] Demande utilisateur : « je veux pouvoir cliquer sur le code et,
// comme pour les textes, que ça montre le code coloré dans un rectangle ».
// Les cartes de code (EditTool) sont rendues très profond dans l'arbre du chat
// (groupes de tâches, étapes…). Plutôt que de faire descendre un callback à
// travers tous ces composants, le chat fournit l'ouvreur via ce contexte et
// EditTool le consomme.

import { createContext, useContext } from 'react';

export type CodePreviewTarget = {
  /** Chemin du fichier (sert de titre + de source pour « Fichier complet »). */
  filePath?: string;
  /** Ancien contenu (variante "edit"). */
  oldContent?: string;
  /** Nouveau contenu. */
  newContent?: string;
  /** "write" = fichier créé (tout en vert), "edit" = diff. */
  variant?: 'edit' | 'write';
};

export type CodePreviewOpener = (target: CodePreviewTarget) => void;

export const CodePreviewContext = createContext<CodePreviewOpener | null>(null);

/** Renvoie l'ouvreur, ou null quand l'aperçu n'est pas disponible. */
export function useCodePreviewOpener(): CodePreviewOpener | null {
  return useContext(CodePreviewContext);
}
