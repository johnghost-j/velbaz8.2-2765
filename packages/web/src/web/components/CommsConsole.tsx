/**
 * CONSOLE COMMUNICATION / PUB / MARKETING
 * ---------------------------------------
 * Popup au visuel identique au terminal admin. L'admin y envoie des messages
 * et le système lui répond avec ce qu'il produirait en vrai.
 *
 * Deux modes :
 *   • direct (défaut) — exactement ce que fait la PRODUCTION : une seule
 *     réponse, la meilleure, du premier coup.
 *   • train           — 3 pistes + un juge, uniquement pour voir le
 *     raisonnement et faire progresser l'IA. Jamais utilisé pour répondre.
 *
 * Rien n'est publié ni envoyé : simulation pure.
 */

import { useEffect, useRef, useState } from 'react';
import { getAuthToken } from '../lib/token';

type LineType = 'text' | 'error' | 'success' | 'info' | 'table' | 'prompt' | 'best';

interface Line {
  type: LineType;
  content: string;
}

const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

const TASK_OF_CMD: Record<string, string> = {
  reply: 'reply',
  ad: 'ad',
  post: 'post',
  email: 'outreach',
  when: 'schedule',
};

function api(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(`/api/admin/comms${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
    return body;
  });
}

/** Découpe un texte en lignes affichables (le terminal est en white-space: pre). */
function wrap(text: string, width = 92): string[] {
  const out: string[] = [];
  for (const raw of String(text).split('\n')) {
    if (raw.length <= width) {
      out.push(raw);
      continue;
    }
    let line = '';
    for (const word of raw.split(' ')) {
      if ((line + word).length > width) {
        out.push(line.trimEnd());
        line = '';
      }
      line += word + ' ';
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

const BANNER: Line[] = [
  { type: 'info', content: '' },
  { type: 'info', content: '  VELBAZ · CONSOLE COMMUNICATION / PUB / MARKETING' },
  { type: 'table', content: '  ─────────────────────────────────────────────────' },
  { type: 'table', content: "  Simulation pure : rien n'est publié ni envoyé." },
  { type: 'table', content: '  Tape "help" pour la liste des commandes.' },
  { type: 'text', content: '' },
];


const HELP: Line[] = [
  { type: 'info', content: 'ENVOYER UNE DEMANDE AU SYSTÈME' },
  { type: 'table', content: '  reply <message>    un message reçu (DM, commentaire, mention)' },
  { type: 'table', content: '  ad <brief>         une idée / créa publicitaire' },
  { type: 'table', content: '  post <brief>       un post organique' },
  { type: 'table', content: '  email <brief>      un email de prospection' },
  { type: 'table', content: '  when <brief>       le meilleur moment de publication' },
  { type: 'text', content: '' },
  { type: 'info', content: 'CONTEXTE' },
  { type: 'table', content: '  context <texte>    décrit l\'entreprise/produit (réutilisé à chaque demande)' },
  { type: 'table', content: '  context            affiche le contexte courant' },
  { type: 'table', content: '  context clear      efface le contexte' },
  { type: 'text', content: '' },
  { type: 'info', content: 'ENTRAÎNER L\'IA' },
  { type: 'table', content: '  score <1-10>       note la dernière réponse' },
  { type: 'table', content: '  fix <correction>   corrige-la par écrit (l\'IA en tire des règles)' },
  { type: 'table', content: '  score 4 <texte>    note + correction en une fois' },
  { type: 'table', content: '  playbook [tâche]   les règles apprises' },
  { type: 'table', content: '  forget <id>        supprime une règle apprise' },
  { type: 'table', content: '  stats              progression de l\'entraînement' },
  { type: 'table', content: '  examples [tâche]   historique des tests' },
  { type: 'text', content: '' },
  { type: 'info', content: 'MODE' },
  { type: 'table', content: '  mode               affiche le mode courant' },
  { type: 'table', content: '  mode direct        comme la prod : UNE réponse, la meilleure (défaut)' },
  { type: 'table', content: '  mode train         3 pistes + le juge, pour voir le raisonnement' },
  { type: 'text', content: '' },
  { type: 'table', content: '  clear · exit' },
];

const CMD_NAMES = ['help', 'reply', 'ad', 'post', 'email', 'when', 'context', 'score', 'fix',
  'playbook', 'forget', 'stats', 'examples', 'mode', 'clear', 'exit'];

export default function CommsConsole({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState<Line[]>(BANNER);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [context, setContext] = useState('');
  const [mode, setMode] = useState<'direct' | 'train'>('direct');
  const [lastExampleId, setLastExampleId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history]);
  useEffect(() => { inputRef.current?.focus(); }, [running]);

  const push = (lines: Line[]) => setHistory(h => [...h, ...lines]);

  const suggestions = (() => {
    const p = input.trim().toLowerCase();
    if (!p || p.includes(' ') || running) return [];
    const m = CMD_NAMES.filter(n => n.startsWith(p));
    return m.length === 1 && m[0] === p ? [] : m.slice(0, 8);
  })();

  // ── Rendu d'un résultat du moteur ─────────────────────────────────────────
  function renderRun(d: any): Line[] {
    const out: Line[] = [];
    const s = d.study || {};

    out.push({ type: 'info', content: '── ÉTUDE DU MESSAGE ' + '─'.repeat(40) });
    const field = (label: string, v: unknown) => {
      if (!v) return;
      const val = Array.isArray(v) ? v.join(' · ') : String(v);
      wrap(`${label.padEnd(11)} ${val}`, 90).forEach((l, i) =>
        out.push({ type: 'table', content: (i ? '            ' : '  ') + l.replace(/^ {2}/, '') }));
    };
    field('intention', s.intention);
    field('émotion', s.emotion);
    field('urgence', s.urgence);
    field('enjeu', s.enjeu);
    field('objection', s.objection);
    field('cible', s.cible);
    field('objectif', s.objectif);
    field('risques', s.risques);
    if (!Object.keys(s).length) out.push({ type: 'table', content: '  (étude indisponible)' });
    out.push({ type: 'text', content: '' });

    if (d.mode === 'train') {
      out.push({ type: 'info', content: '── PISTES ÉVALUÉES (entraînement seulement) ' + '─'.repeat(16) });
      (d.variants || []).forEach((v: any, i: number) => {
        const isBest = d.best && v.content === d.best.content;
        out.push({
          type: isBest ? 'success' : 'text',
          content: `${isBest ? '▶' : ' '} [${i}] ${v.angle}${v.score ? `  —  ${v.score}/10` : ''}`,
        });
        wrap(v.content, 88).forEach(l => out.push({ type: isBest ? 'best' : 'text', content: '     ' + l }));
        if (v.why) wrap(v.why, 84).forEach(l => out.push({ type: 'table', content: '     ↳ ' + l }));
        out.push({ type: 'text', content: '' });
      });
      if (d.verdict) {
        out.push({ type: 'info', content: '── VERDICT DU JUGE ' + '─'.repeat(41) });
        wrap(d.verdict, 90).forEach(l => out.push({ type: 'table', content: '  ' + l }));
        out.push({ type: 'text', content: '' });
      }
    } else {
      out.push({ type: 'info', content: '── RÉPONSE (ce que la prod enverrait) ' + '─'.repeat(22) });
      wrap(d.best?.content || '(vide)', 88).forEach(l => out.push({ type: 'best', content: '  ' + l }));
      out.push({ type: 'text', content: '' });
    }

    const meta = [
      `${d.durationMs} ms`,
      `langue ${d.lang}`,
      d.learned ? 'règles apprises appliquées' : 'aucune règle apprise pour l\'instant',
      ...(d.selfScore ? [`auto-note ${d.selfScore}/10`] : []),
    ].join('  ·  ');
    out.push({ type: 'table', content: '  ' + meta });
    out.push({ type: 'info', content: '  Note-la : score 8   ou corrige : fix <ce qu\'il fallait faire>' });
    return out;
  }

  // ── Exécution ─────────────────────────────────────────────────────────────
  const exec = async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    push([{ type: 'prompt', content: `❯ ${line}` }]);
    setCmdHistory(h => [line, ...h].slice(0, 100));
    setHistoryIdx(-1);
    setInput('');

    const sp = line.indexOf(' ');
    const cmd = (sp === -1 ? line : line.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? '' : line.slice(sp + 1).trim();

    setRunning(true);
    try {
      if (cmd === 'help' || cmd === '?') { push(HELP); return; }
      if (cmd === 'clear') { setHistory(BANNER); return; }
      if (cmd === 'exit' || cmd === 'quit') { onClose(); return; }

      if (cmd === 'mode') {
        if (!rest) { push([{ type: 'info', content: `mode courant : ${mode}` }]); return; }
        if (rest === 'direct' || rest === 'train') {
          setMode(rest);
          push([{
            type: 'success',
            content: rest === 'direct'
              ? 'mode direct — une seule réponse, la meilleure, comme en production.'
              : 'mode train — 3 pistes + juge. Sert à améliorer l\'IA, pas à répondre en vrai.',
          }]);
        } else push([{ type: 'error', content: 'mode direct | mode train' }]);
        return;
      }

      if (cmd === 'context') {
        if (!rest) {
          push([{ type: context ? 'table' : 'info', content: context ? `contexte : ${context}` : 'aucun contexte défini' }]);
        } else if (rest === 'clear') {
          setContext('');
          push([{ type: 'success', content: 'contexte effacé' }]);
        } else {
          setContext(rest);
          push([{ type: 'success', content: 'contexte enregistré — il sera joint à chaque demande' }]);
        }
        return;
      }

      if (TASK_OF_CMD[cmd]) {
        if (!rest) { push([{ type: 'error', content: `usage : ${cmd} <texte>` }]); return; }
        push([{ type: 'table', content: mode === 'train' ? '  … étude, 3 pistes, jugement' : '  … étude puis rédaction' }]);
        const d = await api('/run', {
          method: 'POST',
          body: JSON.stringify({ task: TASK_OF_CMD[cmd], input: rest, context: context || undefined, mode }),
        });
        setLastExampleId(d.exampleId);
        push(renderRun(d));
        return;
      }

      if (cmd === 'score' || cmd === 'fix') {
        let score: number | null = null;
        let correction = '';
        if (cmd === 'score') {
          const m = rest.match(/^(\d+)\s*(.*)$/s);
          if (!m) { push([{ type: 'error', content: 'usage : score <1-10> [correction]' }]); return; }
          score = Number(m[1]);
          correction = m[2].trim();
        } else {
          if (!rest) { push([{ type: 'error', content: 'usage : fix <ce qu\'il fallait faire>' }]); return; }
          correction = rest;
          score = 4; // une correction écrite = la réponse ne convenait pas
        }
        const d = await api('/rate', {
          method: 'POST',
          body: JSON.stringify({ exampleId: lastExampleId || undefined, score, correction: correction || undefined }),
        });
        if (!d.lessons?.length) {
          push([{ type: 'success', content: `note ${score}/10 enregistrée (rien de nouveau à en tirer)` }]);
        } else {
          push([
            { type: 'success', content: `note ${score}/10 enregistrée — règles apprises :` },
            ...d.lessons.map((l: string) => ({ type: 'info' as LineType, content: '  ' + l })),
            { type: 'table', content: '  Elles s\'appliqueront dès la prochaine génération, y compris en production.' },
          ]);
        }
        return;
      }

      if (cmd === 'playbook') {
        const d = await api(`/playbook${rest ? `?task=${encodeURIComponent(rest)}` : ''}`);
        if (!d.rules?.length) { push([{ type: 'info', content: 'aucune règle apprise pour l\'instant' }]); return; }
        push([
          { type: 'info', content: 'TÂCHE      POIDS  RÈGLE' },
          ...d.rules.map((r: any) => ({
            type: (r.kind === 'dont' ? 'error' : 'table') as LineType,
            content: `${String(r.task).padEnd(10)} ${String(r.weight).padStart(5)}  ${r.kind === 'dont' ? '✗' : '✓'} ${r.rule}`,
          })),
          { type: 'table', content: '' },
          { type: 'table', content: d.rules.map((r: any) => `${r.id.slice(0, 8)} ${r.rule.slice(0, 40)}`).join('\n') },
        ]);
        return;
      }

      if (cmd === 'forget') {
        if (!rest) { push([{ type: 'error', content: 'usage : forget <id de règle>' }]); return; }
        const full = (await api('/playbook')).rules.find((r: any) => r.id === rest || r.id.startsWith(rest));
        if (!full) { push([{ type: 'error', content: 'règle introuvable' }]); return; }
        await api(`/playbook/${full.id}`, { method: 'DELETE' });
        push([{ type: 'success', content: `oubliée : ${full.rule}` }]);
        return;
      }

      if (cmd === 'stats') {
        const d = await api('/stats');
        const lines: Line[] = [{ type: 'info', content: 'TÂCHE       TESTS  NOTÉS  MOYENNE  AUTO-NOTE' }];
        for (const r of d.byTask || []) {
          lines.push({
            type: 'table',
            content: `${String(r.task).padEnd(11)} ${String(r.tests).padStart(5)}  ${String(r.notes).padStart(5)}  ${String(r.moyenne ?? '—').padStart(7)}  ${String(r.auto ?? '—').padStart(9)}`,
          });
        }
        lines.push({ type: 'text', content: '' });
        lines.push({ type: 'info', content: 'PROGRESSION' });
        lines.push({ type: 'table', content: `  10 premières notes : ${d.moyenne10Premiers ?? '—'}` });
        lines.push({ type: 'table', content: `  10 dernières notes : ${d.moyenne10Derniers ?? '—'}` });
        if (d.rules?.length) {
          lines.push({ type: 'text', content: '' });
          lines.push({ type: 'info', content: 'RÈGLES APPRISES' });
          for (const r of d.rules) {
            lines.push({ type: 'table', content: `  ${String(r.task).padEnd(10)} ${r.kind === 'dont' ? '✗' : '✓'} ${r.n} règle(s), poids ${r.poids}` });
          }
        }
        push(lines);
        return;
      }

      if (cmd === 'examples') {
        const d = await api(`/examples${rest ? `?task=${encodeURIComponent(rest)}` : ''}`);
        if (!d.examples?.length) { push([{ type: 'info', content: 'aucun test enregistré' }]); return; }
        push([
          { type: 'info', content: 'ID        TÂCHE      NOTE  DEMANDE' },
          ...d.examples.map((e: any) => ({
            type: 'table' as LineType,
            content: `${String(e.id).slice(0, 8)}  ${String(e.task).padEnd(9)}  ${String(e.score ?? '—').padStart(4)}  ${String(e.input).replace(/\n/g, ' ').slice(0, 58)}`,
          })),
        ]);
        return;
      }

      push([{ type: 'error', content: `commande inconnue : ${cmd} — tape "help"` }]);
    } catch (e: any) {
      push([{ type: 'error', content: `✗ ${e?.message || 'erreur'}` }]);
    } finally {
      setRunning(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); exec(input); return; }
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Tab' && suggestions.length) { e.preventDefault(); setInput(suggestions[0] + ' '); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = Math.min(historyIdx + 1, cmdHistory.length - 1);
      if (i >= 0) { setHistoryIdx(i); setInput(cmdHistory[i]); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = historyIdx - 1;
      if (i < 0) { setHistoryIdx(-1); setInput(''); } else { setHistoryIdx(i); setInput(cmdHistory[i]); }
    }
  };

  const color = (t: LineType) => {
    switch (t) {
      case 'error': return '#ff4d4f';
      case 'success': return '#52c41a';
      case 'info': return '#b37feb';
      case 'table': return '#8c8c8c';
      case 'prompt': return '#52c41a';
      case 'best': return '#e6e6e6';
      default: return '#999';
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, padding: 20,
      }}
    >
      <div
        onClick={(e) => { e.stopPropagation(); inputRef.current?.focus(); }}
        style={{
          width: 'min(1000px, 96vw)', height: 'min(680px, 88vh)',
          background: '#0a0a0f', border: '1px solid #222', borderRadius: 8,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Barre de titre */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', background: '#0d0d14', borderBottom: '1px solid #1a1a2e', flexShrink: 0,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
          <span style={{ color: '#8c8c8c', fontFamily: MONO, fontSize: 11, marginLeft: 6, letterSpacing: 0.3 }}>
            comms — communication / pub / marketing
          </span>
          <span style={{
            marginLeft: 'auto', fontFamily: MONO, fontSize: 10, letterSpacing: 0.3,
            color: mode === 'train' ? '#b37feb' : '#52c41a',
            border: `1px solid ${mode === 'train' ? '#b37feb' : '#52c41a'}`,
            borderRadius: 4, padding: '1px 7px',
          }}>
            {mode === 'train' ? 'ENTRAÎNEMENT' : 'PRODUCTION'}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}
          >
            ✕
          </button>
        </div>

        {/* Sortie */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {history.map((l, i) => (
            <div key={i} style={{
              padding: '1px 8px',
              color: color(l.type),
              fontFamily: MONO,
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              letterSpacing: 0.3,
              fontWeight: l.type === 'prompt' ? 700 : 400,
            }}>
              {l.content}
            </div>
          ))}
          {running && (
            <div style={{ padding: '1px 8px', color: '#52c41a', fontFamily: MONO, fontSize: 12, letterSpacing: 0.3 }}>
              …
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 4, padding: '5px 8px',
            borderTop: '1px solid #1a1a2e', background: '#0d0d14', flexShrink: 0,
          }}>
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => setInput(s + ' ')}
                style={{
                  background: '#111118', border: '1px solid #222', borderRadius: 4,
                  padding: '3px 10px', color: '#888', fontFamily: MONO, fontSize: 11, cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
            <span style={{ color: '#444', fontSize: 10, alignSelf: 'center', marginLeft: 4 }}>Tab pour compléter</span>
          </div>
        )}

        {/* Invite */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '6px 8px',
          borderTop: '1px solid #222', background: '#0a0a0f', flexShrink: 0,
        }}>
          <span style={{ color: '#52c41a', marginRight: 6, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>❯</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={running}
            placeholder={running ? 'Le système réfléchit…' : 'reply Bonjour, ma commande a du retard…'}
            style={{
              flex: 1, background: 'transparent', border: 'none', color: '#ddd',
              fontFamily: MONO, fontSize: 12, outline: 'none', caretColor: '#52c41a', letterSpacing: 0.3,
            }}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
