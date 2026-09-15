/**
 * SocialSandboxOverlay — Admin-only fullscreen test panel
 * Left: company description textarea (for AI context)
 * Right: platform connection rectangle
 * Creates a temporary sandbox company, no real project needed.
 */

import { useState, useEffect, useRef } from 'react';
import { getAuthToken } from '../lib/token';
import { SocialRightPane } from './SocialRightPane';
import { createPortal } from 'react-dom';

function getToken() {
  return getAuthToken();
}

/** false = plus de rectangle de fond par ligne : juste une pastille en
 *  demi-cercle collée à gauche du grand rectangle. true = ancien rendu. */
const SOCIAL_ROW_CARD = false;

/** false = aucune pastille : juste le logo du réseau à gauche, et une ligne
 *  fine qui sépare chaque réseau. true = ancien rendu avec pastille. */
const SOCIAL_ROW_PASTILLE = false;

/** false = pas de nom/description de réseau : juste le logo, avec une seule
 *  ligne VERTICALE à sa droite (aucune ligne horizontale). true = ancien rendu. */
const SOCIAL_ROW_NAME = false;

/** true = un seul réseau sélectionnable à la fois (radio). */
const SOCIAL_SINGLE_SELECT = true;

/** true = colonne de logos | ligne verticale | panneau de droite. */
const SOCIAL_SPLIT_VIEW = true;

/**
 * true = dès qu'un réseau social est utilisé, le rectangle s'ouvre au MAXIMUM
 * (presque tout l'écran) au lieu de rester à 1100×700 : le fil X (1258 px)
 * s'affiche alors à sa taille réelle, sans réduction d'échelle.
 * Les anciennes dimensions restent en place dans la branche `false`.
 */
const SOCIAL_MAX_OPEN = true;

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
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.373-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
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
  open: boolean;
  onClose: () => void;
}

type Phase = 'setup' | 'connecting' | 'learning' | 'active';

