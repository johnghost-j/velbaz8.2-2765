// ─── TeamContoation — carte « Équipe IA au travail » dans le chat ──────────
// Affiche en direct les échanges entre agents pendant un travail d'équipe :
//   ▶ [DEMANDE] Coordinateur → Recherche : analyse le marché…
//   ✓ [RÉPONSE] Recherche → Marketing : voici mes conclusions clés…
// Statuts lisibles SANS couleur (accessibilité protanopie) : étiquette texte
// [DEMANDE]/[RÉPONSE]/[CRITIQUE]/[VALIDÉ]/[EN COURS]/[TERMINÉ]/[ERREUR] + ▶ ✓ ✗.

import { useState } from 'react';

export interface TeamMsg {
  id: string;
  taskId: string;
  from: string;
  to: string;
  type: string;
  label: string;
  symbol: string;
  content: string;
  ts: number;
}

const AGENT_ICONS: Record<string, string> = {
  'Coordinateur': '🧭',
  'Recherche': '🔍',
  'Marketing': '📣',
  'Finance': '💰',
  'Juridique': '⚖️',
  'Contenu': '✍️',
  'Branding': '🎨',
  "Plan d'affaires": '📊',
  'Équipe': '👥',
  'Utilisateur': '👤',
};

function agentIcon(name: string): string {
  return AGENT_ICONS[name] || '🤖';
}

function timeStr(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export default function TeamContoation({ msgs, live }: { msgs: TeamMsg[]; live?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!msgs || msgs.length === 0) return null;

  const agents = [...new Set(msgs.flatMap(m => [m.from, m.to]))].filter(a => a !== 'Équipe' && a !== 'Utilisateur');
  const isDone = msgs.some(m => m.type === 'synthese');

  return (
    <div style={{
      border: '1px solid var(--border, #2a2a3a)',
      borderRadius: 12,
      padding: '10px 14px',
      margin: '8px 0',
      background: 'var(--card, rgba(255,255,255,0.03))',
      fontSize: 13,
    }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', textAlign: 'left' }}
        aria-expanded={!collapsed}
      >
        <span style={{ fontSize: 16 }}>👥</span>
        <strong>
          AI Team at work — {agents.length} agent{agents.length > 1 ? 's' : ''}
          {' '}{isDone ? '✓ [TERMINÉ]' : live ? '▶ [EN COURS]' : ''}
        </strong>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{collapsed ? `▸ ${msgs.length} exchanges` : '▾ collapse'}</span>
      </button>

      {!collapsed && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
          {msgs.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.45 }}>
              <span style={{ flexShrink: 0 }} aria-hidden>{m.symbol}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'baseline' }}>
                  <span>{m.label}</span>
                  <span>{agentIcon(m.from)} {m.from}</span>
                  <span aria-label="to">→</span>
                  <span>{agentIcon(m.to)} {m.to}</span>
                  <span style={{ opacity: 0.55, fontWeight: 400, fontSize: 11 }}>{timeStr(m.ts)}</span>
                </div>
                <div style={{ opacity: 0.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content}
                </div>
              </div>
            </div>
          ))}
          {live && !isDone && (
            <div style={{ opacity: 0.7 }}>▶ [IN PROGRESS] The team is working…</div>
          )}
        </div>
      )}
    </div>
  );
}
