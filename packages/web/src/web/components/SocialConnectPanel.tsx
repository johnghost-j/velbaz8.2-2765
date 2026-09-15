/**
 * SocialConnectPanel — Inline panel for the preview rectangle.
 * After website builds, this replaces the website preview.
 * Flow: connect platforms → AI learns brand voice → live message management
 */

import { useState, useEffect, useRef } from 'react';
import { SocialRightPane } from './SocialRightPane';
import { getAuthToken } from '../lib/token';
import { useBuildStore } from '../lib/build-store';
import { api } from '../lib/api';

function getToken() {
  return getAuthToken();
}

/** false = plus de rectangle de fond par ligne : juste une pastille en
 *  demi-cercle collée à gauche du grand rectangle. Mettre true pour
 *  retrouver l'ancien rendu en cartes (rien n'est supprimé). */
const SOCIAL_ROW_CARD = false;

/** false = aucune pastille : juste le logo du réseau à gauche, et une ligne
 *  fine qui sépare chaque réseau. true = ancien rendu avec pastille. */
const SOCIAL_ROW_PASTILLE = false;

/** false = pas de nom/description de réseau : juste le logo, avec une seule
 *  ligne VERTICALE à sa droite (aucune ligne horizontale). true = ancien rendu. */
const SOCIAL_ROW_NAME = false;

/** true = un seul réseau sélectionnable à la fois (radio).
 *  false = ancien comportement multi-sélection. */
const SOCIAL_SINGLE_SELECT = true;

/** true = colonne de logos | ligne verticale | panneau de droite (connexion
 *  ou X en direct). false = ancien rendu en lignes pleine largeur. */
const SOCIAL_SPLIT_VIEW = true;

const PLATFORMS = [
  {
    id: 'twitter',
    name: 'Twitter / X',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
    color: '#000',
    darkColor: '#fff',
    desc: 'Tweets, replies, DMs',
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.076-.14.006-.31-.14-.36a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.373-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
      </svg>
    ),
    color: '#5865F2',
    darkColor: '#5865F2',
    desc: 'Servers, channels, community',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
      </svg>
    ),
    color: '#FF4500',
    darkColor: '#FF4500',
    desc: 'Subreddits, posts, comments',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
    color: '#E4405F',
    darkColor: '#E4405F',
    desc: 'Stories, reels, DMs',
  },
];

// AI brain stages shown during learning phase
const BRAIN_STAGES = [
  { icon: '🧠', label: 'Strategist', desc: 'Analyzing brand identity...' },
  { icon: '✍️', label: 'Writer', desc: 'Crafting communication style...' },
  { icon: '🎭', label: 'Tone Calibrator', desc: 'Matching brand personality...' },
  { icon: '🔍', label: 'Fact Checker', desc: 'Verifying brand claims...' },
  { icon: '🛡️', label: 'Anti-Spam', desc: 'Setting authenticity rules...' },
  { icon: '✅', label: 'Approver', desc: 'Defining approval criteria...' },
  { icon: '💬', label: 'Engagement', desc: 'Learning response patterns...' },
  { icon: '🏗️', label: 'Community Builder', desc: 'Planning growth strategy...' },
];

interface Props {
  companyId: string;
}

