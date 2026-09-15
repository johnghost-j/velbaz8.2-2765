// ─── Onglet « Credits » de l'AdminPanel : suivi des crédits IA ───────────────
//
// Lecture seule. Répond à 4 questions : combien a coûté l'IA, pour quoi, pour
// qui, et quand elle a travaillé. Toutes les valeurs monétaires sont affichées
// en USD ET en crédits côte à côte.
//
// Données : GET /api/admin/ai-usage/overview (1 requête pour tout le tableau de
// bord) + /events et /events/:id pour le détail brut cliquable.

import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from '../lib/token';

// ─── Types (miroir des réponses de src/api/ai-usage/queries.ts) ──────────────

interface Summary {
  calls: number; costUsd: number; credits: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number;
  cacheWriteTokens: number; reasoningTokens: number; totalTokens: number;
  images: number; busyMs: number; avgMs: number; maxMs: number;
  errors: number; wastedUsd: number; wastedCredits: number; estimated: number;
  firstAt: number | null; lastAt: number | null;
  users: number; companiesCount: number; models: number; runs: number;
  creditsPerUsd: number; errorRate: number; avgCostUsd: number;
}

interface Bucket { slot: string; calls: number; costUsd: number; credits: number; totalTokens: number; busyMs: number; avgMs: number; errors: number; }
interface FeatureRow { feature: string; calls: number; costUsd: number; credits: number; totalTokens: number; images: number; busyMs: number; avgMs: number; errors: number; wastedUsd: number; }
interface ModelRow { model: string; provider: string; routedVia: string; calls: number; costUsd: number; credits: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; images: number; avgMs: number; errors: number; estimated: number; }
interface UserRow { userId: string | null; userEmail: string | null; calls: number; costUsd: number; credits: number; totalTokens: number; images: number; busyMs: number; errors: number; wastedUsd: number; features: number; lastAt: number | null; }
interface CompanyRow { companyId: string | null; companyName: string | null; calls: number; costUsd: number; credits: number; totalTokens: number; images: number; busyMs: number; errors: number; wastedUsd: number; lastAt: number | null; }
interface FailureRow { feature: string; model: string; errors: number; wastedUsd: number; wastedCredits: number; lastAt: number | null; sampleError: string | null; }
interface Failures { calls: number; errors: number; errorRate: number; wastedUsd: number; wastedCredits: number; byFeature: FailureRow[]; }
interface RunRow { runId: string; feature: string; label: string | null; userEmail: string | null; companyId: string | null; calls: number; costUsd: number; credits: number; totalTokens: number; busyMs: number; errors: number; startedAt: number; endedAt: number; wallMs: number; concurrency: number; }

interface EventRow {
  id: string; startedAt: string; endedAt: string; durationMs: number;
  model: string; provider: string; routedVia: string; kind: string;
  feature: string; label: string | null; route: string | null; runId: string | null;
  userId: string | null; userEmail: string | null; companyId: string | null; projectId: string | null;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  reasoningTokens: number; totalTokens: number; images: number;
  costUsd: number; credits: number; priced: string; status: string;
  errorMessage: string | null; finishReason: string | null; meta: unknown;
}

interface Overview {
  summary: Summary; timeline: Bucket[]; byFeature: FeatureRow[]; byModel: ModelRow[];
  byUser: UserRow[]; byCompany: CompanyRow[]; failures: Failures; runs: RunRow[];
}

// ─── Style (aligné sur le reste de l'AdminPanel : terminal sombre) ───────────

