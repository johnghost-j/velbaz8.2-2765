// ─── Persistance sur disque des cadres et plaques produits par /genesis (chimera)
// Le générateur d'images renvoie des data URI en mémoire (`data:image/webp;base64,…`).
// Tant qu'elles restent en mémoire, la spec de construction ne peut citer AUCUNE
// image : le site est bâti à partir de texte seul et les cadres ne servent que de
// décoration dans le panneau du chat. Ce module écrit chaque asset sur le disque
// hors du dépôt hôte et renvoie une URL HTTP servie par `/api/chimera/assets/…`,
// pour que la spec — puis le site construit — pointe sur de vrais fichiers.
//
// Rien n'est supprimé nulle part : les data URI continuent d'être émises vers le
// client comme avant, la persistance est un ajout.
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const CHIMERA_ASSETS_ROOT =
  process.env.CHIMERA_ASSETS_DIR || path.join(os.homedir(), ".velbaz-apps", "chimera-frames");

/** Route publique de lecture (déclarée dans src/api/index.ts). */
export const CHIMERA_ASSETS_BASE_URL = "/api/chimera/assets";

/**
 * Origine ABSOLUE des assets. Le site construit tourne sur SON propre serveur
 * de prévisualisation (autre port) : une URL relative « /api/chimera/assets/… »
 * y pointe vers le serveur du site et renvoie 404 — les images ne s'affichaient
 * donc jamais dans le site final. On préfixe par l'origine réelle de Velbaz.
 * Rien n'est supprimé : la route et la constante relative restent inchangées.
 */
export const CHIMERA_ASSETS_ORIGIN = (
  process.env.APP_BASE_URL
  || process.env.PUBLIC_BASE_URL
  || `http://localhost:${process.env.PORT || 4200}`
).replace(/\/$/, "");

/** URL absolue et chargeable d'un asset persisté. */
export function chimeraAssetUrl(runId: string, name: string): string {
  return `${CHIMERA_ASSETS_ORIGIN}${CHIMERA_ASSETS_BASE_URL}/${safeSegment(runId)}/${name}`;
}

/**
 * [2026-09-05] URL RELATIVE du même asset, pour l'affichage dans le chat.
 * Le chat est servi par CE serveur, souvent derrière un proxy de
 * prévisualisation : une URL absolue « http://localhost:4200/… » n'est pas
 * chargeable depuis le navigateur de l'utilisateur, alors qu'une URL relative
 * l'est toujours. Le site construit, lui, tourne sur un autre port et garde
 * l'URL absolue (`url`).
 */
export function chimeraAssetRelUrl(runId: string, name: string): string {
  return `${CHIMERA_ASSETS_BASE_URL}/${safeSegment(runId)}/${name}`;
}

const SAFE = /[^a-zA-Z0-9._-]/g;

export function safeSegment(s: string): string {
  return String(s || "").replace(SAFE, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "x";
}

export function chimeraRunDir(runId: string): string {
  return path.join(CHIMERA_ASSETS_ROOT, safeSegment(runId));
}

const EXT_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/avif": "avif",
};

const MIME_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
};

export interface PersistedChimeraAsset {
  /** nom de fichier sur disque, ex: "01-hero-ui.webp" */
  name: string;
  /** chemin absolu sur le disque */
  file: string;
  /** URL ABSOLUE servie par ce serveur (utilisée dans la spec et le site construit) */
  url: string;
  /** Même asset en URL RELATIVE, pour l'affichage dans le chat (proxy compris) */
  relUrl: string;
  bytes: number;
}

/** Décode une data URI. Renvoie null si ce n'en est pas une. */
export function decodeDataUri(dataUri: string): { buffer: Buffer; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUri || "").trim());
  if (!m) return null;
  try {
    return { buffer: Buffer.from(m[2], "base64"), mime: m[1].toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Écrit un asset sur disque. `baseName` est donné SANS extension (elle est
 * déduite du mime). Ne lève jamais : renvoie null en cas d'échec pour qu'un
 * asset non persisté ne casse pas un run.
 */
export async function persistChimeraAsset(
  runId: string,
  baseName: string,
  dataUriOrUrl: string,
): Promise<PersistedChimeraAsset | null> {
  try {
    const decoded = decodeDataUri(dataUriOrUrl);
    if (!decoded) return null; // URL distante : rien à écrire
    const ext = EXT_BY_MIME[decoded.mime] || "png";
    const dir = chimeraRunDir(runId);
    await mkdir(dir, { recursive: true });
    const name = `${safeSegment(baseName)}.${ext}`;
    const file = path.join(dir, name);
    await writeFile(file, decoded.buffer);
    return {
      name,
      file,
      // URL ABSOLUE : c'est cette valeur qui finit recopiée dans la spec puis
      // dans le code du site. Le site construit tourne sur SON serveur de
      // prévisualisation (autre port) : une URL relative « /api/chimera/... »
      // y renvoyait 404 et aucune image générée n'apparaissait dans le site.
      url: chimeraAssetUrl(runId, name),
      relUrl: chimeraAssetRelUrl(runId, name),
      bytes: decoded.buffer.byteLength,
    };
  } catch (e) {
    console.warn(`[chimera] persistance de l'asset ${baseName} échouée :`, (e as Error)?.message);
    return null;
  }
}

/** Lecture d'un asset persisté, pour la route HTTP. */
export async function readChimeraAsset(
  runId: string,
  fileName: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const name = safeSegment(fileName);
    const file = path.join(chimeraRunDir(runId), name);
    const info = await stat(file);
    if (!info.isFile()) return null;
    const body = await readFile(file);
    const ext = name.split(".").pop()!.toLowerCase();
    return { body, contentType: MIME_BY_EXT[ext] || "application/octet-stream" };
  } catch {
    return null;
  }
}

/** Inventaire des assets d'un run (livraison, debug). */
export async function listChimeraAssets(runId: string): Promise<PersistedChimeraAsset[]> {
  try {
    const dir = chimeraRunDir(runId);
    const names = await readdir(dir);
    const out: PersistedChimeraAsset[] = [];
    for (const name of names.sort()) {
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      out.push({
        name,
        file,
        url: chimeraAssetUrl(runId, name),
        // `relUrl` manquait : les assets relus depuis le disque arrivaient avec
        // relUrl undefined et l'aperçu dans le chat (qui passe par le proxy)
        // affichait une image cassée.
        relUrl: chimeraAssetRelUrl(runId, name),
        bytes: info.size,
      });
    }
    return out;
  } catch {
    return [];
  }
}
