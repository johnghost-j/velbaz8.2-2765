/**
 * ShippingConfigPanel — configuration de l'expédition propre (self-fulfillment).
 *
 * L'admin définit : entrepôt, tarif fixe, seuil de livraison gratuite, et des
 * ZONES (nom + pays + paliers de poids → prix). Ces zones alimentent le calcul
 * automatique des frais de port (POST /companies/:id/shipping/quote).
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from '../lib/token';

interface Rate { maxWeightKg: number; price: number; }
interface Zone { name: string; countries: string[]; rates: Rate[]; isDefault?: boolean; }

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export default function ShippingConfigPanel({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const [flatRate, setFlatRate] = useState<string>('5');
  const [freeThreshold, setFreeThreshold] = useState<string>('');
  const [warehouse, setWarehouse] = useState<string>('');
  const [zones, setZones] = useState<Zone[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/companies/${companyId}/shipping`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    const s = data?.shipping;
    if (s) {
      if (s.flatRate != null) setFlatRate(String(s.flatRate));
      if (s.freeShippingThreshold != null) setFreeThreshold(String(s.freeShippingThreshold));
      if (s.warehouseLocation) setWarehouse(s.warehouseLocation);
      try { if (s.zones) setZones(JSON.parse(s.zones)); } catch { /* zones illisibles */ }
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const body: any = {
        provider: 'self',
        providerName: 'Self-fulfilled shipping',
        fulfillmentType: 'self',
        flatRate: flatRate ? Number(flatRate) : null,
        freeShippingThreshold: freeThreshold ? Number(freeThreshold) : null,
        warehouseLocation: warehouse || null,
        zones: JSON.stringify(zones),
        isActive: 1,
      };
      const res = await fetch(`/api/companies/${companyId}/shipping`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      setMsg(res.ok ? '✓ Saved' : '✗ Error while saving');
    } catch { setMsg('✗ Network error'); }
    finally { setSaving(false); }
  }

  function addZone() {
    setZones([...zones, { name: 'Nouvelle zone', countries: ['BE'], rates: [{ maxWeightKg: 1, price: 5 }] }]);
  }
  function updateZone(i: number, patch: Partial<Zone>) {
    setZones(zones.map((z, idx) => (idx === i ? { ...z, ...patch } : z)));
  }
  function removeZone(i: number) { setZones(zones.filter((_, idx) => idx !== i)); }
  function addRate(zi: number) {
    updateZone(zi, { rates: [...zones[zi].rates, { maxWeightKg: 5, price: 10 }] });
  }
  function updateRate(zi: number, ri: number, patch: Partial<Rate>) {
    updateZone(zi, { rates: zones[zi].rates.map((r, idx) => (idx === ri ? { ...r, ...patch } : r)) });
  }
  function removeRate(zi: number, ri: number) {
    updateZone(zi, { rates: zones[zi].rates.filter((_, idx) => idx !== ri) });
  }

  const inp: React.CSSProperties = { padding: '5px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--surface-1, transparent)', color: 'var(--text)' };
  const btn: React.CSSProperties = { padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer' };

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, marginBottom: 12, background: 'var(--surface-1, transparent)' }}>
      <div onClick={() => setOpen(!open)} style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <span>⚙ Shipping settings (self-fulfillment)</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 12px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              Flat rate (€)
              <input style={inp} type="number" value={flatRate} onChange={(e) => setFlatRate(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              Free shipping over (€)
              <input style={inp} type="number" value={freeThreshold} onChange={(e) => setFreeThreshold(e.target.value)} placeholder="—" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, flex: 1, minWidth: 160 }}>
              Warehouse location
              <input style={inp} value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder="Bruxelles, BE" />
            </label>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, margin: '8px 0' }}>Zones (weight tiers by country)</div>
          {zones.map((z, zi) => (
            <div key={zi} style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <input style={{ ...inp, fontWeight: 600 }} value={z.name} onChange={(e) => updateZone(zi, { name: e.target.value })} placeholder="Zone name" />
                <input style={{ ...inp, flex: 1, minWidth: 140 }} value={z.countries.join(', ')} onChange={(e) => updateZone(zi, { countries: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })} placeholder="Countries (BE, FR, NL)" />
                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={!!z.isDefault} onChange={(e) => updateZone(zi, { isDefault: e.target.checked })} /> default
                </label>
                <button style={btn} onClick={() => removeZone(zi)}>✗ zone</button>
              </div>
              {z.rates.map((r, ri) => (
                <div key={ri} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>≤</span>
                  <input style={{ ...inp, width: 70 }} type="number" value={r.maxWeightKg} onChange={(e) => updateRate(zi, ri, { maxWeightKg: Number(e.target.value) })} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>kg →</span>
                  <input style={{ ...inp, width: 80 }} type="number" value={r.price} onChange={(e) => updateRate(zi, ri, { price: Number(e.target.value) })} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>€</span>
                  <button style={btn} onClick={() => removeRate(zi, ri)}>✗</button>
                </div>
              ))}
              <button style={btn} onClick={() => addRate(zi)}>+ tier</button>
            </div>
          ))}
          <button style={btn} onClick={addZone}>+ zone</button>

          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={{ ...btn, fontWeight: 700 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save shipping settings'}</button>
            {msg && <span style={{ fontSize: 12, fontWeight: 600 }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
