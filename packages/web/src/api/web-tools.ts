// ─── Web Tools: link reading, YouTube analysis, web search ──────────────────
// Gives Velbaz AI real access to the web:
//  - buildLinkContext(message): fetches every URL in the user's message and
//    returns their real content (pages: readable text; YouTube: title,
//    description, transcript) so the AI answers about what's ACTUALLY there.
//  - webSearch(query): DuckDuckGo search (no API key) returning top results.
// All functions are best-effort and never throw — they return '' on failure.

const FETCH_TIMEOUT_MS = 15000;
const MAX_PAGE_CHARS = 9000;
const MAX_TRANSCRIPT_CHARS = 9000;
const MAX_URLS_PER_MESSAGE = 3;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7',
};

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?]+$/, '');
    if (!seen.has(url)) { seen.add(url); out.push(url); }
    if (out.length >= MAX_URLS_PER_MESSAGE) break;
  }
  return out;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch|shorts|embed)|youtu\.be\/)/i.test(url);
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url) || /(?:vimeo\.com|dailymotion\.com|tiktok\.com)\//i.test(url);
}

// ─── URL d'ASSET (pas un site) ───────────────────────────────────────────────
// Bug corrigé : un brief contenant une URL Google Fonts (ou un .css/.js/.woff,
// un CDN d'assets…) déclenchait le CLONAGE de cette URL. Le build repartait
// alors en « clone fidèle du site source » et recopiait la feuille de style
// comme contenu de page (site = un <pre> de CSS). Une URL d'asset n'est JAMAIS
// une cible de clonage.
export function isAssetUrl(url: string): boolean {
  if (/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.bunny\.net|use\.typekit\.net|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|api\.fontshare\.com|googleapis\.com\/(?:css|ajax))/i.test(url)) return true;
  if (/\.(css|js|mjs|json|xml|woff2?|ttf|otf|eot|map|svg|png|jpe?g|gif|webp|avif|ico|pdf|zip|csv|txt)(\?|#|$)/i.test(url)) return true;
  return false;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ''; } });
}

function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim();
}

// ─── Regular web page ─────────────────────────────────────────────────────────
export async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: timeoutSignal(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) return `(Page inaccessible — HTTP ${res.status})`;
    const ct = res.headers.get('content-type') || '';
    if (/image|audio|video|octet-stream|pdf|zip/i.test(ct)) {
      return `(Fichier de type "${ct.split(';')[0]}" — contenu binaire, pas de texte lisible)`;
    }
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';
    const desc = descMatch ? decodeEntities(descMatch[1].trim()) : '';
    // Prefer <main>/<article> body when present
    const mainMatch = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
    const body = htmlToText(mainMatch ? mainMatch[1] : html).slice(0, MAX_PAGE_CHARS);
    return [title ? `Titre: ${title}` : '', desc ? `Description: ${desc}` : '', body ? `Contenu:\n${body}` : ''].filter(Boolean).join('\n');
  } catch (e: any) {
    return `(Impossible de charger la page: ${String(e?.message || e).slice(0, 100)})`;
  }
}