export function SocialSandboxOverlay({ open, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('setup');
  const [description, setDescription] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Connection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Learning state
  const [brainIndex, setBrainIndex] = useState(0);

  // Active state
  const [lastPost, setLastPost] = useState<{ content: string; platform: string; url?: string; published: boolean; error?: string; fixUrl?: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [messages, setMessages] = useState<Array<{ id: string; platform: string; direction: 'in' | 'out'; text: string; time: string }>>([]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [open]);

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

  // Brain animation
  useEffect(() => {
    if (phase !== 'learning') return;
    const iv = setInterval(() => {
      setBrainIndex(prev => {
        if (prev >= BRAIN_STAGES.length - 1) {
          setTimeout(() => setPhase('active'), 800);
          clearInterval(iv);
          return prev;
        }
        return prev + 1;
      });
    }, 2200);
    return () => clearInterval(iv);
  }, [phase]);

  // Poll messages in active phase
  useEffect(() => {
    if (phase !== 'active' || !sandboxId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/companies/${sandboxId}/social/messages`);
        if (cancelled) return;
        const data = await res.json() as any;
        if (data.messages) setMessages(data.messages.slice(0, 20));
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [phase, sandboxId]);

  const createSandbox = async () => {
    if (!description.trim()) return;
    setCreating(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/sandbox-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: companyName.trim() || 'Sandbox Test',
          idea: description.trim(),
        }),
      });
      const data = await res.json() as any;
      if (data.id) {
        setSandboxId(data.id);
        setPhase('connecting');
      }
    } catch (e: any) {
      console.error('[sandbox] Failed to create:', e);
    }
    setCreating(false);
  };

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

  const startConnecting = async () => {
    if (selected.size === 0 || !sandboxId) return;
    // Ne jamais relancer l'OAuth pour un compte déjà lié : X renvoie
    // "Something went wrong" quand on ré-autorise une session déjà active.
    const toConnect = Array.from(selected).filter(id => !connected.has(id));
    if (toConnect.length === 0) {
      setConnectedPlatforms(Array.from(connected));
      setPhase('active');
      return;
    }
    const successfullyConnected: string[] = [];

    for (const platformId of toConnect) {
      setConnecting(platformId);
      try {
        const tok = getToken();
        const res = await fetch(`/api/companies/${sandboxId}/social/connect`, {
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
          // Demo mode — instant connection
          successfullyConnected.push(platformId);
          setConnected(prev => new Set([...prev, platformId]));
        } else if (data.authUrl) {
          // Real OAuth
          const w = window.open(data.authUrl, `oauth_${platformId}`, 'width=600,height=700,left=200,top=100');
          await new Promise<void>((resolve) => {
            const handleMessage = (event: MessageEvent) => {
              if (event.data?.type === 'oauth-success' && event.data?.platform === platformId) {
                window.removeEventListener('message', handleMessage);
                clearInterval(interval);
                resolve();
              }
            };
            window.addEventListener('message', handleMessage);
            const interval = setInterval(() => {
              if (!w || w.closed) {
                clearInterval(interval);
                window.removeEventListener('message', handleMessage);
                resolve();
              }
            }, 500);
            setTimeout(() => { clearInterval(interval); window.removeEventListener('message', handleMessage); resolve(); }, 120000);
          });
          successfullyConnected.push(platformId);
          setConnected(prev => new Set([...prev, platformId]));
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [platformId]: err.message }));
      }
    }
    setConnecting(null);

    if (successfullyConnected.length === 0) return;
    setConnectedPlatforms(successfullyConnected);

    // Trigger AI learning
    setPhase('learning');
    try {
      await fetch(`/api/companies/${sandboxId}/social/learn-style`, { method: 'POST' });
      for (const pid of successfullyConnected) {
        try {
          const genRes = await fetch(`/api/companies/${sandboxId}/social/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: pid }),
          });
          const genData = await genRes.json() as any;
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
            setErrors(prev => ({ ...prev, [pid]: genData.publishError || genData.error || 'Publication refusée par la plateforme' }));
          }
        } catch (e) {
          console.error(`[sandbox] Generate failed for ${pid}:`, e);
        }
      }
    } catch (e) {
      console.error('[sandbox] Pipeline error:', e);
    }
  };

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => {
      onClose();
      // Reset state
      setPhase('setup');
      setDescription('');
      setCompanyName('');
      setSandboxId(null);
      setSelected(new Set());
      setConnected(new Set());
      setConnectedPlatforms([]);
      setErrors({});
      setBrainIndex(0);
      setLastPost(null);
      setMessages([]);
    }, 300);
  };

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: visible ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(12px)' : 'blur(0px)',
        transition: 'background 400ms ease, backdrop-filter 400ms ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.96)',
          /* Réseau social en cours d'utilisation → rectangle ouvert au maximum. */
          width: SOCIAL_MAX_OPEN && activeId ? '99vw' : '90vw',
          maxWidth: SOCIAL_MAX_OPEN && activeId ? 'none' : 1100,
          height: SOCIAL_MAX_OPEN && activeId ? '98vh' : '80vh',
          maxHeight: SOCIAL_MAX_OPEN && activeId ? 'none' : 700,
          transition: 'width 320ms cubic-bezier(0.16,1,0.3,1), height 320ms cubic-bezier(0.16,1,0.3,1), max-width 320ms ease, max-height 320ms ease, opacity 400ms ease, transform 400ms cubic-bezier(0.16, 1, 0.3, 1)',
          background: '#0a0a0a',
          border: '1px solid #1a1a1a',
          borderRadius: 20,
          overflow: 'hidden',
          display: 'flex',
          boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* ─── LEFT SIDE: Company Description ─── */}
        <div style={{
          flex: phase === 'setup' ? '1 1 50%' : '0 0 340px',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #1a1a1a',
          transition: 'flex 0.5s ease',
        }}>
          {/* Header */}
          <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid #141414' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: '#2a2a2a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#E8E8E8', fontSize: 16,
              }}>
                ⚡
              </div>
              <div>
                <div style={{ color: '#e5e5e5', fontSize: 15, fontWeight: 600 }}>Social Sandbox</div>
                <div style={{ color: '#555', fontSize: 11 }}>Test platform connections without a project</div>
              </div>
            </div>
            {/* Close button */}
            <button onClick={handleClose} style={{
              position: 'absolute', top: 16, right: 16,
              width: 32, height: 32, borderRadius: 8,
              background: '#141414', border: '1px solid #222',
              color: '#666', fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
            <div>
              <label style={{ color: '#888', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. TechFlow AI"
                disabled={phase !== 'setup'}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  background: '#111', border: '1px solid #222', color: '#e5e5e5',
                  fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  opacity: phase !== 'setup' ? 0.6 : 1,
                }}
              />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label style={{ color: '#888', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                Company Description
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe your company so the AI knows what to talk about when creating posts and engaging with people...

e.g. We're a B2B SaaS that helps small businesses automate their social media marketing with AI. We target European SMBs, our tone is professional but friendly, and we focus on time-saving and ROI."
                disabled={phase !== 'setup'}
                style={{
                  flex: 1, width: '100%', padding: '12px 14px', borderRadius: 10,
                  background: '#111', border: '1px solid #222', color: '#e5e5e5',
                  fontSize: 13, lineHeight: 1.6, outline: 'none', resize: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box', minHeight: 150,
                  opacity: phase !== 'setup' ? 0.6 : 1,
                }}
              />
            </div>

            {phase === 'setup' && (
              <button
                onClick={createSandbox}
                disabled={!description.trim() || creating}
                style={{
                  padding: '12px 20px', borderRadius: 12,
                  background: description.trim() ? '#E8E8E8' : '#1a1a1a',
                  color: description.trim() ? '#1A1A1A' : '#444',
                  fontSize: 13, fontWeight: 600, border: 'none', cursor: description.trim() ? 'pointer' : 'default',
                  transition: 'all 0.3s ease',
                }}
              >
                {creating ? 'Creating sandbox...' : 'Create Sandbox & Connect'}
              </button>
            )}

            {/* Status info when past setup */}
            {phase !== 'setup' && sandboxId && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: '#0d1f1d', border: '1px solid #1a3a35' }}>
                <div style={{ color: '#4EAADC', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Sandbox Active</div>
                <div style={{ color: '#5a8a84', fontSize: 10 }}>ID: {sandboxId.slice(0, 12)}...</div>
                {connectedPlatforms.length > 0 && (
                  <div style={{ color: '#5a8a84', fontSize: 10, marginTop: 2 }}>
                    Connected: {connectedPlatforms.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Generate post button in active phase */}
            {phase === 'active' && sandboxId && connectedPlatforms.length > 0 && (
              <button
                onClick={async () => {
                  if (generating) return;
                  setGenerating(true);
                  try {
                    for (const pid of connectedPlatforms) {
                      const res = await fetch(`/api/companies/${sandboxId}/social/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ platform: pid }),
                      });
                      const data = await res.json() as any;
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
                  } catch (e) { console.error(e); }
                  setGenerating(false);
                }}
                disabled={generating}
                style={{
                  padding: '10px 16px', borderRadius: 10,
                  background: generating ? '#1a1a1a' : '#E8E8E8',
                  color: generating ? '#555' : '#1A1A1A',
                  fontSize: 12, fontWeight: 600, border: 'none', cursor: generating ? 'default' : 'pointer',
                }}
              >
                {generating ? 'Generating...' : 'Generate & Post Now'}
              </button>
            )}
          </div>
        </div>

        {/* ─── RIGHT SIDE: Platform Connections ─── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#080808' }}>
          {phase === 'setup' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: '#111', border: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#333' }}>
                🔌
              </div>
              <div style={{ color: '#444', fontSize: 14, fontWeight: 500, textAlign: 'center' }}>
                Enter your company description first
              </div>
              <div style={{ color: '#333', fontSize: 12, textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
                The AI needs context about your business to create relevant content for your platforms
              </div>
            </div>
          )}

          {/* ─── CONNECTING PHASE ─── */}
          {(phase === 'connecting') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #141414' }}>
                <div style={{ color: '#e5e5e5', fontSize: 14, fontWeight: 600 }}>Connect Platforms</div>
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>
                  Select where AI should communicate for "{companyName || 'your company'}"
                </div>
              </div>
              {SOCIAL_SPLIT_VIEW ? (
                /* Colonne de logos | UNE ligne verticale continue | panneau de droite */
                <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 12px 16px 20px', flexShrink: 0 }}>
                    {PLATFORMS.map((p) => {
                      const isSelected = selected.has(p.id);
                      const isConnecting2 = connecting === p.id;
                      const isConnected = connected.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => !isConnecting2 && togglePlatform(p.id)}
                          disabled={isConnecting2}
                          title={p.name}
                          style={{
                            width: 44, height: 44, borderRadius: 10, marginBottom: 6, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: p.darkColor, background: isSelected ? `${p.color}22` : `${p.color}0d`,
                            border: `1.5px solid ${isSelected ? p.darkColor : 'transparent'}`,
                            opacity: isSelected || isConnected ? 1 : 0.45,
                            cursor: isConnecting2 ? 'default' : 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {p.icon}
                        </button>
                      );
                    })}
                  </div>
                  {/* La seule ligne : verticale, continue */}
                  <div style={{ width: 1, alignSelf: 'stretch', background: '#1a1a1a', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <SocialRightPane
                      platform={PLATFORMS.find(p => selected.has(p.id)) || null}
                      companyId={sandboxId || 'sandbox'}
                      isConnected={!!activeId && connected.has(activeId)}
                      isConnecting={!!activeId && connecting === activeId}
                      error={activeId ? errors[activeId] : undefined}
                      onConnect={startConnecting}
                    />
                  </div>
                </div>
              ) : (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: SOCIAL_ROW_CARD ? 10 : 0 }}>
                  {PLATFORMS.map((p, i) => {
                    const isSelected = selected.has(p.id);
                    const isConnecting2 = connecting === p.id;
                    const isConnected = connected.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => !isConnecting2 && togglePlatform(p.id)}
                        disabled={isConnecting2}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 14px', borderRadius: 12,
                          background: SOCIAL_ROW_CARD
                            ? (isConnected ? 'rgba(16,185,129,0.06)' : isSelected ? '#151515' : '#0e0e0e')
                            : 'transparent',
                          border: SOCIAL_ROW_CARD
                            ? `1.5px solid ${isConnected ? '#10b981' : isSelected ? '#666666' : '#1a1a1a'}`
                            : '1.5px solid transparent',
                          // Aucune ligne horizontale : la séparation est la ligne
                          // VERTICALE rendue à droite du logo (voir plus bas).
                          ...(SOCIAL_ROW_CARD ? {} : { borderRadius: 0 }),
                          cursor: isConnecting2 ? 'default' : 'pointer',
                          transition: 'all 0.2s ease',
                          textAlign: 'left',
                          color: 'inherit',
                          font: 'inherit',
                        }}
                      >
                        {/* Pastille (désactivée par SOCIAL_ROW_PASTILLE) : le logo
                            reste seul à gauche, une ligne sépare chaque réseau. */}
                        {!SOCIAL_ROW_PASTILLE ? null : isConnecting2 ? (
                          <div style={{
                            width: 16, height: 16, borderRadius: '50%',
                            border: `2px solid ${p.color}`, borderTopColor: 'transparent',
                            animation: 'spin 0.8s linear infinite',
                          }}/>
                        ) : isConnected ? (
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', background: '#10b981',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>
                          </div>
                        ) : SOCIAL_ROW_CARD ? (
                          <div style={{
                            width: 20, height: 20, borderRadius: 6,
                            background: isSelected ? '#E8E8E8' : 'transparent',
                            border: `2px solid ${isSelected ? '#E8E8E8' : '#333'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSelected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>}
                          </div>
                        ) : (
                          /* Demi-cercle collé au bord gauche du grand rectangle. */
                          <div style={{
                            width: 11, height: 26, flexShrink: 0, marginLeft: -14,
                            borderRadius: '0 999px 999px 0',
                            background: isSelected ? '#E8E8E8' : 'transparent',
                            border: `1.5px solid ${isSelected ? '#E8E8E8' : '#333'}`,
                            borderLeft: 'none',
                            transition: 'all 0.18s ease',
                          }}/>
                        )}
                        <div style={{
                          width: 36, height: 36, borderRadius: 8,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: p.darkColor, background: `${p.color}12`, flexShrink: 0,
                          opacity: SOCIAL_ROW_NAME || isSelected || isConnected ? 1 : 0.45,
                        }}>
                          {p.icon}
                        </div>
                        {/* Une seule ligne VERTICALE, à droite des logos : les lignes
                            se touchent (gap 0) donc elle est continue. */}
                        {!SOCIAL_ROW_NAME && (
                          <div style={{ width: 1, alignSelf: 'stretch', background: '#1a1a1a', flexShrink: 0 }}/>
                        )}
                        {SOCIAL_ROW_NAME ? (
                          <div style={{ flex: 1 }}>
                            <div style={{ color: '#e5e5e5', fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                            <div style={{ color: '#555', fontSize: 10 }}>{p.desc}</div>
                          </div>
                        ) : (
                          <div style={{ flex: 1 }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              )}
              <div style={{ padding: '14px 24px', borderTop: '1px solid #141414', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={startConnecting}
                  disabled={selected.size === 0}
                  style={{
                    padding: '10px 20px', borderRadius: 10,
                    background: selected.size > 0 ? '#E8E8E8' : '#1a1a1a',
                    color: selected.size > 0 ? '#1A1A1A' : '#444',
                    fontSize: 12, fontWeight: 600, border: 'none',
                    cursor: selected.size > 0 ? 'pointer' : 'default',
                  }}
                >
                  {selected.size > 0 ? `Connect ${selected.size} Platform${selected.size > 1 ? 's' : ''}` : 'Select platforms'}
                </button>
              </div>
            </div>
          )}

          {/* ─── LEARNING PHASE ─── */}
          {phase === 'learning' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(78, 170, 220,0.15), rgba(68,184,168,0.08))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, marginBottom: 16,
              }}>
                {BRAIN_STAGES[brainIndex]?.icon}
              </div>
              <div style={{ color: '#e5e5e5', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>AI is Learning</div>
              <div style={{ color: '#555', fontSize: 12, marginBottom: 24 }}>8 brains calibrating to your identity</div>

              <div style={{ width: '100%', maxWidth: 280, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {BRAIN_STAGES.map((stage, i) => {
                  const isDone = i < brainIndex;
                  const isCurrent = i === brainIndex;
                  return (
                    <div key={stage.label} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 8,
                      background: isCurrent ? '#111' : 'transparent',
                      opacity: i > brainIndex ? 0.3 : 1,
                      transition: 'all 0.4s ease',
                    }}>
                      <span style={{ fontSize: 14, width: 24, textAlign: 'center' }}>{stage.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: isDone ? '#10b981' : isCurrent ? '#e5e5e5' : '#555' }}>
                          {stage.label}
                        </div>
                        {isCurrent && <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>{stage.desc}</div>}
                      </div>
                      {isDone && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5"/></svg>}
                      {isCurrent && (
                        <div style={{
                          width: 12, height: 12, borderRadius: '50%',
                          border: '2px solid #4EAADC', borderTopColor: 'transparent',
                          animation: 'spin 0.8s linear infinite',
                        }}/>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── ACTIVE PHASE ─── */}
          {phase === 'active' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #141414', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', animation: 'pulse 2s infinite' }}/>
                <span style={{ color: '#e5e5e5', fontSize: 12, fontWeight: 500 }}>Social AI Active</span>
                <div style={{ flex: 1 }}/>
                <div style={{ display: 'flex', gap: 4 }}>
                  {connectedPlatforms.map(pid => {
                    const p = PLATFORMS.find(pp => pp.id === pid);
                    if (!p) return null;
                    return <div key={pid} style={{ width: 20, height: 20, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: p.darkColor, fontSize: 10 }}>{p.icon}</div>;
                  })}
                </div>
              </div>

              {/* Last post */}
              {lastPost && (
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #141414', background: 'rgba(78, 170, 220,0.03)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: lastPost.published ? '#10b981' : '#ef4444' }}/>
                    <span style={{ color: lastPost.published ? '#10b981' : '#ef4444', fontSize: 10, fontWeight: 500 }}>
                      {lastPost.published
                        ? `Publié sur ${lastPost.platform}`
                        : `NON publié sur ${lastPost.platform} — texte généré uniquement`}
                    </span>
                  </div>
                  <p style={{ color: '#999', fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                    {lastPost.content.slice(0, 200)}{lastPost.content.length > 200 ? '...' : ''}
                  </p>
                  {!lastPost.published && lastPost.error && (
                    <p style={{ color: '#ef4444', fontSize: 10, lineHeight: 1.4, margin: '4px 0 0' }}>{lastPost.error}</p>
                  )}
                  {!lastPost.published && lastPost.fixUrl && (
                    <a href={lastPost.fixUrl} target="_blank" rel="noopener" style={{ color: '#ef4444', fontSize: 10, marginTop: 2, display: 'inline-block', textDecoration: 'underline' }}>
                      Débloquer le compte →
                    </a>
                  )}
                  {lastPost.published && lastPost.url && lastPost.url !== 'https://demo.example.com' && (
                    <a href={lastPost.url} target="_blank" rel="noopener" style={{ color: '#4EAADC', fontSize: 10, marginTop: 4, display: 'inline-block' }}>Voir la publication →</a>
                  )}
                </div>
              )}

              {/* Stats */}
              <div style={{ padding: '10px 20px', display: 'flex', gap: 20, borderBottom: '1px solid #141414', background: '#0a0a0a' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#e5e5e5', fontSize: 14, fontWeight: 600 }}>{messages.filter(m => m.direction === 'in').length}</div>
                  <div style={{ color: '#444', fontSize: 9 }}>Received</div>
                </div>
                <div style={{ width: 1, height: 24, background: '#1a1a1a' }}/>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#4EAADC', fontSize: 14, fontWeight: 600 }}>{messages.filter(m => m.direction === 'out').length}</div>
                  <div style={{ color: '#444', fontSize: 9 }}>Sent</div>
                </div>
                <div style={{ width: 1, height: 24, background: '#1a1a1a' }}/>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#10b981', fontSize: 14, fontWeight: 600 }}>{connectedPlatforms.length}</div>
                  <div style={{ color: '#444', fontSize: 9 }}>Platforms</div>
                </div>
              </div>

              {/* Messages feed */}
              <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.4 }}>
                    <span style={{ fontSize: 24 }}>💬</span>
                    <p style={{ color: '#555', fontSize: 11, margin: 0 }}>AI is monitoring your platforms...</p>
                    <p style={{ color: '#444', fontSize: 10, margin: 0 }}>Messages will appear here in real-time</p>
                  </div>
                ) : (
                  messages.map(msg => {
                    const platform = PLATFORMS.find(p => p.id === msg.platform);
                    return (
                      <div key={msg.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 12px', borderRadius: 10,
                        background: msg.direction === 'out' ? 'rgba(78, 170, 220,0.05)' : '#0e0e0e',
                        border: `1px solid ${msg.direction === 'out' ? 'rgba(78, 170, 220,0.12)' : '#151515'}`,
                      }}>
                        <div style={{ flexShrink: 0, marginTop: 2, color: platform?.darkColor || '#555' }}>
                          {platform?.icon || <span style={{ fontSize: 10 }}>?</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 500, color: msg.direction === 'out' ? '#4EAADC' : '#777' }}>
                              {msg.direction === 'out' ? 'AI sent' : 'Received'}
                            </span>
                            <span style={{ fontSize: 9, color: '#444' }}>{msg.time}</span>
                          </div>
                          <p style={{ color: '#999', fontSize: 11, lineHeight: 1.4, margin: 0 }}>{msg.text}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom brains indicator */}
              <div style={{ padding: '10px 20px', borderTop: '1px solid #141414', display: 'flex', alignItems: 'center', gap: 4, background: '#0a0a0a' }}>
                {BRAIN_STAGES.map((b, i) => (
                  <span key={i} style={{ fontSize: 8 }} title={b.label}>{b.icon}</span>
                ))}
                <span style={{ color: '#444', fontSize: 9, marginLeft: 4 }}>8 brains verifying every message</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spin animation */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>,
    document.body
  );
}
