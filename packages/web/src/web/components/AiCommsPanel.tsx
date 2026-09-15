/**
 * AiCommsPanel — « Communications IA », la page des messages d'un réseau.
 *
 * [2026-09-13] Refonte demandée : la page ne montre plus l'analyse de l'IA ni
 * les scores/statistiques (chiffres en haut, onglets, vues/engagements/clics,
 * note sur 10). Elle affiche UNIQUEMENT ce que l'IA a écrit — le post :
 *   - ordre chronologique, le plus récent EN BAS ;
 *   - à l'ouverture, le fil est déjà collé en bas ;
 *   - l'utilisateur peut remonter librement : l'auto-défilement ne s'applique
 *     aux nouveaux messages que s'il est déjà en bas.
 *
 * [2026-09-13 — 2e passe] Pas de bulles de messagerie et pas d'alignement sur
 * le côté : chaque message occupe toute la largeur, aligné à gauche, séparé du
 * suivant par un simple filet. Un thread est découpé sur le délimiteur
 * `---TWEET---` pour montrer exactement ce qui part sur la plateforme (un bloc
 * par tweet), et non le texte brut avec les délimiteurs dedans.
 * Seule information conservée à côté du texte : l'heure, et un marqueur rouge
 * quand la plateforme a REFUSÉ le post (exigence de véracité : on ne fait pas
 * passer un échec pour un envoi).
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  companyId: string;
  /** Filtre réseau (ex. 'twitter'). Vide = tous. */
  platform?: string;
}

interface Comms {
  posts: Array<{
    id: string; platform: string; type: string; content: string; status: string;
    url: string | null; score: number | null;
    vues: number; engagements: number; clics: number; reponses: number;
    publishedAt: number | null; scheduledFor: number | null; createdAt: number | null;
  }>;
  interactions: Array<{
    id: string; platform: string; type: string; auteur: string | null;
    message: string | null; reponseIA: string | null; statut: string | null;
    sentiment: string | null; createdAt: number | null;
  }>;
}

/** Un message du fil : ce que l'IA a écrit, rien d'autre. */
interface FeedItem {
  id: string;
  /** Le message tel qu'il part : un bloc par tweet pour un thread. */
  parts: string[];
  at: number;
  /** false = la plateforme n'a pas confirmé l'envoi. */
  sent: boolean;
  failed: boolean;
  url: string | null;
}

function ms(v: number | null): number {
  if (!v) return 0;
  return v < 2_000_000_000 ? v * 1000 : v;
}

/**
 * Découpe le contenu exactement comme le fait l'envoi (cf. platforms.ts, qui
 * split sur `---TWEET---` et poste un tweet par morceau). Le délimiteur ne doit
 * jamais s'afficher : ce n'est pas du texte envoyé.
 */
function toParts(content: string): string[] {
  return (content || '')
    .split(/-{2,}\s*TWEET\s*-{2,}/i)
    .map(t => t.trim())
    .filter(Boolean);
}

function hhmm(v: number): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

export function AiCommsPanel({ companyId, platform }: Props) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** L'utilisateur est-il collé en bas ? Sinon on ne le dérange pas. */
  const atBottomRef = useRef(true);
  /** Premier rendu de ce réseau → saut en bas sans animation. */
  const firstPaintRef = useRef(true);

  useEffect(() => {
    if (!companyId) return;
    // Changement de réseau = nouveau fil : on repart collé en bas.
    firstPaintRef.current = true;
    atBottomRef.current = true;
    setLoaded(false);

    let cancelled = false;
    const load = () => {
      const q = `companyId=${encodeURIComponent(companyId)}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}`;
      fetch(`/api/ai-comms?${q}`)
        .then(r => r.json())
        .then((d: any) => {
          if (cancelled) return;
          if (d.error) { setErr(d.error); setLoaded(true); return; }
          const data = d as Comms;
          const feed: FeedItem[] = [
            // Les posts écrits par l'IA.
            ...data.posts.map(p => ({
              id: p.id,
              parts: toParts(p.content || ''),
              at: ms(p.publishedAt || p.createdAt || p.scheduledFor),
              sent: p.status === 'published',
              failed: p.status === 'failed' || p.status === 'rejected',
              url: p.url,
            })),
            // Les réponses envoyées par l'IA aux mentions : c'est aussi « la
            // réponse de l'IA ». Le message entrant, lui, n'est pas affiché.
            ...data.interactions
              .filter(i => !!i.reponseIA)
              .map(i => ({
                id: `r-${i.id}`,
                parts: toParts(i.reponseIA || ''),
                at: ms(i.createdAt),
                sent: i.statut === 'sent',
                failed: i.statut === 'failed',
                url: null,
              })),
          ]
            .filter(x => x.parts.length > 0)
            // Le plus ANCIEN en haut, le plus RÉCENT en bas (fil de messagerie).
            .sort((a, b) => a.at - b.at);

          setItems(feed);
          setErr(null);
          setLoaded(true);
        })
        .catch((e) => { if (!cancelled) { setErr(e?.message || 'Chargement impossible'); setLoaded(true); } });
    };
    load();
    const t = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, [companyId, platform]);

  // Collage en bas : immédiat à l'ouverture, puis seulement si on y était déjà.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !loaded) return;
    if (firstPaintRef.current) {
      el.scrollTop = el.scrollHeight;
      firstPaintRef.current = false;
      return;
    }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [items, loaded]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // 40px de marge : on considère qu'on est « en bas » sans exiger le pixel.
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col"
      >
        {err ? (
          <p className="text-[11px]" style={{ color: '#ef4444' }}>{err}</p>
        ) : !loaded ? (
          <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>
            L'IA n'a encore rien écrit sur ce réseau.
          </p>
        ) : (
          items.map((it, idx) => (
            // Pleine largeur, aligné à gauche, séparé par un filet : pas de
            // bulle, pas d'alignement sur le côté.
            <div
              key={it.id}
              className="w-full py-3"
              style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-ghost)' }}>{hhmm(it.at)}</span>
                {it.failed && (
                  <span className="text-[9px]" style={{ color: '#ef4444' }}>non envoyé</span>
                )}
                {it.url ? (
                  <a href={it.url} target="_blank" rel="noreferrer" className="text-[9px]" style={{ color: 'var(--teal)' }}>
                    voir
                  </a>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                {it.parts.map((part, i) => (
                  <div key={i} className="flex gap-2">
                    {it.parts.length > 1 && (
                      <span className="text-[9px] pt-0.5 tabular-nums shrink-0" style={{ color: 'var(--text-ghost)' }}>
                        {i + 1}/{it.parts.length}
                      </span>
                    )}
                    <p
                      className="text-[12px] whitespace-pre-wrap leading-relaxed flex-1"
                      style={{ color: it.failed ? 'var(--text-dim)' : 'var(--text-primary)' }}
                    >
                      {part}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AiCommsPanel;
