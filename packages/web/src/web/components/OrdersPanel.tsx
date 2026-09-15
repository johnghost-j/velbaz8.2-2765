/**
 * OrdersPanel — dashboard des commandes dropshipping.
 *
 * Accessibilité (protanopie) : chaque statut est détectable par le TEXTE
 * ([PAYÉE], [ENVOYÉE FOURNISSEUR], [À TRAITER], [LIVRÉE], [ERREUR: raison])
 * et un symbole (▶ ✓ ✗) — jamais par la couleur seule.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from '../lib/token';
import ShippingConfigPanel from './ShippingConfigPanel';

interface OrderItem {
  id: string; name: string; quantity: number;
  unitPrice: number | null; unitCost: number | null;
  variantLabel: string | null; supplierProductId: string | null;
}
interface Order {
  id: string; status: string; createdAt: string | number;
  amountTotal: number | null; currency: string | null;
  customerEmail: string | null; customerName: string | null;
  fulfillmentMode: string | null; supplierPlatform: string | null;
  supplierOrderId: string | null; supplierCost: number | null;
  marginAmount: number | null; trackingNumber: string | null; trackingUrl: string | null;
  errorDetail: string | null; dryRun: number | null;
  items: OrderItem[];
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function statusSymbol(status: string): string {
  if (status.startsWith('[ERREUR')) return '✗';
  if (status === '[LIVRÉE]' || status === '[ENVOYÉE FOURNISSEUR]' || status === '[EXPÉDIÉE]') return '✓';
  return '▶';
}

// Couleurs SECONDAIRES (le texte + symbole suffisent seuls) — bleu/gris, pas de rouge/vert seul.
function statusStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    fontWeight: 700, fontSize: 11, padding: '3px 8px', borderRadius: 5,
    border: '1px solid var(--border-subtle)', display: 'inline-flex', alignItems: 'center', gap: 5,
    letterSpacing: 0.3,
  };
  if (status.startsWith('[ERREUR')) return { ...base, background: 'rgba(120,120,120,0.25)', color: 'var(--text)', borderStyle: 'dashed', borderWidth: 2 };
  if (status === '[LIVRÉE]') return { ...base, background: 'rgba(80,140,255,0.18)', color: 'var(--text)' };
  if (status === '[ENVOYÉE FOURNISSEUR]') return { ...base, background: 'rgba(80,140,255,0.10)', color: 'var(--text)' };
  if (status === '[EXPÉDIÉE]') return { ...base, background: 'rgba(80,140,255,0.14)', color: 'var(--text)' };
  if (status === '[À TRAITER]' || status === '[À EXPÉDIER]') return { ...base, background: 'rgba(255,180,0,0.12)', color: 'var(--text)', textDecoration: 'underline' };
  return { ...base, background: 'var(--surface-2)', color: 'var(--text)' };
}

const CARRIER_OPTIONS = [
  { name: 'bpost', label: 'Bpost (Belgique)' },
  { name: 'colissimo', label: 'Colissimo / La Poste' },
  { name: 'chronopost', label: 'Chronopost' },
  { name: 'mondialrelay', label: 'Mondial Relay' },
  { name: 'dhl', label: 'DHL' },
  { name: 'ups', label: 'UPS' },
  { name: 'fedex', label: 'FedEx' },
  { name: 'gls', label: 'GLS' },
  { name: 'dpd', label: 'DPD' },
  { name: 'autre', label: 'Autre transporteur' },
];

export default function OrdersPanel({ companyId }: { companyId: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // orderId en cours d'action
  const [feedback, setFeedback] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shipFor, setShipFor] = useState<string | null>(null); // orderId dont le formulaire d'expédition est ouvert
  const [shipCarrier, setShipCarrier] = useState('bpost');
  const [shipTracking, setShipTracking] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/orders`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.orders)) setOrders(data.orders);
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 20_000); // rafraîchissement temps réel
    return () => clearInterval(iv);
  }, [load]);

  async function action(orderId: string, path: string, body?: any, label?: string) {
    setBusy(orderId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/orders/${path}`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) setFeedback(`✓ ${label || 'Action'} : ${data.status || data.detail || 'OK'}`);
      else setFeedback(`✗ [ERREUR] ${data?.detail || data?.error || `HTTP ${res.status}`}`);
    } catch (e: any) {
      setFeedback(`✗ [ERREUR] ${e?.message || 'network'}`);
    } finally {
      setBusy(null);
      load();
    }
  }

  // Ouvre l'étiquette d'expédition imprimable (fetch authentifié → Blob → onglet).
  async function openLabel(orderId: string) {
    setBusy(orderId);
    try {
      const res = await fetch(`/api/companies/${companyId}/orders/${orderId}/label`, { headers: authHeaders() });
      if (!res.ok) { setFeedback('✗ [ERREUR] Étiquette indisponible'); return; }
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      setFeedback(`✗ [ERREUR] ${e?.message || 'network'}`);
    } finally { setBusy(null); }
  }

  // Confirme l'expédition (transporteur + n° de suivi).
  async function confirmShip(orderId: string) {
    if (!shipTracking.trim()) { setFeedback('✗ Tracking number required'); return; }
    await action(orderId, `${orderId}/ship`, { carrier: shipCarrier, trackingNumber: shipTracking.trim() }, 'Order shipped');
    setShipFor(null); setShipTracking('');
  }

  const totalMargin = orders.reduce((s, o) => s + (o.marginAmount || 0), 0);
  const totalSales = orders.reduce((s, o) => s + (o.amountTotal || 0), 0);
  const toProcess = orders.filter((o) => o.status === '[À TRAITER]' || o.status.startsWith('[ERREUR')).length;

  const btn: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
    border: '1px solid var(--border-subtle)', background: 'var(--surface-2)',
    color: 'var(--text)', cursor: 'pointer',
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Customer orders</h3>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          {orders.length} order{orders.length > 1 ? 's' : ''} · sales {totalSales.toFixed(2)} € · total margin {totalMargin.toFixed(2)} €
          {toProcess > 0 && <strong> · ▶ {toProcess} to process</strong>}
        </span>
        <button style={btn} onClick={() => action('', 'sync-tracking', {}, 'Tracking sync')} disabled={busy !== null}>
          Sync tracking
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', fontWeight: 600 }}>
          {feedback}
        </div>
      )}

      <ShippingConfigPanel companyId={companyId} />

      {loading ? (
        <div style={{ color: 'var(--text-dim)' }}>Loading…</div>
      ) : orders.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: 24, textAlign: 'center', border: '1px dashed var(--border-subtle)', borderRadius: 8 }}>
          No orders yet. As soon as a customer pays on your store, the order appears here with its status
          ([PAID] → [SENT TO SUPPLIER] → [DELIVERED]) and automatic fulfillment is triggered.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orders.map((o) => {
            const isOpen = expanded === o.id;
            return (
              <div key={o.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--surface-1, transparent)' }}>
                <div
                  onClick={() => setExpanded(isOpen ? null : o.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}
                >
                  <span style={statusStyle(o.status)}>
                    <span aria-hidden>{statusSymbol(o.status)}</span>
                    {o.status}{o.dryRun === 1 ? ' (SIMULATION)' : ''}
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {o.amountTotal != null ? `${o.amountTotal.toFixed(2)} ${o.currency || 'EUR'}` : '—'}
                  </span>
                  <span style={{ color: 'var(--text-dim)' }}>{o.customerEmail || 'unknown email'}</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                    margin {o.marginAmount != null ? `${o.marginAmount.toFixed(2)} €` : '?'}
                  </span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 11 }}>
                    {new Date(o.createdAt).toLocaleString('en-US')} {isOpen ? '▲' : '▼'}
                  </span>
                </div>

                {isOpen && (
                  <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border-subtle)' }}>
                    {o.errorDetail && (
                      <p style={{ fontWeight: 700, margin: '10px 0 6px' }}>✗ [ERREUR] {o.errorDetail}</p>
                    )}
                    <ul style={{ margin: '10px 0', paddingLeft: 18 }}>
                      {o.items.map((it) => (
                        <li key={it.id}>
                          {it.quantity}× {it.name}{it.variantLabel ? ` — ${it.variantLabel}` : ''}
                          {it.unitPrice != null && ` · ${it.unitPrice.toFixed(2)} €`}
                          {it.unitCost != null && ` (cost ${it.unitCost.toFixed(2)} €)`}
                        </li>
                      ))}
                    </ul>
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 10 }}>
                      Supplier: {o.supplierPlatform || '?'} ({o.fulfillmentMode === 'auto' ? 'automatic' : 'semi-auto'})
                      {o.supplierOrderId && ` · ref ${o.supplierOrderId}`}
                      {o.trackingNumber && (
                        <> · tracking{' '}
                          {o.trackingUrl
                            ? <a href={o.trackingUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{o.trackingNumber}</a>
                            : o.trackingNumber}
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(o.status.startsWith('[ERREUR') || o.status === '[PAYÉE]') && (
                        <button style={btn} disabled={busy === o.id}
                          onClick={(e) => { e.stopPropagation(); action(o.id, `${o.id}/fulfill`, {}, 'Fulfillment retried'); }}>
                          {busy === o.id ? 'In progress…' : '▶ Retry fulfillment'}
                        </button>
                      )}
                      {o.status === '[À TRAITER]' && (
                        <button style={btn} disabled={busy === o.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const ref = window.prompt('Supplier order reference (AliExpress / provider) — optional:') || '';
                            action(o.id, `${o.id}/mark-ordered`, { supplierRef: ref }, 'Marked as ordered');
                          }}>
                          {busy === o.id ? 'In progress…' : '✓ Mark as ordered'}
                        </button>
                      )}
                      {/* Expédition propre : À EXPÉDIER → saisie transporteur + suivi */}
                      {o.status === '[À EXPÉDIER]' && (
                        <button style={btn} disabled={busy === o.id}
                          onClick={(e) => { e.stopPropagation(); setShipFor(shipFor === o.id ? null : o.id); }}>
                          📦 Ship (enter tracking)
                        </button>
                      )}
                      {(o.status === '[À EXPÉDIER]' || o.status === '[EXPÉDIÉE]') && (
                        <button style={btn} disabled={busy === o.id}
                          onClick={(e) => { e.stopPropagation(); openLabel(o.id); }}>
                          🏷 Shipping label
                        </button>
                      )}
                      {o.status === '[EXPÉDIÉE]' && (
                        <button style={btn} disabled={busy === o.id}
                          onClick={(e) => { e.stopPropagation(); action(o.id, `${o.id}/deliver`, {}, 'Marked delivered'); }}>
                          ✓ Mark delivered
                        </button>
                      )}
                    </div>

                    {/* Formulaire d'expédition inline */}
                    {shipFor === o.id && (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, padding: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select value={shipCarrier} onChange={(e) => setShipCarrier(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--surface-1, transparent)', color: 'var(--text)' }}>
                          {CARRIER_OPTIONS.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                        </select>
                        <input value={shipTracking} onChange={(e) => setShipTracking(e.target.value)} placeholder="Tracking number"
                          style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--surface-1, transparent)', color: 'var(--text)', flex: 1, minWidth: 140 }} />
                        <button style={{ ...btn, fontWeight: 700 }} disabled={busy === o.id}
                          onClick={() => confirmShip(o.id)}>
                          {busy === o.id ? 'Sending…' : 'Confirm shipment'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