const CARD: React.CSSProperties = { background: '#111119', border: '1px solid #1a1a28', borderRadius: 10, padding: 12 };
const TH: React.CSSProperties = { textAlign: 'left', fontSize: 9, color: '#444', fontWeight: 600, padding: '5px 8px', borderBottom: '1px solid #1a1a28', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' };
const TD: React.CSSProperties = { fontSize: 10, color: '#8c8c8c', padding: '5px 8px', borderBottom: '1px solid #12121c', whiteSpace: 'nowrap' };
const SECTION_TITLE: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#bbb', marginBottom: 8 };
const HINT: React.CSSProperties = { fontSize: 9, color: '#3a3a48', fontWeight: 400, marginLeft: 6 };

const C = { blue: '#1890ff', purple: '#b37feb', green: '#52c41a', yellow: '#faad14', red: '#ff4d4f', cyan: '#36cfc9' };

// ─── Formatage ──────────────────────────────────────────────────────────────

function usd(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(6)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function credits(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v === 0) return '0 cr';
  if (v < 1) return `${v.toFixed(2)} cr`;
  return `${Math.round(v).toLocaleString('en-US')} cr`;
}

function num(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('en-US');
}

function ms(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v < 1000) return `${Math.round(v)}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  if (v < 3_600_000) return `${Math.floor(v / 60_000)}m ${Math.round((v % 60_000) / 1000)}s`;
  return `${Math.floor(v / 3_600_000)}h ${Math.round((v % 3_600_000) / 60_000)}m`;
}

function when(ts: number | string | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'string' ? ts : Number(ts));
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Coût affiché toujours en double unité : USD au-dessus, crédits en dessous. */
function Money({ u, c, color }: { u: number; c: number; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
      <span style={{ color: color || '#ccc', fontWeight: 600 }}>{usd(u)}</span>
      <span style={{ color: '#4a4a5a', fontSize: 9 }}>{credits(c)}</span>
    </span>
  );
}

/** Barre de proportion (part du coût total). */
function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ background: '#0a0a12', borderRadius: 3, height: 5, overflow: 'hidden', minWidth: 50 }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color, borderRadius: 3 }} />
    </div>
  );
}

function adminFetch(path: string): Promise<any> {
  const token = getAuthToken();
  return fetch(`/api/admin${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).then(r => r.json());
}

const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7j' },
  { days: 30, label: '30j' },
  { days: 90, label: '90j' },
  { days: 365, label: '1 an' },
];

// ─── Composant ──────────────────────────────────────────────────────────────

