import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';

const STAGES = [
  { key: 'lead', label: 'Leads', color: '#6B7280', emoji: '🎯' },
  { key: 'prospect', label: 'Prospects', color: '#3B82F6', emoji: '👀' },
  { key: 'negotiation', label: 'Negotiation', color: '#F59E0B', emoji: '🤝' },
  { key: 'proposal', label: 'Proposal', color: '#8B5CF6', emoji: '📋' },
  { key: 'won', label: 'Won', color: '#10B981', emoji: '🏆' },
  { key: 'lost', label: 'Lost', color: '#EF4444', emoji: '❌' },
];

const PRIORITIES: Record<string, { color: string; label: string }> = {
  low: { color: '#6B7280', label: 'Low' },
  medium: { color: '#F59E0B', label: 'Medium' },
  high: { color: '#F97316', label: 'High' },
  urgent: { color: '#EF4444', label: 'Urgent' },
};

function formatValue(n: number) {
  if (n >= 1000000) return `€${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `€${(n / 1000).toFixed(1)}K`;
  return `€${n.toFixed(0)}`;
}

type CrmView = 'kanban' | 'customers' | 'stats';

export function CrmTab({ companyId }: { companyId: string }) {
  const [view, setView] = useState<CrmView>('kanban');
  const [deals, setDeals] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragDeal, setDragDeal] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [dealsRes, custsRes, statsRes] = await Promise.all([
      api.crm.deals.list(companyId),
      api.crm.customers.list(companyId),
      api.crm.stats(companyId),
    ]);
    setDeals(dealsRes.deals || []);
    setCustomers(custsRes.customers || []);
    setStats(statsRes);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function moveDeal(dealId: string, newStage: string) {
    // Optimistic update
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage } : d));
    await api.crm.deals.update(companyId, dealId, { stage: newStage });
    // Refresh stats
    const statsRes = await api.crm.stats(companyId);
    setStats(statsRes);
  }

  async function analyzeEmails() {
    setAnalyzing(true);
    const res = await api.crm.analyzeEmails(companyId);
    setAnalyzing(false);
    if (res.created > 0) refresh();
  }

  async function deleteDeal(dealId: string) {
    setDeals(prev => prev.filter(d => d.id !== dealId));
    await api.crm.deals.delete(companyId, dealId);
    const statsRes = await api.crm.stats(companyId);
    setStats(statsRes);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="flex items-center gap-2">
        <div className="flex gap-1"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        <span className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading CRM...</span>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header + Stats Summary */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {(['kanban', 'customers', 'stats'] as CrmView[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={view === v
                ? { background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }
                : { color: 'var(--text-dim)' }
              }>
              {v === 'kanban' ? 'Pipeline' : v === 'customers' ? `Customers (${customers.length})` : 'Stats'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={analyzeEmails} disabled={analyzing}
            className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
            {analyzing ? 'Analyzing...' : '🤖 Scan Emails'}
          </button>
          <button onClick={() => setShowAddDeal(true)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
            + Deal
          </button>
          <button onClick={() => setShowAddCustomer(true)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'var(--surface-5)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
            + Customer
          </button>
        </div>
      </div>

      {/* Quick Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          {[
            { label: 'Pipeline', value: formatValue(stats.totalPipeline || 0), color: 'var(--text-secondary)' },
            { label: 'Won', value: formatValue(stats.wonValue || 0), color: '#10B981' },
            { label: 'Deals', value: stats.totalDeals || 0, color: 'var(--text-muted)' },
            { label: 'Customers', value: stats.totalCustomers || 0, color: 'var(--text-muted)' },
            { label: 'Win Rate', value: `${stats.conversionRate || 0}%`, color: stats.conversionRate > 50 ? '#10B981' : '#F59E0B' },
          ].map(s => (
            <div key={s.label} className="rounded-lg p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
              <div className="text-[10px] mb-1" style={{ color: 'var(--text-ghost)' }}>{s.label}</div>
              <div className="text-lg font-semibold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Kanban View */}
      {view === 'kanban' && (
        <div className="flex gap-2 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
          {STAGES.filter(s => s.key !== 'lost').map(stage => {
            const stageDeals = deals.filter(d => d.stage === stage.key);
            const stageValue = stageDeals.reduce((s, d) => s + (d.value || 0), 0);
            return (
              <div key={stage.key} className="flex-shrink-0 rounded-lg overflow-hidden flex flex-col"
                style={{
                  width: 220, background: 'var(--surface-1)',
                  border: dragOverStage === stage.key ? `2px solid ${stage.color}` : '1px solid var(--border-default)',
                }}
                onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.key); }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={() => {
                  if (dragDeal && dragDeal !== stage.key) {
                    moveDeal(dragDeal, stage.key);
                  }
                  setDragDeal(null);
                  setDragOverStage(null);
                }}>
                {/* Column Header */}
                <div className="p-2.5 flex items-center justify-between" style={{ borderBottom: `2px solid ${stage.color}` }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{stage.emoji}</span>
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{stage.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--surface-3)', color: 'var(--text-ghost)' }}>{stageDeals.length}</span>
                  </div>
                  {stageValue > 0 && <span className="text-[10px] font-medium" style={{ color: stage.color }}>{formatValue(stageValue)}</span>}
                </div>
                {/* Cards */}
                <div className="p-1.5 flex-1 flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: 500 }}>
                  {stageDeals.length === 0 && (
                    <div className="text-center py-6 text-[11px]" style={{ color: 'var(--text-ghost)' }}>No deals</div>
                  )}
                  {stageDeals.map(deal => (
                    <DealCard key={deal.id} deal={deal}
                      onDragStart={() => setDragDeal(deal.id)}
                      onDelete={() => deleteDeal(deal.id)}
                      onMove={(stage) => moveDeal(deal.id, stage)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lost deals bar */}
      {view === 'kanban' && deals.filter(d => d.stage === 'lost').length > 0 && (
        <div className="mt-2 rounded-lg p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
          <div className="text-[11px] font-medium mb-2" style={{ color: '#EF4444' }}>❌ Lost ({deals.filter(d => d.stage === 'lost').length})</div>
          <div className="flex flex-wrap gap-2">
            {deals.filter(d => d.stage === 'lost').map(d => (
              <span key={d.id} className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>
                {d.title} {d.value > 0 && `• ${formatValue(d.value)}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Customers View */}
      {view === 'customers' && (
        <div>
          {customers.length === 0 ? (
            <div className="text-center py-12 rounded-lg" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
              <p className="text-sm mb-2" style={{ color: 'var(--text-ghost)' }}>No customers yet</p>
              <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>Add one manually or scan your emails</p>
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    {['Name', 'Email', 'Company', 'Source', 'Deals', 'Value', ''].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-ghost)', borderBottom: '1px solid var(--border-default)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id} className="hover:bg-[var(--surface-1)] transition-colors" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{c.name}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-dim)' }}>{c.email || '—'}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-dim)' }}>{c.company || '—'}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-ghost)' }}>{c.source}</span>
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{c.dealsCount || 0}</td>
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--teal)' }}>{formatValue(c.totalValue || 0)}</td>
                      <td className="px-3 py-2">
                        <button onClick={async () => {
                          if (confirm('Delete this customer?')) {
                            await api.crm.customers.delete(companyId, c.id);
                            refresh();
                          }
                        }} className="text-[10px] px-2 py-1 rounded hover:bg-red-500/10" style={{ color: '#EF4444' }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Stats View */}
      {view === 'stats' && stats && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Pipeline Funnel */}
            <div className="rounded-lg p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Pipeline Funnel</h3>
              {STAGES.map(stage => {
                const data = stats.byStage?.[stage.key] || { count: 0, value: 0 };
                const maxCount = Math.max(...STAGES.map(s => stats.byStage?.[s.key]?.count || 0), 1);
                const pct = (data.count / maxCount) * 100;
                return (
                  <div key={stage.key} className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{stage.emoji} {stage.label}</span>
                      <span className="text-[11px] font-medium" style={{ color: stage.color }}>{data.count} deals • {formatValue(data.value)}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: stage.color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Conversion Overview */}
            <div className="rounded-lg p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Overview</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Active Pipeline</span>
                  <span className="text-[14px] font-bold" style={{ color: 'var(--text-secondary)' }}>{formatValue(stats.totalPipeline || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Revenue Won</span>
                  <span className="text-[14px] font-bold" style={{ color: '#10B981' }}>{formatValue(stats.wonValue || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Win Rate</span>
                  <span className="text-[14px] font-bold" style={{ color: stats.conversionRate > 50 ? '#10B981' : '#F59E0B' }}>{stats.conversionRate || 0}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Avg Deal Size</span>
                  <span className="text-[14px] font-bold" style={{ color: 'var(--text-secondary)' }}>{stats.totalDeals > 0 ? formatValue((stats.totalPipeline + stats.wonValue) / stats.totalDeals) : '€0'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Deal Modal */}
      {showAddDeal && (
        <AddDealModal companyId={companyId} customers={customers}
          onClose={() => setShowAddDeal(false)} onCreated={refresh} />
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <AddCustomerModal companyId={companyId}
          onClose={() => setShowAddCustomer(false)} onCreated={refresh} />
      )}
    </div>
  );
}

// ─── Deal Card ──────────────────────────────────────────────────────────────
function DealCard({ deal, onDragStart, onDelete, onMove }: {
  deal: any;
  onDragStart: () => void;
  onDelete: () => void;
  onMove: (stage: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const pri = PRIORITIES[deal.priority] || PRIORITIES.medium;

  return (
    <div draggable onDragStart={onDragStart}
      className="rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-start justify-between mb-1.5">
        <span className="text-[12px] font-medium leading-tight" style={{ color: 'var(--text-secondary)' }}>{deal.title}</span>
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="text-[14px] leading-none px-1 rounded hover:bg-white/5" style={{ color: 'var(--text-ghost)' }}>⋯</button>
          {showMenu && (
            <div className="absolute right-0 top-5 z-20 rounded-lg shadow-lg py-1 min-w-[120px]"
              style={{ background: 'var(--surface-4)', border: '1px solid var(--border-default)' }}
              onMouseLeave={() => setShowMenu(false)}>
              {STAGES.filter(s => s.key !== deal.stage).map(s => (
                <button key={s.key} onClick={() => { onMove(s.key); setShowMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                  {s.emoji} Move to {s.label}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--border-default)', margin: '2px 0' }} />
              <button onClick={() => { onDelete(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-red-500/10" style={{ color: '#EF4444' }}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      {deal.customerName && (
        <div className="text-[10px] mb-1.5" style={{ color: 'var(--text-dim)' }}>👤 {deal.customerName}</div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {deal.value > 0 && (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--teal)' }}>{formatValue(deal.value)}</span>
        )}
        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${pri.color}20`, color: pri.color }}>{pri.label}</span>
        {deal.probability > 0 && (
          <span className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>{deal.probability}%</span>
        )}
      </div>
    </div>
  );
}

// ─── Add Deal Modal ─────────────────────────────────────────────────────────
function AddDealModal({ companyId, customers, onClose, onCreated }: {
  companyId: string; customers: any[]; onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({ title: '', value: '', customerId: '', stage: 'lead', priority: 'medium', notes: '' });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.title.trim()) return;
    setSaving(true);
    await api.crm.deals.create(companyId, {
      title: form.title.trim(),
      value: parseFloat(form.value) || 0,
      customerId: form.customerId || undefined,
      stage: form.stage,
      priority: form.priority,
      notes: form.notes || undefined,
    });
    setSaving(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl p-5 w-full max-w-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>New Deal</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Title *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-[13px]" placeholder="e.g. Website redesign project"
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Value (€)</label>
              <input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-[13px]" placeholder="0"
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Stage</label>
              <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-[13px]"
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Customer</label>
              <select value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-[13px]"
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                <option value="">None</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-[13px]"
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-[13px] resize-none" rows={2} placeholder="Optional notes..."
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-[12px] px-4 py-2 rounded-lg" style={{ color: 'var(--text-dim)' }}>Cancel</button>
          <button onClick={submit} disabled={saving || !form.title.trim()}
            className="text-[12px] px-4 py-2 rounded-lg font-medium disabled:opacity-40"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
            {saving ? 'Creating...' : 'Create Deal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Customer Modal ─────────────────────────────────────────────────────
function AddCustomerModal({ companyId, onClose, onCreated }: {
  companyId: string; onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', notes: '' });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.name.trim()) return;
    setSaving(true);
    await api.crm.customers.create(companyId, {
      name: form.name.trim(),
      email: form.email || undefined,
      phone: form.phone || undefined,
      company: form.company || undefined,
      notes: form.notes || undefined,
    });
    setSaving(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl p-5 w-full max-w-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>New Customer</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-[13px]" placeholder="John Doe"
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Email</label>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-[13px]" placeholder="john@example.com"
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-[13px]" placeholder="+32..."
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
            </div>
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Company</label>
            <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-[13px]" placeholder="Acme Inc."
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-ghost)' }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-[13px] resize-none" rows={2} placeholder="Optional notes..."
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-[12px] px-4 py-2 rounded-lg" style={{ color: 'var(--text-dim)' }}>Cancel</button>
          <button onClick={submit} disabled={saving || !form.name.trim()}
            className="text-[12px] px-4 py-2 rounded-lg font-medium disabled:opacity-40"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
            {saving ? 'Creating...' : 'Create Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}