// ─── YouTube: title + description + transcript ───────────────────────────────
export async function fetchYouTubeInfo(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { ...BROWSER_HEADERS, 'Cookie': 'CONSENT=YES+1' }, signal: timeoutSignal(FETCH_TIMEOUT_MS), redirect: 'follow' });
    const html = res.ok ? await res.text() : '';
    let title = '', author = '', description = '', lengthSec = '', views = '';
    let transcript = '';

    const prMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});(?:\s*var|\s*<\/script>)/);
    if (prMatch) {
      try {
        const pr = JSON.parse(prMatch[1]);
        const vd = pr?.videoDetails || {};
        title = vd.title || '';
        author = vd.author || '';
        description = (vd.shortDescription || '').slice(0, 2000);
        lengthSec = vd.lengthSeconds || '';
        views = vd.viewCount || '';
        const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (tracks.length > 0) {
          // Prefer FR, then EN, then first available
          const track = tracks.find((t: any) => (t.languageCode || '').startsWith('fr'))
            || tracks.find((t: any) => (t.languageCode || '').startsWith('en'))
            || tracks[0];
          if (track?.baseUrl) {
            const capRes = await fetch(track.baseUrl, { headers: BROWSER_HEADERS, signal: timeoutSignal(FETCH_TIMEOUT_MS) });
            if (capRes.ok) {
              const xml = await capRes.text();
              const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => decodeEntities(m[1]).trim()).filter(Boolean);
              transcript = texts.join(' ').replace(/\s+/g, ' ').slice(0, MAX_TRANSCRIPT_CHARS);
            }
          }
        }
      } catch { /* JSON parse failed — fall through to oEmbed */ }
    }

    if (!title) {
      // Fallback: oEmbed (title + author only, always works)
      try {
        const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: timeoutSignal(8000) });
        if (oe.ok) {
          const j: any = await oe.json();
          title = j.title || '';
          author = j.author_name || '';
        }
      } catch { }
    }

    if (!title && !transcript) return '(Vidéo YouTube inaccessible — impossible de récupérer les informations)';
    const mins = lengthSec ? `${Math.floor(Number(lengthSec) / 60)}min${String(Number(lengthSec) % 60).padStart(2, '0')}` : '';
    return [
      `Type: Vidéo YouTube`,
      title ? `Titre: ${title}` : '',
      author ? `Chaîne: ${author}` : '',
      mins ? `Durée: ${mins}` : '',
      views ? `Vues: ${views}` : '',
      description ? `Description: ${description}` : '',
      transcript ? `Transcription (ce qui est DIT dans la vidéo):\n${transcript}` : '(Pas de sous-titres disponibles — contenu parlé inconnu, base-toi sur le titre et la description)',
    ].filter(Boolean).join('\n');
  } catch (e: any) {
    return `(Impossible d'analyser la vidéo: ${String(e?.message || e).slice(0, 100)})`;
  }
}

