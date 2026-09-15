// ─── Printify design composer ────────────────────────────────────────────────
// Rend l'IA 100% compatible avec le workflow de création de designs Printify :
// calques multiples (image + texte), positions multiples (front/back/manches…),
// positionnement x/y/scale/angle et motifs répétés (pattern).
//
// IMPORTANT (doc officielle developers.printify.com) : l'API Printify NE PERMET
// PAS de créer des calques texte — les champs font_family/input_text/… sont
// READ-ONLY. Le texte doit donc être rasterisé en PNG TRANSPARENT haute
// résolution côté serveur (sharp + SVG) puis uploadé comme calque image.
// Chaque calque devient une entrée du tableau `images` du placeholder, avec
// ses propres x/y/scale/angle → le rendu dans l'éditeur Printify est identique.

import { getSharp } from './lib/optional-import';
import * as printify from './printify';

// ─── Types de calques que l'IA peut émettre ───
export interface DesignImageLayer {
  type: 'image';
  imageId?: string;       // image déjà uploadée sur Printify
  url?: string;           // URL publique d'une image
  dataUrl?: string;       // data URL base64 (design généré par l'IA)
  fileName?: string;
  x?: number;             // 0..1 — centre du calque (0.5 = centré)
  y?: number;
  scale?: number;         // 1 = pleine largeur de la zone d'impression
  angle?: number;         // degrés
  pattern?: printify.PrintifyImagePattern; // motif répété optionnel
}
export interface DesignTextLayer {
  type: 'text';
  text: string;           // contenu (multi-lignes avec \n)
  fontFamily?: string;    // défaut 'DejaVu Sans' (police système fiable)
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;         // hex, défaut #000000
  strokeColor?: string;   // contour optionnel
  strokeWidth?: number;   // px (dans l'espace de rendu)
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number; // px
  lineHeight?: number;    // multiplicateur, défaut 1.2
  x?: number;             // 0..1 — position du centre du bloc texte
  y?: number;
  scale?: number;         // proportion de la largeur de la zone (défaut 0.8)
  angle?: number;
}
export type DesignLayer = DesignImageLayer | DesignTextLayer;

export interface DesignPrintArea {
  position: string;       // 'front' | 'back' | 'neck' | 'sleeve_left' | ... (selon blueprint)
  layers: DesignLayer[];
}