export function SocialConnectPanel({ companyId }: Props) {
  const build = useBuildStore();
  const { socialPhase, connectedPlatforms, setSocialPhase, setConnectedPlatforms } = build;

  // État réseaux sociaux PAR PROJET : le skip / les connexions d'un projet ne
  // débordent plus sur les autres projets.
  useEffect(() => {
    if (companyId) build.loadSocial(companyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [brainIndex, setBrainIndex] = useState(0);
  const [fadeIn, setFadeIn] = useState(false);
  const [messages, setMessages] = useState<Array<{ id: string; platform: string; direction: 'in' | 'out'; text: string; time: string }>>([]);
  const [generating, setGenerating] = useState(false);
  // [2026-09-12] `published` vient MAINTENANT du serveur : l'UI affichait
  // « Published to … » dès qu'un texte était généré, même quand la publication
  // avait échoué (jeton démo, 403 X…). On ne dit plus « envoyé » sans preuve.
  const [lastPost, setLastPost] = useState<{ content: string; platform: string; url?: string; published: boolean; error?: string; fixUrl?: string } | null>(null);
  /** Connexions telles que le SERVEUR les connaît (source de vérité). */
  const [conns, setConns] = useState<Record<string, { username?: string | null; isDemo: boolean }>>({});
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  /** [2026-09-13] Barre de prompte unique (style page d'accueil) : un seul texte,
      envoyé vers UNE plateforme à la fois, choisie par les pastilles de la barre. */
  const [composeText, setComposeText] = useState('');
  const [composeTarget, setComposeTarget] = useState<string>('twitter');
  const composeRef = useRef<HTMLTextAreaElement>(null);
  /** Plateforme en cours d'envoi. */
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  // ─── Source de vérité : les connexions enregistrées côté serveur ───────────
  // [2026-09-11] Sans ça, l'UI se fiait à son état local : on restait « bloqué »
  // sur un réseau, sans savoir lequel était réellement lié ni pouvoir le délier.
  const refreshConnections = async () => {
    if (!companyId) return {} as Record<string, { username?: string | null; isDemo: boolean }>;
    try {
      const tok = getToken();
      const res = await fetch(`/api/companies/${companyId}/social/connections`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!res.ok) return {};
      const data = await res.json() as any;
      const list: any[] = Array.isArray(data) ? data : (data.connections ?? []);
      const map: Record<string, { username?: string | null; isDemo: boolean }> = {};
      for (const c of list) {
        if (!c?.platform || !c.isActive) continue;
        map[c.platform] = { username: c.platformUsername, isDemo: !!c.isDemo };
      }
      setConns(map);
      setConnected(new Set(Object.keys(map)));
      return map;
    } catch {
      return {};
    }
  };

  useEffect(() => {
    if (!companyId) return;
    refreshConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  /** Délie un réseau : supprime la connexion serveur puis rouvre le choix. */
  const disconnectPlatform = async (platformId: string) => {
    if (!companyId || disconnecting) return;
    setDisconnecting(platformId);
    try {
      const tok = getToken();
      const res = await fetch(`/api/companies/${companyId}/social/${platformId}`, {
        method: 'DELETE',
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!res.ok) throw new Error(`Échec de la déconnexion (${res.status})`);
      const map = await refreshConnections();
      const remaining = Object.keys(map);
      setConnectedPlatforms(remaining);
      setErrors(prev => { const n = { ...prev }; delete n[platformId]; return n; });
      // Plus aucun réseau lié → on revient à l'écran de choix.
      if (remaining.length === 0) setSocialPhase('connecting');
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [platformId]: err.message || 'Déconnexion impossible' }));
    } finally {
      setDisconnecting(null);
    }
  };

  // Fade in on mount
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setFadeIn(true)));
  }, []);

  // Brain animation during learning phase
  useEffect(() => {
    if (socialPhase !== 'learning') return;
    const iv = setInterval(() => {
      setBrainIndex(prev => {
        if (prev >= BRAIN_STAGES.length - 1) {
          // All brains done → go active
          setTimeout(() => setSocialPhase('active'), 800);
          clearInterval(iv);
          return prev;
        }
        return prev + 1;
      });
    }, 2200);
    return () => clearInterval(iv);
  }, [socialPhase]);

  // Poll messages in active phase
  useEffect(() => {
    if (socialPhase !== 'active' || !companyId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/companies/${companyId}/social/messages`);
        if (cancelled) return;
        const data = await res.json() as any;
        if (data.messages) setMessages(data.messages.slice(0, 20));
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [socialPhase, companyId]);

  // Listen for OAuth callbacks
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'oauth-success') {
        setConnected(prev => new Set([...prev, e.data.platform]));
        setConnecting(null);
      } else if (e.data?.type === 'oauth-error') {
        setErrors(prev => ({ ...prev, [e.data.platform]: e.data.error || 'Connection failed' }));
        setConnecting(null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const togglePlatform = (id: string) => {
    setSelected(prev => {
      // Sélection unique : choisir un réseau désélectionne l'autre.
      if (SOCIAL_SINGLE_SELECT) return prev.has(id) ? new Set<string>() : new Set<string>([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** Réseau actuellement sélectionné (sélection unique). */
  const activeId = PLATFORMS.find(p => selected.has(p.id))?.id || null;

  /** Vérifie côté serveur qu'une connexion réelle existe pour cette plateforme. */
  const verifyConnection = async (platformId: string): Promise<boolean> => {
    try {
      const tok = getToken();
      const res = await fetch(`/api/companies/${companyId}/social/connections`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!res.ok) return false;
      const data = await res.json() as any;
      const list: any[] = Array.isArray(data) ? data : (data.connections ?? []);
      return list.some(c => c.platform === platformId && Boolean(c.isActive) && !c.isDemo);
    } catch {
      return false;
    }
  };

  const startConnecting = async () => {
    // Rien de sélectionné mais des réseaux déjà liés → « Continuer » renvoie au
    // tableau de bord au lieu de ne rien faire (ancien bouton mort).
    if (selected.size === 0) {
      if (connected.size > 0) {
        setConnectedPlatforms(Array.from(connected));
        setSocialPhase('active');
      }
      return;
    }

    // [2026-09-12] Un réseau DÉJÀ lié ne doit pas relancer OAuth quand on reclique
    // sur le bouton : X renvoie alors « Something went wrong ». Si tout le
    // sélectionné est déjà connecté, le bouton sert simplement de « Continuer ».
    const toConnect = Array.from(selected).filter(id => !connected.has(id));
    if (toConnect.length === 0) {
      setConnectedPlatforms(Array.from(new Set([...connected, ...selected])));
      setSocialPhase('active');
      return;
    }

    // Track locally which platforms successfully connected (don't rely on React state)
    const successfullyConnected: string[] = [];
    let lastOauthError: string | null = null;

    for (const platformId of toConnect) {
      lastOauthError = null;
      setConnecting(platformId);
      try {
        const tok = getToken();
        const res = await fetch(`/api/companies/${companyId}/social/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          },
          // L'origine réelle du navigateur : le proxy réécrit Host/Origin côté serveur,
          // donc c'est le seul moyen fiable de faire revenir la popup OAuth ici.
          body: JSON.stringify({ platform: platformId, origin: window.location.origin }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Server error ${res.status}: ${text.slice(0, 100)}`);
        }

        const data = await res.json() as any;

        if (data.demo) {
          // Demo mode — instant connection, no popup
          successfullyConnected.push(platformId);
          setConnected(prev => new Set([...prev, platformId]));
        } else if (data.authUrl) {
          // Real OAuth — open popup and wait for an explicit result
          const w = window.open(data.authUrl, `oauth_${platformId}`, 'width=600,height=700,left=200,top=100');
          if (!w) throw new Error('Popup bloquée par le navigateur — autorise les fenêtres surgissantes puis réessaie');

          const outcome = await new Promise<'success' | 'error' | 'closed' | 'timeout'>((resolve) => {
            const cleanup = () => {
              window.removeEventListener('message', handleMessage);
              clearInterval(interval);
              clearTimeout(timer);
            };
            const handleMessage = (event: MessageEvent) => {
              if (event.data?.platform && event.data.platform !== platformId) return;
              if (event.data?.type === 'oauth-success') { cleanup(); resolve('success'); }
              else if (event.data?.type === 'oauth-error') {
                lastOauthError = event.data.error || null;
                cleanup();
                resolve('error');
              }
            };
            window.addEventListener('message', handleMessage);
            const interval = setInterval(() => {
              if (w.closed) {
                cleanup();
                setTimeout(() => resolve('closed'), 400);
              }
            }, 500);
            const timer = setTimeout(() => { cleanup(); resolve('timeout'); }, 120000);
          });

          // Ne jamais supposer le succès : on confirme auprès du serveur.
          const ok = outcome === 'success' ? true : await verifyConnection(platformId);
          if (!ok) {
            throw new Error(
              lastOauthError
                || (outcome === 'timeout'
                  ? 'Délai dépassé — la connexion n’a pas été confirmée'
                  : 'Connexion annulée ou refusée — aucune autorisation reçue'),
            );
          }
          successfullyConnected.push(platformId);
          setConnected(prev => new Set([...prev, platformId]));
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [platformId]: err.message }));
      }
    }
    setConnecting(null);

    if (successfullyConnected.length === 0) {
      console.error('[social] No platforms were connected');
      return;
    }

    // Union avec ce que le serveur connaît déjà : connecter un 2e réseau ne
    // doit plus effacer le 1er.
    const serverMap = await refreshConnections();
    const allConnected = Array.from(new Set([...Object.keys(serverMap), ...successfullyConnected]));
    setConnectedPlatforms(allConnected);

    // [2026-09-12] On RESTE sur cet écran après la connexion : l'utilisateur veut
    // garder sous les yeux le bouton Connecter/Déconnecter. L'apprentissage et la
    // 1re publication tournent en arrière-plan, sans changer de page.
    try {
      console.log(`[social] Learning style for company ${companyId}...`);
      await fetch(`/api/companies/${companyId}/social/learn-style`, { method: 'POST' });
      console.log(`[social] Generating posts for: ${successfullyConnected.join(', ')}`);
      // Now generate & auto-publish a real post for each connected platform
      for (const pid of successfullyConnected) {
        try {
          const genRes = await fetch(`/api/companies/${companyId}/social/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: pid }),
          });
          const genData = await genRes.json() as any;
          console.log(`[social] Generate response for ${pid}:`, genData);
          if (genData.content) {
            setLastPost({
              content: genData.content,
              platform: pid,
              url: genData.platformPostUrl,
              published: genData.published === true,
              fixUrl: genData.publishFixUrl,
              error: genData.publishError || genData.error || (genData.status && genData.status !== 'approved'
                ? `Contenu non approuvé par l'IA (statut : ${genData.status}, score ${genData.finalScore ?? 0})`
                : "Aucune publication n'a été envoyée"),
            });
          }
          if (genData.published !== true) {
            setErrors(prev => ({
              ...prev,
              [pid]: genData.publishError || genData.error || 'Publication refusée par la plateforme',
            }));
          }
        } catch (e) {
          console.error(`Failed to generate for ${pid}:`, e);
        }
      }
    } catch (e) {
      console.error('[social] Pipeline error:', e);
    }
  };

  const handleSkip = () => {
    setSocialPhase('active');
    setConnectedPlatforms([]);
  };

  /**
   * [2026-09-13] Génération + publication, appelable depuis N'IMPORTE QUEL
   * écran. Avant, le bouton « Generate & Post Now » n'existait que dans la
   * phase `active` : il fallait cliquer « Continuer » et changer de page pour
   * pouvoir écrire un post. Cette fonction est maintenant partagée entre
   * l'écran de connexion et l'écran actif.
   */
  const generateAndPost = async (targets: string[], prompt?: string, marker?: string) => {
    if (generating || targets.length === 0) return;
    // [2026-09-13] Jamais de repli silencieux sur une autre plateforme : si la
    // cible demandée n'est pas liée, on le dit au lieu de publier sur X.
    const linked = Array.from(new Set([...connected, ...connectedPlatforms]));
    const unlinked = targets.filter(t => !linked.includes(t));
    if (unlinked.length > 0) {
      setLastPost({
        content: prompt?.trim() || '',
        platform: unlinked[0],
        published: false,
        error: `${PLATFORMS.find(p => p.id === unlinked[0])?.name || unlinked[0]} n'est pas connecté — lie ce réseau avant de publier.`,
      });
      return;
    }
    setGenerating(true);
    setSendingTo(marker || targets[0]);
    try {
      for (const pid of targets) {
        const res = await fetch(`/api/companies/${companyId}/social/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: pid, ...(prompt?.trim() ? { prompt: prompt.trim() } : {}) }),
        });
        const data = await res.json() as any;
        if (!res.ok) {
          setLastPost({
            content: prompt?.trim() || '',
            platform: pid,
            published: false,
            error: data?.error || `Le serveur a répondu ${res.status}`,
          });
          continue;
        }
        if (data.content) {
          setLastPost({
            content: data.content,
            platform: pid,
            url: data.platformPostUrl,
            published: data.published === true,
            fixUrl: data.publishFixUrl,
            error: data.publishError || data.error || (data.status && data.status !== 'approved'
              ? `Contenu non approuvé par l'IA (statut : ${data.status}, score ${data.finalScore ?? 0})`
              : "Aucune publication n'a été envoyée"),
          });
        }
      }
    } catch (e: any) {
      console.error('[social] generateAndPost:', e);
      setLastPost({ content: prompt?.trim() || '', platform: targets[0], published: false, error: e?.message || 'Erreur réseau' });
    }
    setGenerating(false);
    setSendingTo(null);
  };

  /** Réseaux réellement liés côté serveur, cibles possibles d'une publication. */
  const publishTargets = Array.from(new Set([...connected, ...connectedPlatforms]));

  /**
   * [2026-09-13] La cible se choisit en OUVRANT la page du réseau (clic sur sa
   * ligne à gauche), pas avec un bouton dans la barre de prompte. La barre suit
   * `activeId` : être sur la page Discord = écrire pour Discord.
   * Avant, un effet recalait `composeTarget` sur `publishTargets[0]`, donc tout
   * repartait sur Twitter/X quel que soit le réseau ouvert.
   */
  useEffect(() => {
    if (activeId) setComposeTarget(activeId);
  }, [activeId]);

  /** La cible est-elle réellement publiable (connexion active côté serveur) ? */
  const targetConnected = publishTargets.includes(composeTarget);
  const targetMeta = PLATFORMS.find(p => p.id === composeTarget);

  /**
   * Barre de prompte unique, calquée sur celle de la page d'accueil (boîte
   * arrondie `surface-3`, textarea transparent qui grandit, rangée du bas avec
   * le bouton rond d'envoi). Elle n'affiche que la destination — le réseau dont
   * la page est ouverte — et n'envoie que là : une plateforme à la fois, jamais
   * d'envoi groupé ni de repli silencieux sur X. Largeur bornée pour ne pas
   * sortir du rectangle.
   */
  const composer = (
    <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
      <div
        className="w-full rounded-2xl"
        style={{
          background: 'var(--surface-3)',
          border: '1px solid var(--border-default)',
          overflow: 'hidden',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div className="px-3 pt-2.5 pb-1">
          <textarea
            ref={composeRef}
            value={composeText}
            onChange={(e) => {
              setComposeText(e.target.value);
              const ta = composeRef.current;
              if (ta) {
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!generating && targetConnected) generateAndPost([composeTarget], composeText, composeTarget);
              }
            }}
            placeholder={targetConnected
              ? `Ton idée de post pour ${targetMeta?.name || composeTarget}…`
              : `${targetMeta?.name || composeTarget} n'est pas connecté — lie ce réseau pour pouvoir écrire`}
            rows={1}
            disabled={generating}
            className="w-full min-w-0 text-[12px] bg-transparent focus:outline-none resize-none leading-relaxed"
            style={{
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              maxHeight: 80,
              transition: 'height 0.15s ease',
            }}
          />
        </div>
        <div className="px-2.5 pb-2 flex items-center gap-1 min-w-0">
          {/* [2026-09-13] Plus de pastilles de choix ICI : la cible est le réseau
              dont on a ouvert la page (clic sur sa ligne à gauche). La barre ne
              fait qu'afficher cette destination, elle ne la choisit pas. */}
          <span
            className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md"
            style={{ background: 'var(--surface-4)', color: targetMeta?.darkColor || 'var(--text-dim)' }}
            title={targetMeta?.name || composeTarget}
          >
            <span className="scale-[0.55] origin-center flex">{targetMeta?.icon}</span>
          </span>
          <div className="flex-1 min-w-0" />
          <span className="shrink-0 text-[9px] truncate" style={{ color: 'var(--text-ghost)', maxWidth: 90 }}>
            {targetConnected ? `→ ${targetMeta?.name || composeTarget}` : 'non connecté'}
          </span>
          <button
            type="button"
            onClick={() => generateAndPost([composeTarget], composeText, composeTarget)}
            disabled={generating || !targetConnected}
            title={targetConnected ? `Envoyer sur ${targetMeta?.name}` : `${targetMeta?.name} n'est pas connecté`}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-all disabled:opacity-40"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
          >
            {generating ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // ─── CONNECTING PHASE ───
  if (socialPhase === 'connecting' || socialPhase === 'none') {
    return (
      <div
        className="h-full flex flex-col"
        style={{
          background: 'var(--surface-0)',
          opacity: fadeIn ? 1 : 0,
          transform: fadeIn ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-4)', color: 'var(--text-primary)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Connect Your Platforms</h3>
              <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>AI will manage your social presence</p>
            </div>
          </div>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            Select the platforms where you want AI to communicate. Every message passes through 8 AI brains before being sent.
          </p>
        </div>

        {/* Platform list */}
        {SOCIAL_SPLIT_VIEW ? (
          /* Colonne de logos | UNE ligne verticale continue | panneau de droite */
          <div className="flex-1 min-h-0 flex">
            <div className="shrink-0 flex flex-col py-4 pl-4 pr-3">
              {PLATFORMS.map((p, i) => {
                const isSelected = selected.has(p.id);
                const isConnecting2 = connecting === p.id;
                const isConnected = connected.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => !isConnecting2 && togglePlatform(p.id)}
                    disabled={isConnecting2}
                    title={isConnected ? `${p.name} — connecté` : p.name}
                    className="relative shrink-0 w-11 h-11 rounded-lg flex items-center justify-center mb-1.5 transition-all"
                    style={{
                      color: p.darkColor,
                      background: isSelected ? `${p.color}22` : `${p.color}0d`,
                      opacity: isSelected || isConnected ? 1 : 0.45,
                      border: `1.5px solid ${isSelected ? p.darkColor : 'transparent'}`,
                      transform: fadeIn ? 'translateX(0)' : 'translateX(-10px)',
                      transition: `all 0.25s ease ${i * 70}ms`,
                    }}
                  >
                    {p.icon}
                    {/* Pastille verte : ce réseau est réellement lié côté serveur. */}
                    {isConnected && (
                      <span
                        className="absolute"
                        style={{
                          top: 3, right: 3, width: 7, height: 7, borderRadius: 999,
                          background: conns[p.id]?.isDemo ? '#f59e0b' : '#10b981',
                          boxShadow: '0 0 0 2px var(--surface-0)',
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {/* La seule ligne : verticale, continue, du haut vers le bas */}
            <div className="shrink-0 self-stretch" style={{ width: 1, background: 'var(--border-subtle)' }} />
            <div className="flex-1 min-w-0">
              <SocialRightPane
                platform={PLATFORMS.find(p => selected.has(p.id)) || null}
                companyId={companyId}
                isConnected={!!activeId && connected.has(activeId)}
                isConnecting={!!activeId && connecting === activeId}
                error={activeId ? errors[activeId] : undefined}
                onConnect={startConnecting}
                username={activeId ? conns[activeId]?.username : undefined}
                isDemo={activeId ? !!conns[activeId]?.isDemo : false}
                isDisconnecting={!!activeId && disconnecting === activeId}
                onDisconnect={activeId ? () => disconnectPlatform(activeId) : undefined}
                /* [2026-09-13] La barre de prompte est rendue DANS le panneau
                   de droite : sinon elle s'étendait sous la colonne de logos et
                   dépassait du rectangle qui montre les messages. */
                footer={composer}
              />
            </div>
          </div>
        ) : (
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${SOCIAL_ROW_CARD ? 'space-y-2.5' : 'space-y-0'}`}>
          {PLATFORMS.map((p, i) => {
            const isSelected = selected.has(p.id);
            const isConnecting2 = connecting === p.id;
            const isConnected = connected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => !isConnecting2 && togglePlatform(p.id)}
                disabled={isConnecting2}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all"
                style={{
                  background: SOCIAL_ROW_CARD
                    ? (isConnected ? 'rgba(16,185,129,0.08)' : isSelected ? 'var(--surface-3)' : 'var(--surface-2)')
                    : 'transparent',
                  border: SOCIAL_ROW_CARD
                    ? `1.5px solid ${isConnected ? '#10b981' : isSelected ? 'var(--border-hover)' : 'var(--border-subtle)'}`
                    : '1.5px solid transparent',
                  // Aucune ligne horizontale : la séparation est la ligne
                  // VERTICALE rendue à droite du logo (voir plus bas).
                  ...(SOCIAL_ROW_CARD ? {} : { borderRadius: 0 }),
                  opacity: fadeIn ? 1 : 0,
                  transform: fadeIn ? 'translateX(0)' : 'translateX(-10px)',
                  transition: `all 0.3s ease ${i * 80}ms`,
                }}
              >
                {/* Pastille de sélection (désactivée par SOCIAL_ROW_PASTILLE) :
                    à GAUCHE du rectangle. Le clic sur toute la ligne sélectionne. */}
                {!SOCIAL_ROW_PASTILLE ? null : isConnecting2 ? (
                  <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: p.color, borderTopColor: 'transparent' }}/>
                ) : isConnected ? (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#10b981' }}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>
                  </div>
                ) : SOCIAL_ROW_CARD ? (
                  <div className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: isSelected ? 'var(--text-primary)' : 'transparent', border: `2px solid ${isSelected ? 'var(--text-primary)' : 'var(--border-default)'}` }}>
                    {isSelected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>}
                  </div>
                ) : (
                  /* Demi-cercle collé au bord gauche du grand rectangle. */
                  <div className="shrink-0" style={{
                    width: 11, height: 26, marginLeft: -14,
                    borderRadius: '0 999px 999px 0',
                    background: isSelected ? 'var(--text-primary)' : 'transparent',
                    border: `1.5px solid ${isSelected ? 'var(--text-primary)' : 'var(--border-default)'}`,
                    borderLeft: 'none',
                    transition: 'all 0.18s ease',
                  }}/>
                )}
                <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ color: p.darkColor, background: `${p.color}12`, opacity: SOCIAL_ROW_NAME || isSelected || isConnected ? 1 : 0.45 }}>
                  {p.icon}
                </div>
                {/* Une seule ligne VERTICALE, à droite des logos : les lignes se
                    touchent d'une ligne à l'autre (gap 0) donc elle est continue. */}
                {!SOCIAL_ROW_NAME && (
                  <div className="shrink-0 self-stretch" style={{ width: 1, background: 'var(--border-subtle)' }}/>
                )}
                {SOCIAL_ROW_NAME ? (
                  <div className="flex-1 text-left">
                    <div className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{p.desc}</div>
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                {errors[p.id] && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>Error</span>
                )}
              </button>
            );
          })}
        </div>
        )}

        {/* [2026-09-13] Compositeur ICI MÊME : créer et envoyer un post sans
            cliquer « Continuer » et sans changer d'écran.
            En vue scindée il est rendu à l'intérieur du panneau de droite
            (prop `footer`), pour rester dans la largeur du fil de messages. */}
        {!SOCIAL_SPLIT_VIEW && composer}

        {/* [2026-09-12] Résultat RÉEL de la dernière publication, visible sans
            quitter cet écran : vert seulement si la plateforme a confirmé. */}
        {lastPost && (
          <div className="px-5 py-2.5" style={{ borderTop: '1px solid var(--border-subtle)', background: lastPost.published ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)' }}>
            <div className="text-[10px] font-medium mb-0.5" style={{ color: lastPost.published ? '#10b981' : '#ef4444' }}>
              {lastPost.published
                ? `Publié sur ${lastPost.platform}`
                : `NON publié sur ${lastPost.platform} — texte généré uniquement`}
            </div>
            {!lastPost.published && lastPost.error && (
              <div className="text-[10px]" style={{ color: '#ef4444' }}>{lastPost.error}</div>
            )}
            {!lastPost.published && lastPost.fixUrl && (
              <a href={lastPost.fixUrl} target="_blank" rel="noopener" className="text-[10px] underline" style={{ color: '#ef4444' }}>
                Débloquer le compte →
              </a>
            )}
            {lastPost.published && lastPost.url && (
              <a href={lastPost.url} target="_blank" rel="noopener" className="text-[10px]" style={{ color: 'var(--teal)' }}>Voir la publication →</a>
            )}
          </div>
        )}

        {/* Footer — [2026-09-13] bouton « Continuer » retiré à la demande de
            l'utilisateur : tout se fait sur cet écran (connexion + compositeur),
            il n'y a plus de page suivante vers laquelle avancer. */}
        <div className="px-5 py-2 flex items-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={handleSkip}
            className="text-[11px] px-3 py-1.5 rounded-lg"
            style={{ color: 'var(--text-ghost)' }}
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // ─── LEARNING PHASE ───
  if (socialPhase === 'learning') {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6" style={{ background: 'var(--surface-0)' }}>
        {/* Animated brain pipeline */}
        <div className="mb-6">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(78, 170, 220,0.15), rgba(68,184,168,0.08))', fontSize: 28 }}>
            {BRAIN_STAGES[brainIndex]?.icon}
          </div>
          <h3 className="text-[15px] font-semibold text-center mb-1" style={{ color: 'var(--text-primary)' }}>
            AI is Learning Your Brand
          </h3>
          <p className="text-[12px] text-center" style={{ color: 'var(--text-ghost)' }}>
            8 brains are calibrating to your identity
          </p>
        </div>

        {/* Brain pipeline progress */}
        <div className="w-full max-w-xs space-y-1.5">
          {BRAIN_STAGES.map((stage, i) => {
            const isDone = i < brainIndex;
            const isCurrent = i === brainIndex;
            const isPending = i > brainIndex;
            return (
              <div
                key={stage.label}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all"
                style={{
                  background: isCurrent ? 'var(--surface-3)' : 'transparent',
                  opacity: isPending ? 0.35 : 1,
                  transform: isCurrent ? 'scale(1.02)' : 'scale(1)',
                  transition: 'all 0.4s ease',
                }}
              >
                <span className="text-[14px] w-6 text-center">{stage.icon}</span>
                <div className="flex-1">
                  <div className="text-[11px] font-medium" style={{ color: isDone ? '#10b981' : isCurrent ? 'var(--text-primary)' : 'var(--text-ghost)' }}>
                    {stage.label}
                  </div>
                  {isCurrent && (
                    <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{stage.desc}</div>
                  )}
                </div>
                {isDone && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>
                )}
                {isCurrent && (
                  <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--teal)', borderTopColor: 'transparent' }}/>
                )}
              </div>
            );
          })}
        </div>

        {/* Connected platforms mini badges */}
        {connectedPlatforms.length > 0 && (
          <div className="flex items-center gap-1.5 mt-6">
            {connectedPlatforms.map(pid => {
              const p = PLATFORMS.find(pp => pp.id === pid);
              if (!p) return null;
              return (
                <div key={pid} className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: `${p.color}15`, color: p.darkColor }}>
                  {p.icon}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── ACTIVE PHASE ───
  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--surface-0)' }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#10b981' }} />
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>Social AI Active</span>
        <div className="flex-1"/>
        <div className="flex items-center gap-1">
          {connectedPlatforms.map(pid => {
            const p = PLATFORMS.find(pp => pp.id === pid);
            if (!p) return null;
            return (
              <div key={pid} className="w-5 h-5 rounded flex items-center justify-center" style={{ color: p.darkColor, fontSize: 10 }}>
                {p.icon}
              </div>
            );
          })}
        </div>
        {/* [2026-09-11] Sortie de secours : on n'est plus enfermé dans la phase
            active. Retour à l'écran de choix pour lier un autre réseau ou
            délier celui en place — les connexions existantes sont conservées. */}
        <button
          onClick={() => { refreshConnections(); setSocialPhase('connecting'); }}
          className="text-[10px] font-medium px-2 py-1 rounded-lg shrink-0"
          style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
        >
          Gérer les réseaux
        </button>
      </div>

      {/* Last published post */}
      {lastPost && (
        <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(78, 170, 220,0.04)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: lastPost.published ? '#10b981' : '#ef4444' }}/>
            <span className="text-[10px] font-medium" style={{ color: lastPost.published ? '#10b981' : '#ef4444' }}>
              {lastPost.published
                ? `Publié sur ${lastPost.platform}`
                : `NON publié sur ${lastPost.platform} — texte généré uniquement`}
            </span>
          </div>
          {!lastPost.published && lastPost.error && (
            <p className="text-[10px] mb-1" style={{ color: '#ef4444' }}>{lastPost.error}</p>
          )}
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{lastPost.content.slice(0, 200)}{lastPost.content.length > 200 ? '...' : ''}</p>
          {lastPost.url && lastPost.url !== 'https://demo.example.com' && (
            <a href={lastPost.url} target="_blank" rel="noopener" className="text-[10px] mt-1 inline-block" style={{ color: 'var(--teal)' }}>View post →</a>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="px-4 py-2.5 flex items-center gap-4" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="text-center">
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{messages.filter(m => m.direction === 'in').length}</div>
          <div className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>Received</div>
        </div>
        <div className="w-px h-6" style={{ background: 'var(--border-subtle)' }}/>
        <div className="text-center">
          <div className="text-[14px] font-semibold" style={{ color: 'var(--teal)' }}>{messages.filter(m => m.direction === 'out').length}</div>
          <div className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>Sent</div>
        </div>
        <div className="w-px h-6" style={{ background: 'var(--border-subtle)' }}/>
        <div className="text-center">
          <div className="text-[14px] font-semibold" style={{ color: '#10b981' }}>{connectedPlatforms.length}</div>
          <div className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>Platforms</div>
        </div>
      </div>

      {/* Live message feed */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>
              AI is monitoring your platforms...
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>
              Messages will appear here in real-time
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const platform = PLATFORMS.find(p => p.id === msg.platform);
            return (
              <div
                key={msg.id}
                className="flex items-start gap-2 px-3 py-2 rounded-lg"
                style={{
                  background: msg.direction === 'out' ? 'rgba(78, 170, 220,0.06)' : 'var(--surface-2)',
                  border: `1px solid ${msg.direction === 'out' ? 'rgba(78, 170, 220,0.15)' : 'var(--border-subtle)'}`,
                }}
              >
                <div className="shrink-0 mt-0.5" style={{ color: platform?.darkColor || 'var(--text-ghost)' }}>
                  {platform?.icon || <span className="text-[10px]">?</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-medium" style={{ color: msg.direction === 'out' ? 'var(--teal)' : 'var(--text-muted)' }}>
                      {msg.direction === 'out' ? 'AI sent' : 'Received'}
                    </span>
                    <span className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>{msg.time}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{msg.text}</p>
                </div>
                {msg.direction === 'out' && (
                  <div className="shrink-0 mt-1">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* [2026-09-13] Même compositeur que sur l'écran de connexion. */}
      {composer}

      {/* Bottom: 8 brains indicator */}
      <div className="px-4 py-2.5 flex items-center gap-1" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
        <div className="flex items-center gap-0.5 mr-2">
          {BRAIN_STAGES.map((b, i) => (
            <div key={i} className="w-3 h-3 rounded flex items-center justify-center" title={b.label} style={{ fontSize: 8 }}>
              {b.icon}
            </div>
          ))}
        </div>
        <span className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>8 brains verifying every message</span>
      </div>
    </div>
  );
}