// ─── Deep clone intent: when the user wants to COPY a site identically ───────
// (mode « Continuer une company » ou demande explicite de clonage) → on lance
// un vrai clonage multi-pages au navigateur au lieu d'un simple fetch texte.
const CLONE_INTENT_RE = /(analyse[- ]le à fond|récupère toutes les informations|copie[rz]?|clone[rz]?|cloner|à l'identique|reprodui[st]|recr[ée]e[rz]?|même site|identique|scrap)/i;

export function wantsDeepClone(message: string): boolean {
  return CLONE_INTENT_RE.test(message) && cloneTargets(message).length > 0;
}

/** URLs réellement clonables du message : ni vidéo, ni YouTube, ni asset. */
export function cloneTargets(message: string): string[] {
  return extractUrls(message).filter((u) => !isYouTubeUrl(u) && !isVideoUrl(u) && !isAssetUrl(u));
}

// Aperçu « caméra live » émis pendant que l'IA lit/parcourt des liens.
export interface LinkPreviewEvent {
  id: string;
  label: string;
  preview?: {
    kind: 'browse' | 'screenshot' | 'search' | 'code' | 'analyze';
    imageUrl?: string;
    url?: string;
    caption?: string;
  };
}
export interface BuildLinkContextOptions {
  onPreview?: (e: LinkPreviewEvent) => void;
  /** Appelé avec le résultat brut du scraping quand l'utilisateur veut CLONER un
   *  site. Permet au caller de persister le clone (JSON + images) pour que le
   *  MOTEUR DE BUILD recrée le site à l'identique (et pas seulement le chat). */
  onClone?: (clone: import('./site-scraper').SiteCloneResult) => void;
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

// Aperçu INSTANTANÉ de l'URL navigée (capture à la volée) → l'utilisateur voit
// tout de suite la page que l'IA ouvre, avant même la capture haute fidélité.
const livePreview = (u: string) => `https://image.thum.io/get/width/1200/noanimate/${u}`;

// ─── Link context builder (called on every chat message) ─────────────────────
export async function buildLinkContext(message: string, opts?: BuildLinkContextOptions): Promise<string> {
  const emit = opts?.onPreview ?? (() => {});
  const urls = extractUrls(message);
  if (urls.length === 0) return '';

  // Clonage profond : l'utilisateur veut copier un site à l'identique.
  // On rend un vrai navigateur sur la 1ʳᵉ URL (page + navigation + assets).
  if (wantsDeepClone(message)) {
    const target = cloneTargets(message)[0];
    if (target) {
      const { formatCloneBrief } = await import('./site-scraper');
      // ── 1) Firecrawl EN PRIORITÉ (haute fidélité : JSON riche + branding +
      //       captures pleine page + toutes les images) si la clé API existe ──
      try {
        const { firecrawlEnabled, scrapeSiteWithFirecrawl } = await import('./firecrawl');
        if (firecrawlEnabled()) {
          emit({ id: 'cam-open', label: `Ouverture de ${hostOf(target)}`, preview: { kind: 'browse', url: target, imageUrl: livePreview(target), caption: `Ouverture de ${hostOf(target)}` } });
          const clone = await scrapeSiteWithFirecrawl(target, {
            onPreview: (p) => emit(p),
          });
          const brief = formatCloneBrief(clone);
          if (brief) {
            console.log(`[web-tools] Clone Firecrawl OK — ${clone.pages.length} page(s), ${clone.allAssets.length} asset(s), ${clone.screenshots?.length || 0} capture(s)`);
            try { if (clone.ok) opts?.onClone?.(clone); } catch {}
            return brief;
          }
          console.warn(`[web-tools] Firecrawl indisponible (${clone.note}) → fallback navigateur local`);
        }
      } catch (e: any) {
        console.error('[web-tools] Firecrawl échoué → fallback navigateur local:', e?.message);
      }
      // ── 2) Fallback : navigateur local (Chrome headless) ──
      try {
        const { scrapeSiteForClone } = await import('./site-scraper');
        const clone = await scrapeSiteForClone(target);
        const brief = formatCloneBrief(clone);
        if (brief) {
          console.log(`[web-tools] Clone profond (local) OK — ${clone.pages.length} page(s), ${clone.allAssets.length} asset(s)`);
          try { if (clone.ok) opts?.onClone?.(clone); } catch {}
          return brief;
        }
        console.warn(`[web-tools] Clone profond indisponible (${clone.note}) → fallback fetch`);
      } catch (e: any) {
        console.error('[web-tools] clone profond échoué → fallback:', e?.message);
      }
    }
  }

  const parts = await Promise.all(urls.map(async (url) => {
    let content: string;
    if (isYouTubeUrl(url)) {
      emit({ id: `cam-yt-${hostOf(url)}`, label: `Lecture de la vidéo (${hostOf(url)})`, preview: { kind: 'browse', url, caption: `Vidéo — ${hostOf(url)}` } });
      content = await fetchYouTubeInfo(url);
    } else if (isVideoUrl(url)) {
      emit({ id: `cam-vid-${hostOf(url)}`, label: `Lecture de la vidéo (${hostOf(url)})`, preview: { kind: 'browse', url, caption: `Vidéo — ${hostOf(url)}` } });
      content = `Type: Vidéo (${url.includes('tiktok') ? 'TikTok' : url.includes('vimeo') ? 'Vimeo' : 'fichier vidéo'})\n${await fetchPageText(url)}`;
    } else {
      emit({ id: `cam-page-${hostOf(url)}`, label: `Lecture de ${hostOf(url)}`, preview: { kind: 'browse', url, imageUrl: livePreview(url), caption: `Ouverture de ${hostOf(url)}` } });
      content = await fetchPageText(url);
    }
    return `── LIEN: ${url} ──\n${content}`;
  }));
  return `\n\n[CONTENU RÉEL DES LIENS DU MESSAGE — récupéré à l'instant. Base ta réponse sur CE contenu réel, ne devine pas :]\n${parts.join('\n\n')}\n[FIN DU CONTENU DES LIENS]`;
}

// ─── Web search (DuckDuckGo, no API key) ─────────────────────────────────────
export async function webSearchResults(query: string, limit = 6): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: timeoutSignal(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results: { title: string; url: string; snippet: string }[] = [];
    const blocks = html.split(/class="result\b/).slice(1);
    for (const block of blocks) {
      const a = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const sn = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      if (!a) continue;
      let href = a[1];
      // DDG wraps URLs: //duckduckgo.com/l/?uddg=<encoded>
      const uddg = href.match(/uddg=([^&]+)/);
      if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch { } }
      results.push({
        title: decodeEntities(a[2].replace(/<[^>]+>/g, '')).trim(),
        url: href,
        snippet: sn ? decodeEntities(sn[1].replace(/<[^>]+>/g, '')).trim().slice(0, 300) : '',
      });
      if (results.length >= limit) break;
    }
    return results;
  } catch {
    return [];
  }
}

export async function webSearch(query: string): Promise<string> {
  const results = await webSearchResults(query, 6);
  if (results.length === 0) return '(Aucun résultat trouvé)';
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
}

// ─── Recherche d'IMAGES (captures d'UI, screenshots produit) ─────────────────
// Utilisée pour reconstruire l'intérieur d'une app (dashboard/éditeur derrière
// login) : on cherche des captures réelles sur le web pour savoir à quoi ça
// ressemble. Deux sources : Firecrawl /search (si clé) puis Bing Images (sans
// clé). Best-effort : renvoie [] si tout échoue.
export interface ImageResult { url: string; title?: string; source?: string }

/** Bing Images (scrape, sans clé API) — extrait les URLs pleine résolution. */
async function bingImages(query: string, limit: number): Promise<ImageResult[]> {
  try {
    const res = await fetch(
      `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`,
      { headers: BROWSER_HEADERS, signal: timeoutSignal(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const out: ImageResult[] = [];
    const seen = new Set<string>();
    // Chaque vignette porte un attribut m="{...json...}" contenant murl (URL réelle).
    const re = /m="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < limit) {
      try {
        const json = JSON.parse(decodeEntities(m[1]));
        const url = json?.murl;
        if (typeof url === 'string' && /^https?:\/\//.test(url) && !seen.has(url)) {
          seen.add(url);
          out.push({ url, title: json?.t, source: json?.purl });
        }
      } catch { /* bloc non-JSON, on ignore */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** Firecrawl /search source=images (haute qualité, nécessite la clé). */
async function firecrawlImages(query: string, limit: number): Promise<ImageResult[]> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return [];
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sources: ['images'], limit }),
      signal: timeoutSignal(20000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const imgs: any[] = json?.data?.images || json?.images || [];
    return imgs
      .map((i: any) => ({ url: i?.imageUrl || i?.url || i?.src, title: i?.title, source: i?.url }))
      .filter((i: any): i is ImageResult => typeof i.url === 'string' && /^https?:\/\//.test(i.url))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function imageSearchResults(query: string, limit = 6): Promise<ImageResult[]> {
  // Firecrawl d'abord (meilleure qualité), Bing en complément/fallback.
  const [fc, bing] = await Promise.all([
    firecrawlImages(query, limit),
    bingImages(query, limit),
  ]);
  const merged: ImageResult[] = [];
  const seen = new Set<string>();
  for (const r of [...fc, ...bing]) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    merged.push(r);
    if (merged.length >= limit) break;
  }
  return merged;
}

// ─── [WEB_SEARCH: query] tag detection ───────────────────────────────────────
export function matchWebSearchTag(reply: string): string | null {
  const m = reply.match(/\[WEB_SEARCH:\s*([^\]]+)\]/i);
  return m ? m[1].trim() : null;
}

// System-prompt block to teach the AI when/how to search (FR — main app language)
export const WEB_SEARCH_INSTRUCTIONS = `
ACCÈS AU WEB (capacité réelle) :
- Tu PEUX chercher sur le web. Si la réponse dépend d'informations actuelles ou que tu ne connais pas de façon fiable (actualités, prix, produits récents, entreprises spécifiques, événements après ta formation), réponds UNIQUEMENT avec le tag : [WEB_SEARCH: ta requête de recherche]
- N'utilise ce tag QUE quand c'est vraiment nécessaire — pour une conversation normale, réponds directement.
- Quand des [RÉSULTATS DE RECHERCHE WEB] te sont fournis, base ta réponse dessus et cite les sources utiles. Ne mentionne JAMAIS le tag ni DuckDuckGo — dis simplement que tu as vérifié sur le web.
- Quand le [CONTENU RÉEL DES LIENS] d'un message t'est fourni, réponds PRÉCISÉMENT sur ce contenu réel (page web, vidéo YouTube avec transcription, etc.). Ne devine jamais.`;
