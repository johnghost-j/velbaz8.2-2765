// ─── Clone reference store ───────────────────────────────────────────────────
// Persiste le résultat de scraping (SiteCloneResult) d'un site à cloner, par
// entreprise, pour que le MOTEUR DE BUILD (runBuildWebsiteWork → generateApp)
// puisse recréer le site À L'IDENTIQUE à partir du JSON + des images récupérées.
// Sans ça, le site scrapé ne servait qu'à la réponse du chat et le build lançait
// le flux générique (recherche marché + logo/marque) au lieu de cloner.
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { SiteCloneResult } from './site-scraper';

const PROJECT_ROOT = process.cwd().includes('packages/web')
  ? join(process.cwd(), '..', '..')
  : process.cwd();
const CLONE_DIR = join(PROJECT_ROOT, 'packages', 'web', 'data', 'clone-ref');

function clonePath(companyId: string): string {
  return join(CLONE_DIR, `${companyId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
}

export function saveCloneReference(companyId: string, clone: SiteCloneResult) {
  if (!companyId || !clone?.ok) return;
  try {
    if (!existsSync(CLONE_DIR)) mkdirSync(CLONE_DIR, { recursive: true });
    writeFileSync(clonePath(companyId), JSON.stringify(clone), 'utf-8');
    console.log(`[clone-store] Référence de clonage sauvée pour ${companyId} (${clone.pages?.length || 0} page(s), ${clone.allAssets?.length || 0} asset(s), ${clone.screenshots?.length || 0} capture(s))`);
  } catch (e) {
    console.error('[clone-store] save failed:', e);
  }
}

export function loadCloneReference(companyId: string): SiteCloneResult | null {
  try {
    const p = clonePath(companyId);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')) as SiteCloneResult;
  } catch (e) {
    console.error('[clone-store] load failed:', e);
  }
  return null;
}

export function clearCloneReference(companyId: string) {
  try {
    const p = clonePath(companyId);
    if (existsSync(p)) unlinkSync(p);
  } catch {}
}
