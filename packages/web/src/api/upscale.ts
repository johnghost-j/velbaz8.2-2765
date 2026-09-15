// ─── Upscale util (fichier print-ready) ──────────────────────────────────────
// Objectif : rendre une image de design compatible impression (print-on-demand) en
// l'agrandissant. Deux modes :
//   1) Fournisseur d'upscale IA si REPLICATE_API_TOKEN est configuré
//      (Real-ESRGAN sur Replicate) — meilleure qualité, ajoute du détail.
//   2) Fallback local avec sharp (rééchantillonnage Lanczos 3) — toujours
//      disponible, déployable, produit un grand fichier net.
import { getSharp } from './lib/optional-import';

export interface UpscaleOptions {
  factor?: 2 | 4;               // facteur d'agrandissement (défaut 4)
  replicateToken?: string;      // optionnel : upscale IA via Replicate
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

// Upscale local via sharp — fiable et déployable, pas de clé requise.
async function upscaleWithSharp(buffer: Buffer, factor: number): Promise<{ buffer: Buffer; mime: string }> {
  const sharp = await getSharp();
  const img = sharp(buffer, { limitInputPixels: false });
  const meta = await img.metadata();
  const w = meta.width || 1024;
  const h = meta.height || 1024;
  const out = await sharp(buffer, { limitInputPixels: false })
    .resize({ width: Math.round(w * factor), height: Math.round(h * factor), kernel: 'lanczos3', fit: 'fill' })
    .png({ quality: 100, compressionLevel: 6 })
    .toBuffer();
  return { buffer: out, mime: 'image/png' };
}

// Upscale IA via Replicate (Real-ESRGAN). Best-effort : en cas d'échec on
// retombe sur sharp pour ne jamais bloquer le flux produit.
async function upscaleWithReplicate(buffer: Buffer, mime: string, factor: number, token: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
    const create = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({
        // Real-ESRGAN
        version: 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
        input: { image: dataUri, scale: factor, face_enhance: false },
      }),
    });
    const pred: any = await create.json().catch(() => null);
    if (!pred) return null;
    let output = pred.output;
    let status = pred.status;
    let getUrl = pred?.urls?.get;
    // Poll si pas terminé (Prefer: wait couvre ~60s, on complète au besoin).
    let tries = 0;
    while (status && status !== 'succeeded' && status !== 'failed' && status !== 'canceled' && getUrl && tries < 40) {
      await new Promise(r => setTimeout(r, 1500));
      const p: any = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => null);
      if (!p) break;
      status = p.status; output = p.output;
      tries++;
    }
    if (status !== 'succeeded') return null;
    const imgUrl = Array.isArray(output) ? output[0] : output;
    if (typeof imgUrl !== 'string') return null;
    const res = await fetch(imgUrl);
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), mime: res.headers.get('content-type') || 'image/png' };
  } catch {
    return null;
  }
}

// Upscale une image dataURL et renvoie une nouvelle dataURL print-ready.
export async function upscaleDataUrl(dataUrl: string, opts: UpscaleOptions = {}): Promise<string> {
  const factor = opts.factor ?? 4;
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return dataUrl; // pas une dataURL valide → renvoyer tel quel
  let result: { buffer: Buffer; mime: string } | null = null;
  if (opts.replicateToken) {
    result = await upscaleWithReplicate(parsed.buffer, parsed.mime, factor, opts.replicateToken);
  }
  if (!result) {
    result = await upscaleWithSharp(parsed.buffer, factor);
  }
  return `data:${result.mime};base64,${result.buffer.toString('base64')}`;
}
