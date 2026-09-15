/**
 * Page de suivi client (publique) — /track
 *
 * Le client saisit sa référence (les 8 premiers caractères de son n° de commande)
 * + son e-mail. On affiche le statut, le n° de suivi et la chronologie.
 * Accessibilité : chaque étape est lisible par le TEXTE + un symbole (▶ ✓), pas
 * par la couleur seule.
 */

import { useState } from 'react';

interface TrackResult {
  ref: string;
  status: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  createdAt: string | number;
  timeline: { at: string; status: string; detail: string }[];
  items: { name: string; quantity: number }[];
}

function symbol(status: string): string {
  if (status.startsWith('[ERREUR')) return '✗';
  if (status === '[LIVRÉE]' || status === '[EXPÉDIÉE]' || status === '[ENVOYÉE FOURNISSEUR]') return '✓';
  return '▶';
}

const STEPS = ['[PAYÉE]', '[À EXPÉDIER]', '[EXPÉDIÉE]', '[LIVRÉE]'];
const STEP_LABEL: Record<string, string> = {
  '[PAYÉE]': 'Paid', '[À EXPÉDIER]': 'Preparing', '[EXPÉDIÉE]': 'Shipped', '[LIVRÉE]': 'Delivered',
};

export default function Track() {
  const [ref, setRef] = useState('');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/track', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: ref.trim(), email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data.order) setResult(data.order);
      else setError(data?.error || 'Order not found');
    } catch { setError('Network error, please try again'); }
    finally { setLoading(false); }
  }

  const currentIdx = result ? STEPS.indexOf(result.status) : -1;

  const input: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 10,
    border: '1px solid var(--border-subtle, #ddd)', background: 'var(--surface-1, #fff)', color: 'var(--text, #111)',
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px', background: 'var(--bg, #fafafa)' }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', color: 'var(--text, #111)' }}>Order tracking</h1>
        <p style={{ color: 'var(--text-dim, #666)', margin: '0 0 24px', fontSize: 14 }}>
          Enter your order reference and email to track your package.
        </p>

        <form onSubmit={search} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
          <input style={input} placeholder="Reference (e.g. A1B2C3D4)" value={ref} onChange={(e) => setRef(e.target.value)} required />
          <input style={input} type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit" disabled={loading} style={{
            padding: '12px 14px', fontSize: 15, fontWeight: 700, borderRadius: 10, cursor: 'pointer',
            border: 'none', background: 'var(--text, #111)', color: 'var(--bg, #fff)', opacity: loading ? 0.6 : 1,
          }}>
            {loading ? 'Searching…' : 'Track my order'}
          </button>
        </form>

        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border-subtle, #ddd)', background: 'var(--surface-2, #f2f2f2)', fontWeight: 600, color: 'var(--text, #111)' }}>
            ✗ {error}
          </div>
        )}

        {result && (
          <div style={{ border: '1px solid var(--border-subtle, #e2e2e2)', borderRadius: 14, padding: 24, background: 'var(--surface-1, #fff)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--text, #111)' }}>#{result.ref}</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text, #111)' }}>{symbol(result.status)} {result.status}</span>
            </div>

            {/* Barre d'étapes */}
            {currentIdx >= 0 && (
              <div style={{ display: 'flex', gap: 6, margin: '20px 0' }}>
                {STEPS.map((s, i) => (
                  <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ height: 6, borderRadius: 3, background: i <= currentIdx ? 'var(--text, #111)' : 'var(--border-subtle, #e2e2e2)' }} />
                    <div style={{ fontSize: 11, marginTop: 6, fontWeight: i === currentIdx ? 700 : 500, color: i <= currentIdx ? 'var(--text, #111)' : 'var(--text-dim, #999)' }}>
                      {i <= currentIdx ? '✓ ' : ''}{STEP_LABEL[s]}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.trackingNumber && (
              <div style={{ margin: '16px 0', padding: '12px 16px', borderRadius: 10, background: 'var(--surface-2, #f4f4f4)', fontSize: 14, color: 'var(--text, #111)' }}>
                <strong>{result.carrier || 'Carrier'}</strong> · Tracking: {' '}
                {result.trackingUrl
                  ? <a href={result.trackingUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>{result.trackingNumber}</a>
                  : result.trackingNumber}
              </div>
            )}

            {result.items.length > 0 && (
              <ul style={{ margin: '16px 0 0', paddingLeft: 18, fontSize: 14, color: 'var(--text, #111)' }}>
                {result.items.map((it, i) => <li key={i}>{it.quantity}× {it.name}</li>)}
              </ul>
            )}

            {result.timeline.length > 0 && (
              <div style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle, #eee)', paddingTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-dim, #888)', marginBottom: 10 }}>History</div>
                {result.timeline.slice().reverse().map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 13, color: 'var(--text, #111)' }}>
                    <span style={{ color: 'var(--text-dim, #999)', minWidth: 120, fontSize: 12 }}>{new Date(t.at).toLocaleString('en-GB')}</span>
                    <span><strong>{t.status}</strong> {t.detail ? `— ${t.detail}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