// ─── Rendu texte → PNG transparent haute résolution ───
// On rend à très haute résolution (base 3000px de large) pour rester net à
// l'impression, sur fond transparent. Le PNG est ensuite uploadé sur Printify.
const TEXT_RENDER_WIDTH = 3000;
const BASE_FONT_SIZE = 300; // px — grand par défaut, le scale Printify ajuste la taille finale

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function renderTextLayerPng(layer: DesignTextLayer): Promise<Buffer> {
  const lines = String(layer.text || '').split('\n').map((l) => l.trimEnd());
  if (!lines.length || !lines.some((l) => l.trim())) throw new Error('Calque texte vide');
  const fontFamily = layer.fontFamily || 'DejaVu Sans';
  const fontWeight = layer.fontWeight || 'bold';
  const fontStyle = layer.fontStyle || 'normal';
  const color = layer.color || '#000000';
  const lineHeight = (layer.lineHeight ?? 1.2) * BASE_FONT_SIZE;
  const align = layer.align || 'center';
  const letterSpacing = layer.letterSpacing ?? 0;

  const padding = BASE_FONT_SIZE * 0.4; // marge pour ascendantes/descendantes et contour
  const height = Math.ceil(lines.length * lineHeight + padding * 2);
  const width = TEXT_RENDER_WIDTH;
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const xPos = align === 'left' ? padding : align === 'right' ? width - padding : width / 2;

  const stroke = layer.strokeColor
    ? ` stroke="${escapeXml(layer.strokeColor)}" stroke-width="${Math.max(0, layer.strokeWidth ?? 8)}" paint-order="stroke fill"`
    : '';

  const textEls = lines.map((line, i) => {
    const y = padding + (i + 0.8) * lineHeight; // 0.8 ≈ baseline
    return `<text x="${xPos}" y="${y}" text-anchor="${anchor}" font-family="${escapeXml(fontFamily)}, DejaVu Sans, sans-serif" font-size="${BASE_FONT_SIZE}" font-weight="${fontWeight}" font-style="${fontStyle}" letter-spacing="${letterSpacing}" fill="${escapeXml(color)}"${stroke}>${escapeXml(line)}</text>`;
  }).join('\n  ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n  ${textEls}\n</svg>`;
  // Rendu sur fond transparent, puis trim pour un calque ajusté au texte.
  const sharp = await getSharp();
  const rendered = await sharp(Buffer.from(svg)).png().toBuffer();
  return sharp(rendered).trim().png().toBuffer();
}

// ─── Résolution des calques → images Printify uploadées ───
// Chaque calque (image ou texte rasterisé) est uploadé si nécessaire, puis
// converti en PrintifyPlaceholderImage avec son placement exact.
export async function resolveLayerToPrintifyImage(
  cfg: printify.PrintifyConfig,
  layer: DesignLayer,
  index: number,
): Promise<printify.PrintifyPlaceholderImage> {
  const x = clamp01(numOr(layer.x, 0.5));
  const y = clamp01(numOr(layer.y, 0.5));
  const angle = Math.round(numOr(layer.angle, 0));

  if (layer.type === 'text') {
    const png = await renderTextLayerPng(layer);
    const fileName = `text-layer-${Date.now()}-${index}.png`;
    const up = await printify.uploadImageByBase64(cfg, fileName, png.toString('base64'));
    if (!up.ok) throw new Error(`Upload calque texte échoué: ${up.message || up.status}`);
    const id = String((up.data as any)?.id || '');
    if (!id) throw new Error('Upload calque texte: id manquant');
    return { id, x, y, scale: numOr(layer.scale, 0.8), angle };
  }

  // Calque image
  const scale = numOr(layer.scale, 1);
  let id = layer.imageId ? String(layer.imageId) : '';
  if (!id) {
    const fileName = String(layer.fileName || `design-layer-${Date.now()}-${index}.png`);
    let up: printify.PrintifyResult | null = null;
    if (layer.url) {
      up = await printify.uploadImageByUrl(cfg, fileName, String(layer.url));
    } else if (layer.dataUrl) {
      let contents = String(layer.dataUrl);
      if (contents.startsWith('data:')) contents = contents.split(',')[1] || contents;
      up = await printify.uploadImageByBase64(cfg, fileName, contents);
    }
    if (!up) throw new Error(`Calque image ${index}: fournir imageId, url ou dataUrl`);
    if (!up.ok) throw new Error(`Upload calque image échoué: ${up.message || up.status}`);
    id = String((up.data as any)?.id || '');
    if (!id) throw new Error('Upload calque image: id manquant');
  }
  const img: printify.PrintifyPlaceholderImage = { id, x, y, scale, angle };
  if (layer.pattern && typeof layer.pattern === 'object') {
    img.pattern = {
      spacing_x: numOr((layer.pattern as any).spacing_x, 1),
      spacing_y: numOr((layer.pattern as any).spacing_y, 1),
      angle: Math.max(-45, Math.min(45, numOr((layer.pattern as any).angle, 0))),
      offset: Math.max(-1, Math.min(1, numOr((layer.pattern as any).offset, 0))),
    };
  }
  return img;
}

// Construit les print_areas Printify complètes à partir des zones de design.
export async function buildPrintAreas(
  cfg: printify.PrintifyConfig,
  areas: DesignPrintArea[],
  variantIds: number[],
): Promise<printify.PrintifyPrintArea[]> {
  const placeholders: printify.PrintifyPlaceholder[] = [];
  let i = 0;
  for (const area of areas) {
    const position = String(area.position || 'front');
    const layers = Array.isArray(area.layers) ? area.layers : [];
    if (!layers.length) continue;
    const images: printify.PrintifyPlaceholderImage[] = [];
    for (const layer of layers) {
      images.push(await resolveLayerToPrintifyImage(cfg, layer, i++));
    }
    placeholders.push({ position, images });
  }
  if (!placeholders.length) throw new Error('Aucun calque de design valide');
  return [{ variant_ids: variantIds, placeholders }];
}

// Positions disponibles pour un blueprint/provider (validation avant création).
export async function getAvailablePositions(
  cfg: printify.PrintifyConfig,
  blueprintId: number,
  providerId: number,
): Promise<string[]> {
  const vr = await printify.getBlueprintVariants(cfg, blueprintId, providerId);
  const variants: any[] = (vr.data as any)?.variants || [];
  const set = new Set<string>();
  for (const v of variants) {
    for (const p of v?.placeholders || []) if (p?.position) set.add(String(p.position));
  }
  return [...set];
}

function numOr(v: any, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
