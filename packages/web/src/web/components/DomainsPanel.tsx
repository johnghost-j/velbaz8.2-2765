import { useCallback, useEffect, useState } from 'react';
import { getAuthToken } from '../lib/token';

// ─── Panneau "Domains" ───────────────────────────────────────────────────────
// Vit DANS la page dashboard du projet (onglet "Domains"). La popup Publish
// ("Add custom domain") y renvoie via /company/:id?tab=domains. Trois blocs :
//   1. Sub-domain : le sous-domaine public du site (copier / modifier).
//   2. Buy a new domain : recherche de disponibilité RÉELLE (RDAP) puis achat
//      via le registrar — l'achat n'est possible que si l'admin a configuré les
//      clés API du registrar (sinon le message le dit franchement).
//   3. Connect an existing domain : enregistre le domaine + affiche le CNAME.

type PublishState = {
  published: boolean;
  subdomain: string | null;
  subdomainDisplay: string | null;
  liveUrl: string | null;
  customDomain: string | null;
  deployConfigured: boolean;
};

type SearchResult = { domain: string; available: boolean | null };

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${getAuthToken() || ''}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function IconGlobe({ size = 17 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>;
}
function IconCart({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h2.2l2.4 11.2h11.6l2-8H6" /></svg>;
}
function IconPlug({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>;
}
function IconCheck({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}
function IconCopy({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
}

export function DomainsPanel({ companyId }: { companyId: string }) {
  const id = companyId;

  const [st, setSt] = useState<PublishState | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);

  // Édition du sous-domaine.
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [check, setCheck] = useState<{ available: boolean; error: string | null } | null>(null);
  const [subErr, setSubErr] = useState('');

  // Panneau ouvert : achat ou connexion.
  const [panel, setPanel] = useState<'none' | 'buy' | 'connect'>('none');

  // Achat.
  const [buyQuery, setBuyQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [purchaseEnabled, setPurchaseEnabled] = useState(false);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [buyMsg, setBuyMsg] = useState('');

  // Connexion d'un domaine existant.
  const [domainInput, setDomainInput] = useState('');
  const [domainMsg, setDomainMsg] = useState('');
  const [dns, setDns] = useState<{ type: string; name: string; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${id}/publish`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setSt(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const copy = async (text: string, tag: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  };

  const onEditChange = async (v: string) => {
    const clean = v.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setEditVal(clean);
    setCheck(null);
    if (!clean) return;
    try {
      const res = await fetch(`/api/companies/${id}/publish/check?value=${encodeURIComponent(clean)}`, { headers: authHeaders() });
      const data = await res.json();
      setCheck({ available: !!data.available, error: data.error || null });
    } catch { /* ignore */ }
  };

  const saveSub = async () => {
    if (!editVal) return;
    setBusy(true); setSubErr('');
    try {
      const res = await fetch(`/api/companies/${id}/publish/settings`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ subdomain: editVal }),
      });
      const data = await res.json();
      if (!res.ok) setSubErr(data.error || 'Erreur');
      else { setSt(data); setEditing(false); }
    } catch { setSubErr('Erreur réseau'); }
    setBusy(false);
  };

  const search = async () => {
    const q = buyQuery.trim();
    if (!q) return;
    setSearching(true); setResults(null); setBuyMsg('');
    try {
      const res = await fetch(`/api/companies/${id}/domains/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) setBuyMsg(data.error || 'Erreur');
      else {
        setResults(data.results || []);
        setPurchaseEnabled(!!data.purchaseEnabled);
        setMissingKeys(data.missingKeys || []);
      }
    } catch { setBuyMsg('Erreur réseau'); }
    setSearching(false);
  };

  const buy = async (domain: string) => {
    setBusy(true); setBuyMsg('');
    try {
      const res = await fetch(`/api/companies/${id}/domains/buy`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBuyMsg(
          data.needsApiKey
            ? `${data.error} Clés manquantes : ${(data.missingKeys || []).join(', ')}.`
            : (data.error || 'Achat impossible'),
        );
      } else {
        setSt(data);
        setDns(data.dns || null);
        setBuyMsg(`${domain} acheté et connecté au site.`);
      }
    } catch { setBuyMsg('Erreur réseau'); }
    setBusy(false);
  };

  const connect = async () => {
    const d = domainInput.trim();
    if (!d) return;
    setBusy(true); setDomainMsg('');
    try {
      const res = await fetch(`/api/companies/${id}/custom-domain`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ domain: d }),
      });
      const data = await res.json();
      if (!res.ok) setDomainMsg(data.error || 'Erreur');
      else {
        setSt(data);
        setDns(data.dns || null);
        setDomainInput('');
        setDomainMsg(
          data.needsDeployKey
            ? 'Domaine enregistré. Ajoute l\'enregistrement CNAME ci-dessous chez ton registrar. Le raccordement final s\'activera dès qu\'une clé de déploiement sera configurée dans le panneau admin.'
            : 'Domaine connecté. Ajoute l\'enregistrement CNAME ci-dessous chez ton registrar.',
        );
      }
    } catch { setDomainMsg('Erreur réseau'); }
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${id}/custom-domain`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ domain: '' }),
      });
      const data = await res.json();
      if (res.ok) { setSt(data); setDns(null); setDomainMsg(''); }
    } catch { /* ignore */ }
    setBusy(false);
  };

  return (
    <div className="max-w-3xl">
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text-faint)' }}>Chargement…</div>
        ) : (
          <>
            {/* ─── Sub-domain ─── */}
            <div className="text-[13px] mb-2" style={{ color: 'var(--text-faint)' }}>Sub-domain</div>
            <div
              className="flex items-center gap-3 px-4 rounded-xl"
              style={{ height: 56, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
            >
              <span style={{ color: 'var(--text-dim)' }}><IconGlobe /></span>
              {editing ? (
                <>
                  <input
                    autoFocus
                    value={editVal}
                    onChange={(e) => onEditChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveSub(); }}
                    data-testid="sub-input"
                    className="flex-1 min-w-0 bg-transparent outline-none text-[15px]"
                    style={{ color: 'var(--text-primary)' }}
                  />
                  <span className="text-[15px] shrink-0" style={{ color: 'var(--text-ghost)' }}>.velbaz.site</span>
                  <button
                    onClick={saveSub}
                    disabled={busy || !editVal || (check ? !check.available : false)}
                    className="text-[13px] px-3 py-1.5 rounded-lg shrink-0"
                    style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', border: 'none', cursor: 'pointer', opacity: check && !check.available ? 0.5 : 1 }}
                  >Save</button>
                  <button
                    onClick={() => { setEditing(false); setSubErr(''); }}
                    className="text-[13px] px-3 py-1.5 rounded-lg shrink-0"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
                  >Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate text-[15px]" style={{ color: 'var(--text-primary)' }} data-testid="sub-value">
                    {st?.subdomainDisplay || '—'}
                  </span>
                  <button
                    onClick={() => copy(st?.subdomainDisplay || '', 'sub')}
                    className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg shrink-0"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
                  >
                    {copied === 'sub' ? <IconCheck size={13} /> : <IconCopy />} Copy
                  </button>
                  <button
                    onClick={() => { setEditVal(st?.subdomain || ''); setCheck(null); setEditing(true); }}
                    data-testid="sub-edit"
                    className="text-[13px] px-3 py-1.5 rounded-lg shrink-0"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
                  >Edit</button>
                </>
              )}
            </div>
            {editing && check && (
              <div className="text-[12.5px] mt-2" style={{ color: check.available ? 'var(--teal)' : '#ff6b6b' }}>
                {check.available ? 'Disponible' : check.error}
              </div>
            )}
            {subErr && <div className="text-[12.5px] mt-2" style={{ color: '#ff6b6b' }}>{subErr}</div>}
            {st?.liveUrl && (
              <div className="text-[12.5px] mt-2" style={{ color: 'var(--text-ghost)' }}>
                {st.published
                  ? <>En ligne : <a href={st.liveUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)' }}>{st.liveUrl}</a></>
                  : <>Pas encore publié — utilise le bouton Publish sur l’aperçu du site.</>}
              </div>
            )}

            {/* ─── Custom domain ─── */}
            <div className="text-[13px] mt-9 mb-3" style={{ color: 'var(--text-faint)' }}>Custom domain</div>

            {st?.customDomain && (
              <div
                className="flex items-center gap-3 px-4 rounded-xl mb-4"
                style={{ height: 52, background: 'var(--surface-3)', border: '1px solid var(--border-hover)' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}><IconCheck /></span>
                <span className="flex-1 min-w-0 truncate text-[14px]" style={{ color: 'var(--text-primary)' }} data-testid="custom-domain-value">
                  {st.customDomain}
                </span>
                <button
                  onClick={disconnect}
                  className="text-[12.5px] px-3 py-1.5 rounded-lg shrink-0"
                  style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
                >Disconnect</button>
              </div>
            )}

            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <DomainCard
                icon={<IconCart />}
                title="Buy a new domain"
                desc="Trouve un nom libre et achète-le sans quitter Velbaz."
                cta="Buy domain"
                active={panel === 'buy'}
                onClick={() => setPanel(panel === 'buy' ? 'none' : 'buy')}
                testid="buy-card"
              />
              <DomainCard
                icon={<IconPlug />}
                title="Connect an existing domain"
                desc="Tu possèdes déjà un domaine ? Branche-le sur ce site."
                cta="Connect domain"
                active={panel === 'connect'}
                onClick={() => setPanel(panel === 'connect' ? 'none' : 'connect')}
                testid="connect-card"
              />
            </div>

            {/* Panneau ACHAT */}
            {panel === 'buy' && (
              <div className="mt-5 p-5 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-[15px] font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Chercher un domaine</div>
                <div className="flex gap-3">
                  <input
                    value={buyQuery}
                    onChange={(e) => setBuyQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                    placeholder="moncafe ou moncafe.com"
                    data-testid="buy-query"
                    className="flex-1 min-w-0 px-4 rounded-xl outline-none text-[14px]"
                    style={{ height: 48, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={search}
                    disabled={searching || !buyQuery.trim()}
                    data-testid="buy-search"
                    className="text-[14px] font-medium px-6 rounded-xl shrink-0"
                    style={{ height: 48, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', border: 'none', cursor: 'pointer', opacity: searching ? 0.6 : 1 }}
                  >{searching ? '…' : 'Search'}</button>
                </div>

                {results && (
                  <div className="mt-4 flex flex-col gap-2" data-testid="buy-results">
                    {results.map((r) => (
                      <div
                        key={r.domain}
                        className="flex items-center gap-3 px-4 rounded-xl"
                        style={{ height: 48, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
                      >
                        <span className="flex-1 min-w-0 truncate text-[14px]" style={{ color: 'var(--text-primary)' }}>{r.domain}</span>
                        <span className="text-[12.5px] shrink-0" style={{ color: r.available === true ? 'var(--teal)' : r.available === false ? 'var(--text-ghost)' : 'var(--text-faint)' }}>
                          {r.available === true ? 'disponible' : r.available === false ? 'déjà pris' : 'inconnu'}
                        </span>
                        {r.available === true && (
                          <button
                            onClick={() => buy(r.domain)}
                            disabled={busy}
                            data-testid={`buy-btn-${r.domain}`}
                            className="text-[12.5px] px-3 py-1.5 rounded-lg shrink-0"
                            style={{
                              background: purchaseEnabled ? 'var(--btn-primary-bg)' : 'var(--surface-3)',
                              color: purchaseEnabled ? 'var(--btn-primary-fg)' : 'var(--text-secondary)',
                              border: purchaseEnabled ? 'none' : '1px solid var(--border-default)',
                              cursor: 'pointer',
                            }}
                          >Buy</button>
                        )}
                      </div>
                    ))}
                    {!purchaseEnabled && (
                      <div className="text-[12.5px] mt-1" style={{ color: 'var(--text-faint)' }}>
                        La disponibilité est réelle. L'achat, lui, exige les clés API du registrar
                        {missingKeys.length ? ` (manquantes : ${missingKeys.join(', ')})` : ''} — à configurer dans le panneau admin.
                      </div>
                    )}
                  </div>
                )}

                {buyMsg && (
                  <div className="text-[13px] mt-4 p-3 rounded-xl leading-relaxed" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }} data-testid="buy-msg">
                    {buyMsg}
                  </div>
                )}
              </div>
            )}

            {/* Panneau CONNEXION */}
            {panel === 'connect' && (
              <div className="mt-5 p-5 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-[15px] font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Enter your domain</div>
                <div className="flex gap-3">
                  <input
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
                    placeholder="coffeeroasters.com"
                    data-testid="connect-input"
                    className="flex-1 min-w-0 px-4 rounded-xl outline-none text-[14px]"
                    style={{ height: 48, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={connect}
                    disabled={busy || !domainInput.trim()}
                    data-testid="connect-submit"
                    className="text-[14px] font-medium px-6 rounded-xl shrink-0"
                    style={{ height: 48, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', border: 'none', cursor: 'pointer' }}
                  >Connect</button>
                </div>
                {domainMsg && (
                  <div className="text-[13px] mt-4 p-3 rounded-xl leading-relaxed" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }} data-testid="connect-msg">
                    {domainMsg}
                  </div>
                )}
              </div>
            )}

            {/* Enregistrement DNS à créer */}
            {dns && (
              <div className="mt-5 p-5 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-[13px] mb-3" style={{ color: 'var(--text-faint)' }}>Enregistrement DNS à créer chez ton registrar</div>
                <div className="flex items-center gap-3 px-4 rounded-xl font-mono text-[13px]"
                  style={{ height: 48, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                  <span style={{ color: 'var(--text-faint)' }}>{dns.type}</span>
                  <span className="truncate">{dns.name}</span>
                  <span style={{ color: 'var(--text-faint)' }}>→</span>
                  <span className="flex-1 min-w-0 truncate">{dns.value}</span>
                  <button
                    onClick={() => copy(dns.value, 'dns')}
                    className="text-[12.5px] px-3 py-1.5 rounded-lg shrink-0"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', cursor: 'pointer' }}
                  >{copied === 'dns' ? 'Copié' : 'Copier'}</button>
                </div>
              </div>
            )}

          </>
        )}
    </div>
  );
}

function DomainCard({
  icon, title, desc, cta, active, onClick, testid,
}: {
  icon: React.ReactNode; title: string; desc: string; cta: string;
  active: boolean; onClick: () => void; testid: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="text-left p-5 rounded-xl transition-colors"
      style={{
        background: 'var(--surface-1)',
        border: `1px solid ${active ? 'var(--border-hover)' : 'var(--border-subtle)'}`,
        cursor: 'pointer',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{icon}</span>
      <div className="text-[15px] font-medium mt-3" style={{ color: 'var(--text-primary)' }}>{title}</div>
      <div className="text-[13px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-faint)' }}>{desc}</div>
      <span
        className="inline-block text-[13px] font-medium mt-4 px-4 py-2 rounded-lg"
        style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
      >{cta}</span>
    </button>
  );
}