export default function AiCreditsPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Détail brut
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [filterFeature, setFilterFeature] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  const bucket = days <= 2 ? 'hour' : 'day';

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await adminFetch(`/ai-usage/overview?days=${days}&bucket=${bucket}`);
      if (d?.error) { setErr(String(d.error)); setData(null); }
      else setData(d as Overview);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days, bucket]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const qs = new URLSearchParams({ days: String(days), limit: '60' });
      if (filterFeature) qs.set('feature', filterFeature);
      if (filterStatus) qs.set('status', filterStatus);
      const d = await adminFetch(`/ai-usage/events?${qs.toString()}`);
      setEvents(d?.rows || []);
      setEventsTotal(d?.total || 0);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [days, filterFeature, filterStatus]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const s = data?.summary;
  const totalCost = s?.costUsd || 0;
  const pct = (v: number) => (totalCost > 0 ? (v / totalCost) * 100 : 0);
  // Échelle du graphe = plus gros bucket réel. Surtout PAS Math.max(1, …) :
  // avec des coûts de l'ordre de 0,0001 $ le dénominateur resterait à 1 et
  // toutes les barres s'écraseraient à la hauteur minimale.
  const maxBucket = (data?.timeline || []).reduce((m, b) => Math.max(m, b.costUsd), 0) || 1;

  return (
    <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
      {/* ─── Barre de période ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#555' }}>Période</span>
        {RANGES.map(r => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            style={{
              background: days === r.days ? '#1a1a28' : 'transparent',
              color: days === r.days ? '#ddd' : '#555',
              border: `1px solid ${days === r.days ? '#2a2a3a' : '#1a1a28'}`,
              borderRadius: 6, padding: '3px 10px', fontSize: 10, cursor: 'pointer',
            }}
          >{r.label}</button>
        ))}
        <button
          onClick={() => { void load(); void loadEvents(); }}
          style={{ background: 'transparent', color: '#555', border: '1px solid #1a1a28', borderRadius: 6, padding: '3px 10px', fontSize: 10, cursor: 'pointer', marginLeft: 'auto' }}
        >↻ Rafraîchir</button>
        {s && <span style={{ fontSize: 9, color: '#3a3a48' }}>1 $ = {num(s.creditsPerUsd)} crédits</span>}
      </div>

      {loading && <div style={{ color: '#444', fontSize: 11 }}>Chargement…</div>}
      {err && <div style={{ color: C.red, fontSize: 11, ...CARD, borderColor: 'rgba(255,77,79,0.3)' }}>Erreur : {err}</div>}

      {!loading && s && s.calls === 0 && (
        <div style={{ ...CARD, color: '#555', fontSize: 11, textAlign: 'center', padding: 24 }}>
          Aucun appel IA enregistré sur cette période.
          <div style={{ fontSize: 10, color: '#3a3a48', marginTop: 6 }}>
            Le compteur enregistre automatiquement chaque appel dès qu'il passe par le gateway.
          </div>
        </div>
      )}

      {!loading && s && s.calls > 0 && data && (
        <>
          {/* ─── 1. Chiffres clés ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'Coût total', main: usd(s.costUsd), sub: credits(s.credits), color: C.green },
              { label: 'Appels IA', main: num(s.calls), sub: `${num(s.runs)} runs`, color: C.blue },
              { label: 'Tokens', main: num(s.totalTokens), sub: `${num(s.inputTokens)} in / ${num(s.outputTokens)} out`, color: C.purple },
              { label: 'Temps de travail IA', main: ms(s.busyMs), sub: `moy ${ms(s.avgMs)} · max ${ms(s.maxMs)}`, color: C.cyan },
              { label: 'Échecs', main: `${(s.errorRate * 100).toFixed(1)}%`, sub: `${num(s.errors)} appels · ${usd(s.wastedUsd)} perdus`, color: s.errors > 0 ? C.red : '#333' },
              { label: 'Coût moyen / appel', main: usd(s.avgCostUsd), sub: credits(s.avgCostUsd * s.creditsPerUsd), color: C.yellow },
            ].map(k => (
              <div key={k.label} style={{ ...CARD, padding: '12px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.main}</div>
                <div style={{ fontSize: 9, color: '#4a4a5a', marginTop: 3 }}>{k.sub}</div>
                <div style={{ fontSize: 9, color: '#444', marginTop: 5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Bandeau d'avertissement estimation */}
          {s.estimated > 0 && (
            <div style={{ ...CARD, padding: '8px 12px', marginBottom: 12, borderColor: 'rgba(250,173,20,0.25)', fontSize: 10, color: C.yellow }}>
              ⚠ {num(s.estimated)} appel(s) sur {num(s.calls)} facturés au tarif par défaut : le modèle n'est pas dans la table de prix
              (<code style={{ color: '#7a7a8a' }}>src/api/ai-usage/pricing.ts</code>). Leur coût est une estimation prudente.
            </div>
          )}

          {/* ─── 2. Timeline : quand l'IA a bossé ─── */}
          <div style={{ ...CARD, marginBottom: 12 }}>
            <div style={SECTION_TITLE}>
              Quand l'IA a travaillé
              <span style={HINT}>coût par {bucket === 'hour' ? 'heure' : 'jour'} · hauteur = $ · rouge = échecs</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90, overflowX: 'auto', paddingBottom: 2 }}>
              {data.timeline.map(b => {
                const h = Math.max(2, (b.costUsd / maxBucket) * 78);
                return (
                  <div key={b.slot} title={`${b.slot}\n${usd(b.costUsd)} · ${credits(b.credits)}\n${num(b.calls)} appels · ${num(b.errors)} échecs\nIA occupée ${ms(b.busyMs)} (moy ${ms(b.avgMs)})`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 16, maxWidth: 48, flex: '1 0 16px', cursor: 'default' }}>
                    <div style={{ width: '100%', height: h, background: b.errors > 0 ? C.red : C.blue, opacity: b.errors > 0 ? 0.75 : 0.85, borderRadius: '3px 3px 0 0' }} />
                    <div style={{ fontSize: 8, color: '#3a3a48', whiteSpace: 'nowrap', transform: 'rotate(-45deg)', transformOrigin: 'center', height: 12 }}>
                      {b.slot.slice(bucket === 'hour' ? 11 : 5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── 3. Répartition par feature + par modèle ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 8, marginBottom: 12 }}>
            <div style={CARD}>
              <div style={SECTION_TITLE}>Par feature <span style={HINT}>à quoi servent les crédits</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Feature</th><th style={TH}>Part</th><th style={TH}>Coût</th><th style={TH}>Appels</th><th style={TH}>Temps IA</th><th style={TH}>Err</th></tr></thead>
                  <tbody>
                    {data.byFeature.map(f => (
                      <tr key={f.feature}>
                        <td style={{ ...TD, color: f.feature === 'unknown' ? C.yellow : '#ccc', fontWeight: 600 }}>
                          {f.feature}
                          {f.feature === 'unknown' && <span style={HINT}>non tagué</span>}
                        </td>
                        <td style={{ ...TD, width: 70 }}><Bar pct={pct(f.costUsd)} color={C.purple} /><span style={{ fontSize: 8, color: '#3a3a48' }}>{pct(f.costUsd).toFixed(1)}%</span></td>
                        <td style={TD}><Money u={f.costUsd} c={f.credits} /></td>
                        <td style={TD}>{num(f.calls)}</td>
                        <td style={TD}>{ms(f.busyMs)}</td>
                        <td style={{ ...TD, color: f.errors > 0 ? C.red : '#333' }}>{num(f.errors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={CARD}>
              <div style={SECTION_TITLE}>Par modèle <span style={HINT}>où part l'argent</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Modèle</th><th style={TH}>Part</th><th style={TH}>Coût</th><th style={TH}>Appels</th><th style={TH}>In/Out</th><th style={TH}>Moy</th></tr></thead>
                  <tbody>
                    {data.byModel.map(m => (
                      <tr key={`${m.model}-${m.routedVia}`}>
                        <td style={{ ...TD, color: '#ccc' }}>
                          <div style={{ fontWeight: 600 }}>{m.model}</div>
                          <div style={{ fontSize: 8, color: '#3a3a48' }}>
                            {m.routedVia === 'direct-key' ? 'clé perso' : 'gateway'}
                            {m.estimated > 0 && <span style={{ color: C.yellow }}> · {m.estimated} estimé(s)</span>}
                          </div>
                        </td>
                        <td style={{ ...TD, width: 70 }}><Bar pct={pct(m.costUsd)} color={C.green} /><span style={{ fontSize: 8, color: '#3a3a48' }}>{pct(m.costUsd).toFixed(1)}%</span></td>
                        <td style={TD}><Money u={m.costUsd} c={m.credits} /></td>
                        <td style={TD}>{num(m.calls)}</td>
                        <td style={TD}>{num(m.inputTokens)}/{num(m.outputTokens)}</td>
                        <td style={TD}>{ms(m.avgMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ─── 4. Top consommateurs : users + sociétés ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 8, marginBottom: 12 }}>
            <div style={CARD}>
              <div style={SECTION_TITLE}>Top utilisateurs <span style={HINT}>qui consomme</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Utilisateur</th><th style={TH}>Coût</th><th style={TH}>Appels</th><th style={TH}>Tokens</th><th style={TH}>Temps IA</th><th style={TH}>Dernier</th></tr></thead>
                  <tbody>
                    {data.byUser.map((u, i) => (
                      <tr key={u.userId || `anon-${i}`}>
                        <td style={{ ...TD, color: '#ccc', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.userEmail || u.userId || <span style={{ color: '#3a3a48' }}>— non attribué —</span>}
                          <div style={{ fontSize: 8, color: '#3a3a48' }}>{num(u.features)} feature(s)</div>
                        </td>
                        <td style={TD}><Money u={u.costUsd} c={u.credits} /></td>
                        <td style={TD}>{num(u.calls)}</td>
                        <td style={TD}>{num(u.totalTokens)}</td>
                        <td style={TD}>{ms(u.busyMs)}</td>
                        <td style={TD}>{when(u.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={CARD}>
              <div style={SECTION_TITLE}>Top sociétés / projets <span style={HINT}>pour quel client</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Société</th><th style={TH}>Coût</th><th style={TH}>Appels</th><th style={TH}>Tokens</th><th style={TH}>Temps IA</th><th style={TH}>Dernier</th></tr></thead>
                  <tbody>
                    {data.byCompany.map((cp, i) => (
                      <tr key={cp.companyId || `none-${i}`}>
                        <td style={{ ...TD, color: '#ccc', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cp.companyName || cp.companyId || <span style={{ color: '#3a3a48' }}>— global —</span>}
                        </td>
                        <td style={TD}><Money u={cp.costUsd} c={cp.credits} /></td>
                        <td style={TD}>{num(cp.calls)}</td>
                        <td style={TD}>{num(cp.totalTokens)}</td>
                        <td style={TD}>{ms(cp.busyMs)}</td>
                        <td style={TD}>{when(cp.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ─── 5. Échecs et coût gaspillé ─── */}
          <div style={{ ...CARD, marginBottom: 12, borderColor: data.failures.errors > 0 ? 'rgba(255,77,79,0.25)' : '#1a1a28' }}>
            <div style={SECTION_TITLE}>
              Échecs & crédits gaspillés
              <span style={HINT}>
                {num(data.failures.errors)}/{num(data.failures.calls)} appels en erreur ({(data.failures.errorRate * 100).toFixed(1)}%) ·
                {' '}{usd(data.failures.wastedUsd)} / {credits(data.failures.wastedCredits)} perdus
              </span>
            </div>
            {data.failures.byFeature.length === 0 ? (
              <div style={{ fontSize: 10, color: '#3a3a48' }}>Aucun échec sur la période.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Feature</th><th style={TH}>Modèle</th><th style={TH}>Échecs</th><th style={TH}>Gaspillé</th><th style={TH}>Dernier</th><th style={TH}>Erreur</th></tr></thead>
                  <tbody>
                    {data.failures.byFeature.map((f, i) => (
                      <tr key={`${f.feature}-${f.model}-${i}`}>
                        <td style={{ ...TD, color: '#ccc', fontWeight: 600 }}>{f.feature}</td>
                        <td style={TD}>{f.model}</td>
                        <td style={{ ...TD, color: C.red, fontWeight: 700 }}>{num(f.errors)}</td>
                        <td style={TD}><Money u={f.wastedUsd} c={f.wastedCredits} color={C.red} /></td>
                        <td style={TD}>{when(f.lastAt)}</td>
                        <td style={{ ...TD, color: '#6a6a7a', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.sampleError || ''}>{f.sampleError || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ─── 6. Runs : durées + appels concurrents ─── */}
          <div style={{ ...CARD, marginBottom: 12 }}>
            <div style={SECTION_TITLE}>
              Runs IA <span style={HINT}>un run = un travail complet · concurrence = appels en parallèle</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 260 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Début</th><th style={TH}>Feature</th><th style={TH}>Pour qui</th>
                  <th style={TH}>Appels</th><th style={TH}>Durée réelle</th><th style={TH}>Temps IA cumulé</th>
                  <th style={TH}>Concurrence</th><th style={TH}>Coût</th><th style={TH}>Err</th>
                </tr></thead>
                <tbody>
                  {data.runs.map(r => (
                    <tr key={r.runId}>
                      <td style={TD}>{when(r.startedAt)}</td>
                      <td style={{ ...TD, color: '#ccc', fontWeight: 600 }}>
                        {r.feature}
                        {r.label && <div style={{ fontSize: 8, color: '#3a3a48' }}>{r.label}</div>}
                      </td>
                      <td style={{ ...TD, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.userEmail || <span style={{ color: '#3a3a48' }}>—</span>}</td>
                      <td style={TD}>{num(r.calls)}</td>
                      <td style={TD}>{ms(r.wallMs)}</td>
                      <td style={TD}>{ms(r.busyMs)}</td>
                      <td style={{ ...TD, color: r.concurrency > 1.5 ? C.cyan : '#555', fontWeight: r.concurrency > 1.5 ? 700 : 400 }}>×{r.concurrency.toFixed(1)}</td>
                      <td style={TD}><Money u={r.costUsd} c={r.credits} /></td>
                      <td style={{ ...TD, color: r.errors > 0 ? C.red : '#333' }}>{num(r.errors)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─── 7. Détail brut de chaque appel (cliquable) ─── */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ ...SECTION_TITLE, marginBottom: 0 }}>
            Détail des appels <span style={HINT}>{num(eventsTotal)} au total · clic sur une ligne pour tout voir</span>
          </div>
          <select
            value={filterFeature}
            onChange={e => setFilterFeature(e.target.value)}
            style={{ background: '#0a0a12', color: '#8c8c8c', border: '1px solid #1a1a28', borderRadius: 6, padding: '3px 8px', fontSize: 10, marginLeft: 'auto' }}
          >
            <option value="">Toutes les features</option>
            {(data?.byFeature || []).map(f => <option key={f.feature} value={f.feature}>{f.feature}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ background: '#0a0a12', color: '#8c8c8c', border: '1px solid #1a1a28', borderRadius: 6, padding: '3px 8px', fontSize: 10 }}
          >
            <option value="">Tous les statuts</option>
            <option value="ok">Succès</option>
            <option value="error">Échecs</option>
          </select>
        </div>

        {eventsLoading && <div style={{ color: '#444', fontSize: 10 }}>Chargement…</div>}
        {!eventsLoading && events.length === 0 && <div style={{ fontSize: 10, color: '#3a3a48' }}>Aucun appel.</div>}
        {!eventsLoading && events.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: 320 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Quand</th><th style={TH}>Feature</th><th style={TH}>Modèle</th>
                <th style={TH}>Utilisateur</th><th style={TH}>Tokens</th><th style={TH}>Durée</th>
                <th style={TH}>Coût</th><th style={TH}>Statut</th>
              </tr></thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id} onClick={() => setSelected(ev)} style={{ cursor: 'pointer', background: selected?.id === ev.id ? '#16161f' : 'transparent' }}>
                    <td style={TD}>{when(ev.startedAt)}</td>
                    <td style={{ ...TD, color: ev.feature === 'unknown' ? C.yellow : '#ccc', fontWeight: 600 }}>
                      {ev.feature}
                      {ev.label && <div style={{ fontSize: 8, color: '#3a3a48' }}>{ev.label}</div>}
                    </td>
                    <td style={TD}>{ev.model}<div style={{ fontSize: 8, color: '#3a3a48' }}>{ev.kind}</div></td>
                    <td style={{ ...TD, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.userEmail || ev.userId || <span style={{ color: '#3a3a48' }}>—</span>}</td>
                    <td style={TD}>{num(ev.totalTokens)}<div style={{ fontSize: 8, color: '#3a3a48' }}>{num(ev.inputTokens)}/{num(ev.outputTokens)}</div></td>
                    <td style={TD}>{ms(ev.durationMs)}</td>
                    <td style={TD}><Money u={ev.costUsd} c={ev.credits} /></td>
                    <td style={{ ...TD, color: ev.status === 'error' ? C.red : C.green, fontWeight: 600 }}>{ev.status === 'error' ? 'ERREUR' : 'ok'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Panneau de détail d'un appel ─── */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ ...CARD, maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto', background: '#0e0e16' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#ddd' }}>Appel IA — {selected.feature}</div>
              <button onClick={() => setSelected(null)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #1a1a28', color: '#666', borderRadius: 6, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
              {[
                { l: 'Coût', v: `${usd(selected.costUsd)} · ${credits(selected.credits)}`, c: C.green },
                { l: 'Durée', v: ms(selected.durationMs), c: C.cyan },
                { l: 'Tokens', v: num(selected.totalTokens), c: C.purple },
                { l: 'Statut', v: selected.status === 'error' ? 'ERREUR' : 'ok', c: selected.status === 'error' ? C.red : C.green },
              ].map(k => (
                <div key={k.l} style={{ background: '#111119', border: '1px solid #1a1a28', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: k.c }}>{k.v}</div>
                  <div style={{ fontSize: 9, color: '#444', marginTop: 3 }}>{k.l}</div>
                </div>
              ))}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
              <tbody>
                {([
                  ['Quand', `${when(selected.startedAt)} → ${when(selected.endedAt)}`],
                  ['Feature / tag', `${selected.feature}${selected.label ? ` · ${selected.label}` : ''}`],
                  ['Route HTTP', selected.route || '—'],
                  ['Modèle', `${selected.model} (${selected.provider}, ${selected.routedVia === 'direct-key' ? 'clé perso' : 'gateway'}, ${selected.kind})`],
                  ['Tarification', selected.priced === 'table' ? 'table de prix' : 'tarif par défaut (estimation)'],
                  ['Utilisateur', selected.userEmail || selected.userId || '—'],
                  ['Société', selected.companyId || '—'],
                  ['Projet', selected.projectId || '—'],
                  ['Run', selected.runId || '—'],
                  ['Tokens entrée', `${num(selected.inputTokens)} (cache lu ${num(selected.cacheReadTokens)} · cache écrit ${num(selected.cacheWriteTokens)})`],
                  ['Tokens sortie', `${num(selected.outputTokens)} (raisonnement ${num(selected.reasoningTokens)})`],
                  ['Images', num(selected.images)],
                  ['Fin', selected.finishReason || '—'],
                  ['ID', selected.id],
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...TD, color: '#555', width: 140, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                    <td style={{ ...TD, color: '#aaa', whiteSpace: 'normal', wordBreak: 'break-all' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selected.errorMessage && (
              <div style={{ background: 'rgba(255,77,79,0.06)', border: '1px solid rgba(255,77,79,0.25)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: C.red, marginBottom: 4, textTransform: 'uppercase' }}>Erreur</div>
                <div style={{ fontSize: 10, color: '#c88', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{selected.errorMessage}</div>
              </div>
            )}

            {selected.meta != null && (
              <>
                <div style={{ fontSize: 9, color: '#333', marginBottom: 4 }}>META</div>
                <pre style={{ background: '#0a0a12', padding: 8, borderRadius: 8, fontSize: 9, color: '#555', overflow: 'auto', maxHeight: 160, border: '1px solid #151520' }}>
                  {typeof selected.meta === 'string' ? selected.meta : JSON.stringify(selected.meta, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
