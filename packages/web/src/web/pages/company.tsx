import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { getAuthToken } from '../lib/token';
import { api } from '../lib/api';
import { AnimatedCounter } from '../components/AnimatedCounter';
import { useBuildStore } from '../lib/build-store';
import { ProjectTabs } from '../components/ProjectTabs';
import { DomainsPanel } from '../components/DomainsPanel';


import { useVoiceInput } from '../lib/use-voice-input';
import { VoiceMicButton, VoiceOverlay } from '../components/VoiceMic';
import { useIsMobile } from '../lib/useIsMobile';

const ROLE_CONFIG: Record<string, { color: string; label: string }> = {
  ceo: { color: 'var(--text-primary)', label: 'CEO' },
  engineering: { color: '#3B82F6', label: 'Engineering' },
  marketing: { color: '#8B5CF6', label: 'Marketing' },
  support: { color: '#10B981', label: 'Support' },
  growth: { color: '#F59E0B', label: 'Growth' },
  browser: { color: '#EC4899', label: 'Browser' },
};

const PLATFORM_COLORS: Record<string, string> = {
  meta: '#1877F2', google: '#EA4335', tiktok: '#000', linkedin: '#0A66C2',
};

function timeAgo(date: Date | string | number) {
  const d = typeof date === 'number' ? date * 1000 : new Date(date).getTime();
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatCurrency(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

type Tab = 'website' | 'domains' | 'revenue' | 'agents' | 'tasks' | 'growth' | 'ads' | 'emails' | 'docs' | 'reports' | 'autopilot';

// Description simple de chaque onglet, affichée sous les onglets
const TAB_DESCRIPTIONS: Record<string, string> = {
  website: 'Your app: open it, share the link and track its status.',
  domains: 'Your addresses: sub-domain, buying a new domain and connecting one you already own.',
  revenue: "Money earned: total revenue and list of payments received.",
  agents: "What the AI has recently done for your business, step by step.",
  tasks: 'Ongoing and completed tasks, managed automatically.',
  growth: 'Full-auto growth engine: leads, emails, SMS, AI calls and follow-ups. Demo by default.',
  ads: 'Your ads: create campaigns and see their results.',
  emails: 'Your mailbox: receive, write and send emails.',
  docs: "Documents created for your business (plans, copy, ideas).",
  reports: "Summary reports: how your business is doing, in plain language.",
  autopilot: "Autopilot mode: the AI works on its own for you.",
};

// ─── Emails Tab Component ────────────────────────────────────────────────────
function EmailsTab({ companyId, emails, genLoading, generateEmail }: { companyId: string; emails: any[]; genLoading: string | null; generateEmail: (type: string) => void }) {
  const [emailTab, setEmailTab] = useState<'inbox' | 'sent' | 'compose' | 'config' | 'actions'>('inbox');
  const [inbox, setInbox] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [configForm, setConfigForm] = useState({ fromEmail: '', fromName: '', domain: '', replyTo: '' });
  const [savingConfig, setSavingConfig] = useState(false);
  const [composeForm, setComposeForm] = useState({ to: '', subject: '', body: '' });
  const emailVoice = useVoiceInput(useCallback((text: string) => setComposeForm(f => ({ ...f, body: text })), []));
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [thinkResult, setThinkResult] = useState<any>(null);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  useEffect(() => {
    setLoadingInbox(true);
    Promise.all([
      api.emails.inbox(companyId),
      api.emails.config.get(companyId),
      api.agentActions.list(companyId),
    ]).then(([inboxRes, configRes, actionsRes]) => {
      setInbox(inboxRes.inbox || []);
      if (configRes.config) { setConfig(configRes.config); setConfigForm({ fromEmail: configRes.config.fromEmail || '', fromName: configRes.config.fromName || '', domain: configRes.config.domain || '', replyTo: configRes.config.replyTo || '' }); }
      setActions(actionsRes.actions || []);
    }).finally(() => setLoadingInbox(false));
  }, [companyId]);

  async function saveConfig() {
    setSavingConfig(true);
    const res = await api.emails.config.set(companyId, configForm);
    if (res.config) setConfig(res.config);
    setSavingConfig(false);
  }

  async function sendEmail() {
    if (!composeForm.to || !composeForm.subject || !composeForm.body) return;
    setSending(true);
    await api.emails.send(companyId, composeForm);
    setComposeForm({ to: '', subject: '', body: '' });
    setSending(false);
    setEmailTab('sent');
  }

  async function triggerThink() {
    setThinking(true);
    setThinkResult(null);
    const res = await api.agentActions.think(companyId, 'Analyze the current situation and decide the best next actions.');
    setThinkResult(res);
    setThinking(false);
    // Refresh actions
    const actionsRes = await api.agentActions.list(companyId);
    setActions(actionsRes.actions || []);
  }

  const intentColors: Record<string, string> = { question: '#3B82F6', order: '#4EAADC', complaint: '#EF4444', supplier_reply: '#8B5CF6', partnership: '#F59E0B', spam: '#666', other: '#888' };
  const priorityColors: Record<string, string> = { urgent: '#EF4444', high: '#F59E0B', normal: '#888', low: '#555' };

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 mb-4">
        {[
          { key: 'inbox' as const, label: `Inbox (${inbox.length})`, icon: '↓' },
          { key: 'sent' as const, label: `Sent (${emails.length})`, icon: '↑' },
          { key: 'compose' as const, label: 'Compose', icon: '+' },
          { key: 'actions' as const, label: `AI Brain (${actions.length})`, icon: '◆' },
          { key: 'config' as const, label: 'Config', icon: '⚙' },
        ].map(t => (
          <button key={t.key} onClick={() => setEmailTab(t.key)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
            style={emailTab === t.key ? { background: 'var(--surface-4)', color: 'var(--text-secondary)', border: '1px solid var(--border-hover)' } : { color: 'var(--text-dim)' }}>
            <span className="mr-1">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Inbox */}
      {emailTab === 'inbox' && (
        <div className="space-y-1.5">
          {loadingInbox ? (
            <div className="flex items-center justify-center py-12 gap-1.5"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
          ) : inbox.length === 0 ? (
            <div className="p-8 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
              <p className="text-[13px] mb-2" style={{ color: 'var(--text-dim)' }}>No inbound emails yet.</p>
              <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>Emails sent to your company address will appear here. The AI agent will automatically analyze and respond.</p>
            </div>
          ) : inbox.map((email: any) => (
            <div key={email.id} className="rounded-lg cursor-pointer transition-colors" style={{ background: email.status === 'new' ? 'var(--surface-3)' : 'var(--surface-2)', border: `1px solid ${email.status === 'new' ? 'var(--border-hover)' : 'var(--border-default)'}` }}
              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}>
              <div className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  {email.status === 'new' && <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--teal)' }} />}
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>{email.fromName || email.fromEmail}</span>
                  {email.intent && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-1)', color: intentColors[email.intent] || 'var(--text-dim)' }}>{email.intent}</span>}
                  {email.priority && email.priority !== 'normal' && <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-bold" style={{ color: priorityColors[email.priority] || 'var(--text-dim)' }}>{email.priority}</span>}
                  {email.assignedAgent && <span className="text-[9px] font-mono ml-auto" style={{ color: 'var(--text-ghost)' }}>→ {email.assignedAgent}</span>}
                </div>
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>{email.subject}</p>
                {expandedEmail === email.id && (
                  <div className="mt-3 space-y-2">
                    <pre className="text-[11px] whitespace-pre-wrap leading-relaxed p-3 rounded" style={{ background: 'var(--surface-0)', color: 'var(--text-muted)' }}>{email.body?.slice(0, 500)}</pre>
                    {email.agentResponse && (
                      <div className="p-3 rounded" style={{ background: 'var(--green-subtle-bg)', border: '1px solid var(--green-subtle-border)' }}>
                        <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--teal)' }}>AI Agent Draft Reply ({email.agentAction})</p>
                        <pre className="text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-muted)' }}>{email.agentResponse}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sent */}
      {emailTab === 'sent' && (
        <div>
          <div className="flex gap-2 mb-4">
            {['cold_outreach', 'newsletter', 'follow_up'].map(t => (
              <button key={t} onClick={() => generateEmail(t)} disabled={!!genLoading}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium capitalize transition-colors disabled:opacity-30"
                style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                {genLoading === `email-${t}` ? 'Generating...' : `+ ${t.replace('_', ' ')}`}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            {emails.length === 0 ? (
              <div className="p-8 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No emails sent yet.</p>
              </div>
            ) : emails.map((email: any) => (
              <div key={email.id} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] capitalize px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{email.type?.replace('_', ' ')}</span>
                  <span className="text-[10px] font-mono" style={{ color: email.status === 'sent' ? '#4EAADC' : email.status === 'opened' ? '#F59E0B' : '#666' }}>{email.status}</span>
                  {email.recipientEmail && <span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>→ {email.recipientEmail}</span>}
                </div>
                <p className="text-[13px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{email.subject}</p>
                <pre className="text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-muted)' }}>{email.body?.slice(0, 300)}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compose */}
      {emailTab === 'compose' && (
        <div className="max-w-lg space-y-3">
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-dim)' }}>To</label>
            <input value={composeForm.to} onChange={e => setComposeForm(f => ({ ...f, to: e.target.value }))}
              placeholder="recipient@email.com" className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-dim)' }}>Subject</label>
            <input value={composeForm.subject} onChange={e => setComposeForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Email subject" className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>Body</label>
              <VoiceMicButton isListening={emailVoice.isListening} onClick={emailVoice.toggle} size={5} />
            </div>

            <div className="relative">
              {emailVoice.isListening && <VoiceOverlay voiceBars={emailVoice.voiceBars} />}
              <textarea value={composeForm.body} onChange={e => setComposeForm(f => ({ ...f, body: e.target.value }))}
                placeholder={emailVoice.isListening ? '' : "Write your email..."} rows={8} className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none"
                style={{ background: 'var(--surface-2)', border: `1px solid ${emailVoice.isListening ? 'var(--border-hover)' : 'var(--border-default)'}`, color: 'var(--text-secondary)', opacity: emailVoice.isListening ? 0.3 : 1, transition: 'opacity 0.2s, border-color 0.3s' }} />
            </div>
          </div>
          <button onClick={sendEmail} disabled={sending || !composeForm.to || !composeForm.subject}
            className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
            {sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      )}

      {/* AI Brain / Actions */}
      {emailTab === 'actions' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <button onClick={triggerThink} disabled={thinking}
              className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30 flex items-center gap-2"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
              {thinking ? (<><div className="flex gap-0.5"><div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--surface-0)' }} /><div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--surface-0)' }} /><div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--surface-0)' }} /></div> Thinking...</>) : '◆ Make AI Think'}
            </button>
            <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>The AI will analyze everything and decide the best next actions</span>
          </div>

          {thinkResult && (
            <div className="p-4 rounded-lg mb-4" style={{ background: 'var(--teal-subtle-bg)', border: '1px solid var(--teal-subtle-border)' }}>
              <p className="text-[10px] font-medium mb-2" style={{ color: 'var(--teal)' }}>AI REASONING</p>
              <p className="text-[12px] leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>{thinkResult.thinking}</p>
              {thinkResult.actions?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium" style={{ color: 'var(--teal)' }}>PLANNED ACTIONS</p>
                  {thinkResult.actions.map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--teal-inner)' }}>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-0)', color: 'var(--teal)' }}>{a.agent}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{a.description}</span>
                      <span className="text-[9px] ml-auto uppercase font-bold" style={{ color: a.priority === 'high' ? '#F59E0B' : '#666' }}>{a.priority}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            {actions.length === 0 ? (
              <div className="p-8 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No agent actions yet. Click "Make AI Think" to start.</p>
              </div>
            ) : actions.map((action: any) => (
              <div key={action.id} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--teal)' }}>{action.agentRole}</span>
                  <span className="text-[10px] capitalize" style={{ color: 'var(--text-dim)' }}>{action.actionType?.replace('_', ' ')}</span>
                  <span className="text-[9px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{action.status}</span>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{action.reasoning?.slice(0, 200)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Config */}
      {emailTab === 'config' && (
        <div className="max-w-lg space-y-3">
          <p className="text-[11px] mb-2" style={{ color: 'var(--text-dim)' }}>Configure the email address for this company. Inbound emails to this address will be automatically routed to the AI agent.</p>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-dim)' }}>Company Email</label>
            <input value={configForm.fromEmail} onChange={e => setConfigForm(f => ({ ...f, fromEmail: e.target.value }))}
              placeholder="mycompany@domain.com" className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-dim)' }}>From Name</label>
            <input value={configForm.fromName} onChange={e => setConfigForm(f => ({ ...f, fromName: e.target.value }))}
              placeholder="Company Name" className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-dim)' }}>Domain</label>
            <input value={configForm.domain} onChange={e => setConfigForm(f => ({ ...f, domain: e.target.value }))}
              placeholder="domain.com" className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-dim)' }}>Reply-To (optional)</label>
            <input value={configForm.replyTo} onChange={e => setConfigForm(f => ({ ...f, replyTo: e.target.value }))}
              placeholder="reply@domain.com" className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }} />
          </div>
          <button onClick={saveConfig} disabled={savingConfig || !configForm.fromEmail || !configForm.fromName}
            className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
            {savingConfig ? 'Saving...' : 'Save Config'}
          </button>
          {config && (
            <div className="p-3 rounded-lg mt-3" style={{ background: 'var(--green-subtle-bg)', border: '1px solid var(--green-subtle-border)' }}>
              <p className="text-[10px] font-medium" style={{ color: 'var(--teal)' }}>Active Config</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>{config.fromName} &lt;{config.fromEmail}&gt;</p>
              {config.domain && <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Domain: {config.domain}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GrowthTab({ companyId }: { companyId: string }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [outreach, setOutreach] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const [s, l, o] = await Promise.all([
      api.growth.status(companyId),
      api.growth.leads(companyId),
      api.growth.outreach(companyId),
    ]);
    setStatus(s);
    setLeads(l.leads || []);
    setOutreach(o.outreach || []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function launchCampaign() {
    setRunning(true);
    await api.growth.campaign(companyId, { count: 8, goal: 'full-auto prospecting' });
    await load();
    setRunning(false);
  }

  async function generateLeads() {
    setRunning(true);
    await api.growth.generateLeads(companyId, 8);
    await load();
    setRunning(false);
  }

  const providerLabels = [
    ['Email', status?.providers?.email], ['SMS', status?.providers?.sms], ['AI Calls', status?.providers?.call],
  ];
  const byStatus = outreach.reduce((acc: any, x: any) => { acc[x.status] = (acc[x.status] || 0) + 1; return acc; }, {});

  if (loading) return <div className="p-10 text-center text-sm" style={{ color: 'var(--text-dim)' }}>Loading growth...</div>;

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(78,170,220,0.08))', border: '1px solid var(--border-default)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Growth Engine</h3>
              {status?.demoMode && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: '#F59E0B22', color: '#F59E0B', border: '1px solid #F59E0B33' }}>DEMO $0</span>}
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)', border: '1px solid var(--border-default)' }}>Full auto</span>
            </div>
            <p className="text-[12px] max-w-2xl" style={{ color: 'var(--text-dim)' }}>Agents find demo leads, contact them by email/SMS/AI call, then create automatic follow-ups. No real spending until provider keys are configured.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={generateLeads} disabled={running} className="px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>+ Demo leads</button>
            <button onClick={launchCampaign} disabled={running} className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>{running ? 'Launching...' : 'Launch full-auto campaign'}</button>
          </div>
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          {providerLabels.map(([label, ok]: any) => (
            <span key={label} className="text-[10px] px-2 py-1 rounded-full" style={{ background: ok ? 'var(--green-subtle-bg)' : 'var(--surface-2)', color: ok ? 'var(--teal)' : 'var(--text-dim)', border: `1px solid ${ok ? 'var(--green-subtle-border)' : 'var(--border-default)'}` }}>{label}: {ok ? 'real' : 'demo'}</span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Leads', value: leads.length, color: '#F59E0B' },
          { label: 'Actions', value: outreach.length, color: '#4EAADC' },
          { label: 'Demo', value: byStatus.demo || 0, color: 'var(--teal)' },
          { label: 'Skipped', value: byStatus.skipped || 0, color: '#888' },
        ].map(k => <div key={k.label} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}><div className="text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>{k.label}</div><div className="text-xl font-semibold" style={{ color: k.color }}>{k.value}</div></div>)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <h4 className="text-[12px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Leads</h4>
          <div className="space-y-1.5 max-h-[520px] overflow-auto pr-1">
            {leads.length === 0 ? <div className="p-8 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)', color: 'var(--text-dim)' }}>Aucun lead. Clique “+ Demo leads”.</div> : leads.map((lead: any) => (
              <div key={lead.id} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                <div className="flex items-center gap-2"><span className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>{lead.name}</span><span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: '#F59E0B' }}>score {lead.score}</span><span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{lead.status}</span></div>
                <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{lead.contactName} · {lead.email || 'no email'} · {lead.phone || 'no phone'}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{lead.notes}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-[12px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Autonomous actions</h4>
          <div className="space-y-1.5 max-h-[520px] overflow-auto pr-1">
            {outreach.length === 0 ? <div className="p-8 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)', color: 'var(--text-dim)' }}>No actions yet. Launch a campaign.</div> : outreach.map((a: any) => (
              <div key={a.id} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                <div className="flex items-center gap-2 mb-1"><span className="text-[10px] uppercase font-medium" style={{ color: a.status === 'demo' ? '#F59E0B' : 'var(--teal)' }}>{a.channel}</span><span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{a.status}</span><span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{a.provider}</span></div>
                {a.subject && <p className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{a.subject}</p>}
                <p className="text-[11px] whitespace-pre-wrap" style={{ color: 'var(--text-dim)' }}>{(a.transcript || a.body || a.error || '').slice(0, 260)}</p>
                {a.mediaUrl && <p className="text-[10px] mt-1" style={{ color: 'var(--teal)' }}>{a.mediaUrl}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BuildingWebsitePreview({ companyId, activities }: { companyId: string; activities: any[] }) {
  const [builtPages, setBuiltPages] = useState<Array<{ slug: string; title: string; htmlContent: string }>>([]);
  const [activeThumb, setActiveThumb] = useState<string | null>(null);
  const seenSlugsRef = useRef(new Set<string>());
  const [newPageSlug, setNewPageSlug] = useState<string | null>(null);

  // Poll for newly built pages during the build
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.companies.pages(companyId);
        if (cancelled) return;
        const pages = (res.pages || []).filter((p: any) => p.htmlContent && (!p.lang || p.lang === ''));
        for (const p of pages) {
          if (!seenSlugsRef.current.has(p.slug)) {
            seenSlugsRef.current.add(p.slug);
            setNewPageSlug(p.slug);
            setTimeout(() => setNewPageSlug(null), 1200);
          }
        }
        setBuiltPages(pages);
        if (pages.length > 0 && !activeThumb) {
          setActiveThumb(pages[0].slug);
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [companyId]);

  const activePage = builtPages.find(p => p.slug === activeThumb);
  const lastActivity = activities.length > 0 ? activities[activities.length - 1] : null;
  const currentTask = lastActivity?.message || 'Building website...';

  return (
    <div className="w-full rounded-xl overflow-hidden" style={{ height: 600, background: 'var(--surface-0)', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column' }}>
      {/* Main preview area */}
      <div className="flex-1 overflow-hidden relative">
        {activePage ? (
          <iframe
            key={activePage.slug}
            srcDoc={activePage.htmlContent}
            className="w-full h-full page-preview-enter"
            style={{ border: 'none', pointerEvents: 'none' }}
            title={`Preview: ${activePage.title}`}
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="p-6 space-y-6 animate-fade-in">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="skeleton-bar h-4 rounded" style={{ width: 120 }} />
              <div className="flex gap-4">
                <div className="skeleton-bar h-3 rounded" style={{ width: 50 }} />
                <div className="skeleton-bar h-3 rounded" style={{ width: 50 }} />
                <div className="skeleton-bar h-7 rounded-md" style={{ width: 80 }} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-4 py-10 px-8">
              <div className="skeleton-bar h-8 rounded" style={{ width: '75%' }} />
              <div className="skeleton-bar h-8 rounded" style={{ width: '55%' }} />
              <div className="skeleton-bar h-4 rounded" style={{ width: '60%', marginTop: 8 }} />
              <div className="flex gap-3 mt-4">
                <div className="skeleton-bar h-10 rounded-lg" style={{ width: 130 }} />
                <div className="skeleton-bar h-10 rounded-lg" style={{ width: 110 }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 px-6 mt-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-5 rounded-xl space-y-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                  <div className="skeleton-bar h-8 w-8 rounded-lg" />
                  <div className="skeleton-bar h-4 rounded" style={{ width: '70%' }} />
                  <div className="skeleton-bar h-3 rounded" style={{ width: '90%' }} />
                </div>
              ))}
            </div>
            <div className="build-shimmer-sweep" />
          </div>
        )}

        {/* Live building indicator overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#4EAADC' }} />
          <span className="text-[11px] font-medium" style={{ color: '#fff' }}>Building live...</span>
        </div>
      </div>

      {/* Thumbnail strip */}
      {builtPages.length > 0 && (
        <div className="shrink-0 px-3 py-2 flex gap-2 overflow-x-auto" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)' }}>
          {builtPages.map((p) => (
            <button
              key={p.slug}
              onClick={() => setActiveThumb(p.slug)}
              className={`shrink-0 rounded-md overflow-hidden transition-all duration-300 ${newPageSlug === p.slug ? 'page-thumb-enter' : ''}`}
              style={{
                width: 100, height: 64,
                border: activeThumb === p.slug ? '2px solid var(--purple)' : '1px solid var(--border-default)',
                opacity: activeThumb === p.slug ? 1 : 0.6,
                transform: activeThumb === p.slug ? 'scale(1.05)' : 'scale(1)',
                position: 'relative',
              }}
              title={p.title}
            >
              <iframe
                srcDoc={p.htmlContent}
                style={{ width: 1280, height: 820, transform: 'scale(0.078)', transformOrigin: 'top left', pointerEvents: 'none', border: 'none', display: 'block' }}
                tabIndex={-1}
                sandbox="allow-same-origin"
              />
              <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
                <span className="text-[8px] font-medium truncate block" style={{ color: '#fff' }}>{p.title}</span>
              </div>
            </button>
          ))}
          {[1, 2, 3].slice(0, Math.max(0, 3 - builtPages.length)).map(i => (
            <div key={`ph-${i}`} className="shrink-0 rounded-md overflow-hidden" style={{ width: 100, height: 64, background: 'var(--surface-3)', border: '1px dashed var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--text-ghost)', borderTopColor: 'transparent' }} />
            </div>
          ))}
        </div>
      )}

      {/* Bottom status bar */}
      <div className="shrink-0 px-4 pb-3 pt-2" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-[11px] mb-2 truncate" style={{ color: 'var(--text-dim)' }}>
          {currentTask}
        </p>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-dim)' }}>
            {builtPages.length > 0 ? `${builtPages.length} page${builtPages.length > 1 ? 's' : ''} built` : 'Building...'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Autopilot Tab Component ──────────────────────────────────────────────────
function AutopilotTab({ companyId, onStatusChange }: { companyId: string; onStatusChange?: (s: any) => void }) {
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [awaySummary, setAwaySummary] = useState<any>(null);
  const [showAwaySummary, setShowAwaySummary] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [subTab, setSubTab] = useState<'overview' | 'logs' | 'insights' | 'tasks'>('overview');
  const { user } = useAuth();

  const fetchAll = async () => {
    try {
      const token = getAuthToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [s, l, i, t] = await Promise.all([
        fetch(`/api/companies/${companyId}/autopilot/status`, { headers }).then(r => r.json()),
        fetch(`/api/companies/${companyId}/autopilot/logs`, { headers }).then(r => r.json()),
        fetch(`/api/companies/${companyId}/autopilot/insights`, { headers }).then(r => r.json()),
        fetch(`/api/companies/${companyId}/autopilot/tasks`, { headers }).then(r => r.json()),
      ]);
      setStatus(s);
      onStatusChange?.(s);
      setLogs(Array.isArray(l) ? l : []);
      setInsights(Array.isArray(i) ? i : []);
      setTasks(Array.isArray(t) ? t : []);
    } catch (e) { console.error('Autopilot fetch error:', e); }
    setLoading(false);
  };

  // On first load: check "while you were away" — use last visit timestamp
  useEffect(() => {
    const lastVisitKey = `autopilot_last_visit_${companyId}`;
    const lastVisit = localStorage.getItem(lastVisitKey);
    
    // Fetch activity since last visit
    if (lastVisit) {
      const token = getAuthToken();
      fetch(`/api/companies/${companyId}/autopilot/activity-since?since=${lastVisit}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).then(summary => {
        if (summary.totalActions > 0) {
          setAwaySummary(summary);
          setShowAwaySummary(true);
        }
      }).catch(() => {});
    }

    // Update last visit timestamp now
    localStorage.setItem(lastVisitKey, Date.now().toString());
    
    // Also update on page unload
    const handleUnload = () => localStorage.setItem(lastVisitKey, Date.now().toString());
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [companyId]);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 15000); return () => clearInterval(iv); }, [companyId]);

  const toggle = async (action: 'enable' | 'disable') => {
    setToggling(true);
    const token = getAuthToken();
    await fetch(`/api/companies/${companyId}/autopilot/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    await fetchAll();
    setToggling(false);
  };

  const toggleApproval = async () => {
    const token = getAuthToken();
    await fetch(`/api/companies/${companyId}/autopilot/approval-mode`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !status?.approvalMode }),
    });
    await fetchAll();
  };

  const triggerNow = async () => {
    const token = getAuthToken();
    await fetch(`/api/companies/${companyId}/autopilot/trigger`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    setTimeout(fetchAll, 3000);
  };

  const handleApprove = async (taskId: string) => {
    const token = getAuthToken();
    await fetch(`/api/companies/${companyId}/autopilot/tasks/${taskId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    await fetchAll();
  };

  const handleReject = async (taskId: string) => {
    const token = getAuthToken();
    await fetch(`/api/companies/${companyId}/autopilot/tasks/${taskId}/reject`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Rejected by user' }),
    });
    await fetchAll();
  };

  if (loading) return <div className="p-10 text-center text-sm" style={{ color: 'var(--text-dim)' }}>Loading autopilot...</div>;

  const isEnabled = status?.enabled;
  const awaitingApproval = tasks.filter((t: any) => t.status === 'waiting_approval');

  const levelColor = (l: string) => {
    if (l === 'success') return '#10B981';
    if (l === 'error') return '#EF4444';
    if (l === 'warning') return '#F59E0B';
    return 'var(--text-dim)';
  };

  const severityColor = (s: string) => {
    if (s === 'critical') return '#EF4444';
    if (s === 'warning') return '#F59E0B';
    if (s === 'positive') return '#10B981';
    return 'var(--text-dim)';
  };

  const statusColor = (s: string) => {
    if (s === 'completed') return '#10B981';
    if (s === 'failed' || s === 'rejected') return '#EF4444';
    if (s === 'running') return '#3B82F6';
    if (s === 'waiting_approval') return '#F59E0B';
    if (s === 'pending') return 'var(--text-dim)';
    return 'var(--text-ghost)';
  };

  return (
    <div className="space-y-4">
      {/* CSS for pulse animation */}
      <style>{`
        @keyframes autopilot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
        @keyframes autopilot-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .autopilot-working-dot {
          animation: autopilot-pulse 1.5s ease-in-out infinite;
        }
        .autopilot-spinner {
          animation: autopilot-spin 2s linear infinite;
        }
      `}</style>

      {/* "While you were away" banner */}
      {awaySummary && showAwaySummary && awaySummary.totalActions > 0 && (
        <div className="p-4 rounded-xl relative" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', border: '1px solid rgba(99,102,241,0.2)' }}>
          <button onClick={() => setShowAwaySummary(false)} className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-[12px] hover:bg-[var(--surface-4)]" style={{ color: 'var(--text-dim)' }}>✕</button>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[14px]">🌙</span>
            <h4 className="text-[13px] font-semibold" style={{ color: '#818CF8' }}>While you were away</h4>
            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#818CF8' }}>
              {awaySummary.totalActions} actions
            </span>
          </div>

          {/* Completed tasks */}
          {awaySummary.completedTasks?.length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] font-medium mb-1" style={{ color: '#10B981' }}>Completed:</p>
              <div className="flex flex-wrap gap-1">
                {awaySummary.completedTasks.slice(0, 5).map((t: any) => (
                  <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981' }}>
                    {t.agent}: {t.title}
                  </span>
                ))}
                {awaySummary.completedTasks.length > 5 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}>
                    +{awaySummary.completedTasks.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* New insights */}
          {awaySummary.newInsights?.length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] font-medium mb-1" style={{ color: '#F59E0B' }}>New insights:</p>
              <div className="flex flex-wrap gap-1">
                {awaySummary.newInsights.slice(0, 3).map((i: any) => (
                  <span key={i.id} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${severityColor(i.severity)}15`, color: severityColor(i.severity) }}>
                    {i.title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Agent activity breakdown */}
          {awaySummary.agentSummary && Object.keys(awaySummary.agentSummary).length > 0 && (
            <div className="flex gap-3 mt-2 pt-2" style={{ borderTop: '1px solid rgba(99,102,241,0.1)' }}>
              {Object.entries(awaySummary.agentSummary).map(([agent, count]) => (
                <span key={agent} className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  {agent === 'strategist' ? '🧠' : agent === 'content' ? '✍️' : agent === 'marketing' ? '📣' : agent === 'analytics' ? '📊' : '⚙️'} {agent}: {count as number} actions
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Currently working indicator */}
      {status?.isWorking && status?.currentTask && (
        <div className="p-3 rounded-xl flex items-center gap-3" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.12)' }}>
            <div className="w-3 h-3 rounded-full border-2 border-t-transparent autopilot-spinner" style={{ borderColor: '#3B82F6', borderTopColor: 'transparent' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium" style={{ color: '#3B82F6' }}>
              AI is working right now
            </p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>
              {status.currentTask.agent} — {status.currentTask.title}
            </p>
          </div>
          <div className="w-2 h-2 rounded-full shrink-0 autopilot-working-dot" style={{ background: '#3B82F6' }} />
        </div>
      )}

      {/* Header */}
      <div className="p-5 rounded-xl" style={{ background: isEnabled ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08))' : 'var(--surface-2)', border: `1px solid ${isEnabled ? 'rgba(16,185,129,0.2)' : 'var(--border-default)'}` }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: isEnabled ? 'rgba(16,185,129,0.15)' : 'var(--surface-4)' }}>
              {isEnabled ? '⚡' : '⏸️'}
            </div>
            <div>
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-secondary)' }}>AI Autopilot</h3>
              <p className="text-[11px]" style={{ color: isEnabled ? '#10B981' : 'var(--text-dim)' }}>
                {isEnabled 
                  ? (status?.isWorking 
                    ? `Working now — ${status.currentTask?.title || 'processing...'}` 
                    : `Active — ${status?.completedToday || 0} tasks done today`)
                  : 'Paused — click Enable to start'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEnabled && (
              <button onClick={triggerNow} className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors"
                style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}>
                Run Now
              </button>
            )}
            <button onClick={() => toggle(isEnabled ? 'disable' : 'enable')} disabled={toggling}
              className="text-[12px] px-4 py-2 rounded-lg font-semibold transition-colors"
              style={{ background: isEnabled ? '#EF4444' : '#10B981', color: '#fff', opacity: toggling ? 0.5 : 1 }}>
              {toggling ? '...' : isEnabled ? 'Disable' : 'Enable Autopilot'}
            </button>
          </div>
        </div>

        {isEnabled && (
          <div className="flex items-center gap-4 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={status?.approvalMode || false} onChange={toggleApproval}
                className="w-4 h-4 rounded accent-amber-500" />
              <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>Approval mode (AI asks before acting)</span>
            </label>
            {status?.lastTick && (
              <span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>
                Last tick: {timeAgo(status.lastTick)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Awaiting Approval */}
      {awaitingApproval.length > 0 && (
        <div className="p-4 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <h4 className="text-[12px] font-semibold mb-2" style={{ color: '#F59E0B' }}>⏳ Awaiting Your Approval ({awaitingApproval.length})</h4>
          <div className="space-y-2">
            {awaitingApproval.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--surface-2)' }}>
                <div>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{t.title}</span>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{t.description?.slice(0, 100)}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded mt-1 inline-block" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{t.agent}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleApprove(t.id)} className="text-[11px] px-3 py-1.5 rounded-lg font-medium" style={{ background: '#10B981', color: '#fff' }}>Approve</button>
                  <button onClick={() => handleReject(t.id)} className="text-[11px] px-3 py-1.5 rounded-lg font-medium" style={{ background: '#EF4444', color: '#fff' }}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Plan */}
      {status?.todayPlan && (
        <div className="p-4 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>📋 Today's Plan</h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-4)', color: 'var(--text-dim)' }}>
              {status.todayPlan.progress} tasks
            </span>
          </div>
          <p className="text-[12px] mb-2" style={{ color: 'var(--text-muted)' }}>{status.todayPlan.summary}</p>
          {status.todayPlan.goals?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {status.todayPlan.goals.map((g: string, i: number) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.1)', color: '#3B82F6' }}>{g}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub tabs */}
      <div className="flex gap-1">
        {(['overview', 'tasks', 'logs', 'insights'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors capitalize"
            style={subTab === t ? { background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' } : { color: 'var(--text-dim)' }}>
            {t}{t === 'tasks' ? ` (${tasks.length})` : t === 'insights' ? ` (${insights.length})` : ''}
          </button>
        ))}
      </div>

      {/* Overview */}
      {subTab === 'overview' && (
        <div className="space-y-2">
          {status?.recentActivity?.length > 0 ? status.recentActivity.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--surface-2)' }}>
              <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: levelColor(a.level) }} />
              <div className="min-w-0 flex-1">
                <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{a.message}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{a.agent}</span>
                  {a.time && <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{timeAgo(a.time)}</span>}
                </div>
              </div>
            </div>
          )) : (
            <div className="p-8 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
              <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>{isEnabled ? 'Waiting for first tick...' : 'Enable autopilot to see activity'}</p>
            </div>
          )}
        </div>
      )}

      {/* Tasks */}
      {subTab === 'tasks' && (
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <div className="p-8 text-center rounded-xl" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
              <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>No tasks yet</p>
            </div>
          ) : tasks.map((t: any) => (
            <div key={t.id} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', borderLeft: `3px solid ${statusColor(t.status)}` }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{t.title}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded capitalize" style={{ background: `${statusColor(t.status)}20`, color: statusColor(t.status) }}>{t.status.replace('_', ' ')}</span>
              </div>
              {t.description && <p className="text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>{t.description.slice(0, 150)}</p>}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{t.agent}</span>
                <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{t.type}</span>
                {t.createdAt && <span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{timeAgo(t.createdAt)}</span>}
              </div>
              {t.status === 'waiting_approval' && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handleApprove(t.id)} className="text-[10px] px-2.5 py-1 rounded font-medium" style={{ background: '#10B981', color: '#fff' }}>Approve</button>
                  <button onClick={() => handleReject(t.id)} className="text-[10px] px-2.5 py-1 rounded font-medium" style={{ background: '#EF4444', color: '#fff' }}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Logs */}
      {subTab === 'logs' && (
        <div className="space-y-1">
          {logs.length === 0 ? (
            <div className="p-8 text-center rounded-xl" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
              <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>No activity logs yet</p>
            </div>
          ) : logs.map((l: any) => (
            <div key={l.id} className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-[var(--surface-2)]">
              <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: levelColor(l.level) }} />
              <div className="min-w-0 flex-1">
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l.message}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{l.agent}</span>
                  <span className="text-[9px]" style={{ color: 'var(--text-ghost)' }}>{l.action}</span>
                  {l.createdAt && <span className="text-[9px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{timeAgo(l.createdAt)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {subTab === 'insights' && (
        <div className="space-y-2">
          {insights.length === 0 ? (
            <div className="p-8 text-center rounded-xl" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
              <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>No insights yet — the AI will discover them over time</p>
            </div>
          ) : insights.map((ins: any) => (
            <div key={ins.id} className="p-4 rounded-lg" style={{ background: 'var(--surface-2)', borderLeft: `3px solid ${severityColor(ins.severity)}` }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded capitalize font-medium" style={{ background: `${severityColor(ins.severity)}15`, color: severityColor(ins.severity) }}>{ins.severity}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{ins.category}</span>
              </div>
              <h5 className="text-[13px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{ins.title}</h5>
              <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{ins.description}</p>
              {ins.recommendation && (
                <p className="text-[11px] mt-1.5 p-2 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
                  💡 {ins.recommendation}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();
  const [data, setData] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const [heartbeatLoading, setHeartbeatLoading] = useState(false);
  const [genLoading, setGenLoading] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [tab, setTab] = useState<Tab>(() => {
    // Permet d'arriver directement sur un onglet via ?tab=… (la popup Publish
    // renvoie vers /company/:id?tab=domains).
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    const allowed: Tab[] = ['website', 'domains', 'revenue', 'agents', 'tasks', 'growth', 'ads', 'emails', 'docs', 'reports', 'autopilot'];
    return (allowed as string[]).includes(q || '') ? (q as Tab) : 'website';
  });

  const [runningJobs, setRunningJobs] = useState<any[]>([]);
  const [autopilotStatus, setAutopilotStatus] = useState<any>(null);
  const [iframeWidthPct, setIframeWidthPct] = useState(100);
  const iframeContainerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [mobPreviewScale, setMobPreviewScale] = useState(0.3);
  const [websitePages, setWebsitePages] = useState<any[]>([]);
  const [activePageSlug, setActivePageSlug] = useState('index');
  const [companyLangs, setCompanyLangs] = useState<string[]>([]);
  const isDraggingRef = useRef(false);
  const [showLinksPopup, setShowLinksPopup] = useState(false);
  const [detectedLinks, setDetectedLinks] = useState<Array<{type: string; label: string; url: string}>>([]);
  const [linkValues, setLinkValues] = useState<Record<string, string>>({});
  const [savingLinks, setSavingLinks] = useState(false);
  const linksCheckedRef = useRef(false);

  useEffect(() => {
    if (!user || !id) return;
    api.companies.get(id).then(res => { if (!res.error) setData(res); setFetching(false); });
    api.companies.pages(id).then(res => { if (res.pages) setWebsitePages(res.pages); }).catch(() => {});
    api.companies.languages.get(id).then(res => { if (res.languages) { setCompanyLangs(res.languages); } }).catch(() => {});
    // Fetch autopilot status (works even when not on autopilot tab)
    const token = getAuthToken();
    fetch(`/api/companies/${id}/autopilot/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(s => setAutopilotStatus(s)).catch(() => {});
    // Poll autopilot status every 20s to keep indicator fresh
    const apInterval = setInterval(() => {
      const tk = getAuthToken();
      fetch(`/api/companies/${id}/autopilot/status`, { headers: { Authorization: `Bearer ${tk}` } })
        .then(r => r.json()).then(s => setAutopilotStatus(s)).catch(() => {});
    }, 20000);
    // Check for running background jobs
    let jobIv: ReturnType<typeof setInterval> | null = null;
    api.companies.jobs(id).then(res => {
      const active = (res.jobs || []).filter((j: any) => j.status === 'running' || j.status === 'queued');
      setRunningJobs(active);
      if (active.length > 0) {
        // Poll until jobs finish
        jobIv = setInterval(async () => {
          const r = await api.companies.jobs(id).catch(() => ({ jobs: [] }));
          const stillActive = (r.jobs || []).filter((j: any) => j.status === 'running' || j.status === 'queued');
          setRunningJobs(stillActive);
          if (stillActive.length === 0) {
            if (jobIv) clearInterval(jobIv);
            // Refresh data now that jobs are done
            const updated = await api.companies.get(id);
            if (!updated.error) setData(updated);
          }
        }, 4000);
      }
    }).catch(() => {});
    return () => { clearInterval(apInterval); if (jobIv) clearInterval(jobIv); };
  }, [user, id]);

  // Auto-refresh activity feed
  useEffect(() => {
    if (!user || !id) return;
    const iv = setInterval(() => {
      api.companies.get(id).then(res => { if (!res.error) setData(res); });
    }, 30000);
    return () => clearInterval(iv);
  }, [user, id]);

  // Tant que la description IA n'est pas prête, on rafraîchit vite pour l'afficher
  // dès qu'elle arrive (le back la génère en tâche de fond).
  const companyDesc = (data as any)?.company?.description;
  const companyName = (data as any)?.company?.name;
  useEffect(() => {
    if (!user || !id) return;
    if (companyDesc || companyName === 'Nouveau projet') return;
    const iv = setInterval(() => {
      api.companies.get(id).then(res => { if (!res.error) setData(res); });
    }, 3000);
    return () => clearInterval(iv);
  }, [user, id, companyDesc, companyName]);

  // Refresh data when a build completes for this company
  const build = useBuildStore();
  const prevBuildReady = useRef(false);
  useEffect(() => {
    if (build.websiteReady && !prevBuildReady.current && build.companyId === id) {
      // Build just completed — refresh company data immediately
      setTimeout(() => {
        api.companies.get(id!).then(res => { if (!res.error) setData(res); });
        api.companies.pages(id!).then(res => { if (res.pages) setWebsitePages(res.pages); }).catch(() => {});
        // Check for link placeholders
        api.companies.websiteLinks.get(id!).then(res => {
          if (res.links && res.links.length > 0) {
            setDetectedLinks(res.links);
            const vals: Record<string, string> = {};
            res.links.forEach((l: any) => { vals[l.type] = l.url || ''; });
            setLinkValues(vals);
            setShowLinksPopup(true);
          }
        }).catch(() => {});
      }, 2500);
    }
    prevBuildReady.current = build.websiteReady;
  }, [build.websiteReady, build.companyId, id]);

  async function runHeartbeat() {
    setHeartbeatLoading(true);
    // Fire-and-forget, then poll for completion
    await api.companies.heartbeat(id!).catch(() => {});
    const pollUntilDone = async () => {
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await api.companies.jobs(id!).catch(() => ({ jobs: [] }));
        const hbJob = (res.jobs || []).find((j: any) => j.type === 'heartbeat');
        if (!hbJob || hbJob.status === 'completed' || hbJob.status === 'failed') break;
      }
    };
    await pollUntilDone();
    const updated = await api.companies.get(id!);
    if (!updated.error) setData(updated);
    setHeartbeatLoading(false);
  }

  async function generateDoc(type: string) {
    setGenLoading(type);
    const res = await api.documents.generate({ companyId: id!, type });
    if (res.document) {
      setData((prev: any) => prev ? { ...prev, documents: [res.document, ...prev.documents] } : prev);
      setSelectedDoc(res.document);
    }
    setGenLoading(null);
  }

  async function generateEmail(type: string) {
    setGenLoading(`email-${type}`);
    const res = await api.emails.generate(id!, type);
    if (res.email) {
      setData((prev: any) => prev ? { ...prev, emails: [res.email, ...(prev.emails || [])] } : prev);
    }
    setGenLoading(null);
  }

  async function generateAd(platform: string) {
    setGenLoading(`ad-${platform}`);
    const res = await api.ads.generate(id!, platform);
    if (res.ad) {
      setData((prev: any) => prev ? { ...prev, ads: [res.ad, ...(prev.ads || [])] } : prev);
    }
    setGenLoading(null);
  }

  if (loading || fetching) return (
    <div className="min-h-screen" style={{ background: 'var(--surface-0)' }}>
      <div className="px-5 pt-3 pb-1" style={{ position: 'relative', zIndex: 10 }}>
        <ProjectTabs projectId={id!} active="dashboard" />
      </div>
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 60px)' }}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
          <span className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading...</span>
        </div>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen" style={{ background: 'var(--surface-0)' }}>
      <div className="px-5 pt-3 pb-1" style={{ position: 'relative', zIndex: 10 }}>
        <ProjectTabs projectId={id!} active="dashboard" />
      </div>
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 60px)' }}>
        <div className="text-center">
          <p className="mb-4" style={{ color: 'var(--text-faint)' }}>Company not found.</p>
          <Link href="/dashboard"><button className="text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>Back</button></Link>
        </div>
      </div>
    </div>
  );

  const { company, agents = [], tasks = [], documents = [], activity = [], reports = [], memory = [], emails = [], ads = [], revenue = [], skills = [] } = data;

  const totalAdSpend = ads.reduce((s: number, a: any) => s + (a.spend || 0), 0);
  const totalImpressions = ads.reduce((s: number, a: any) => s + (a.impressions || 0), 0);
  const totalClicks = ads.reduce((s: number, a: any) => s + (a.clicks || 0), 0);
  const totalConversions = ads.reduce((s: number, a: any) => s + (a.conversions || 0), 0);

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-0)' }}>
      {/* Project Tabs */}
      <div className="px-5 pt-3 pb-1" style={{ position: 'relative', zIndex: 10 }}>
        <ProjectTabs projectId={id!} active="dashboard" />
      </div>
      <div className="max-w-5xl mx-auto px-6 pb-6 pt-2">

        {/* Header */}
        <div className="flex items-start justify-between mb-5 mt-1">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {company.logo ? (
                <img src={company.logo} alt={company.name} className="w-9 h-9 rounded-lg object-contain shrink-0" style={{ background: 'var(--surface-3)' }} />
              ) : null}
              <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{company.name}</h1>
              <span className={`status-dot ${company.status === 'active' ? 'live' : 'idle'}`} />
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ color: 'var(--text-faint)', border: '1px solid var(--border-default)' }}>Day {company.heartbeatCount || 1}</span>
              <button
                onClick={async () => {
                  const newVal = !company.autoHeartbeat;
                  // Turning it ON spends real AI credits automatically every hour,
                  // forever, with no further action from the user — always confirm.
                  if (newVal) {
                    const ok = window.confirm(
                      "Enable Auto Heartbeat?\n\nYour AI agents will work on their own and automatically consume credits every hour, even when you're not logged in. You can turn it off at any time with this same button."
                    );
                    if (!ok) return;
                  }
                  // Optimistic update
                  setData((prev: any) => prev ? { ...prev, company: { ...prev.company, autoHeartbeat: newVal ? 1 : 0 } } : prev);
                  await api.companies.autoHeartbeat.toggle(id!, newVal).catch(() => {
                    // Revert on error
                    setData((prev: any) => prev ? { ...prev, company: { ...prev.company, autoHeartbeat: company.autoHeartbeat } } : prev);
                  });
                }}
                className="text-[10px] px-2 py-0.5 rounded-full transition-all cursor-pointer"
                style={{
                  color: company.autoHeartbeat ? 'var(--teal)' : 'var(--text-ghost)',
                  border: `1px solid ${company.autoHeartbeat ? 'var(--teal-subtle-border)' : 'var(--border-default)'}`,
                  opacity: company.autoHeartbeat ? 1 : 0.7,
                }}
                title={company.autoHeartbeat ? 'Auto heartbeat ON — consumes credits every hour. Click to disable' : 'Auto heartbeat OFF — no credits used automatically. Click to enable'}
              >
                {company.autoHeartbeat ? '🔴 Auto ON' : 'Auto ✗'}
              </button>
            </div>
            {company.description ? (
              <p className="text-sm max-w-xl" style={{ color: 'var(--text-dim)' }}>{company.description}</p>
            ) : (
              <div className="flex items-center gap-2 max-w-xl" style={{ color: 'var(--text-faint)' }}>
                <div className="flex gap-1"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
                <span className="text-sm">Generating description…</span>
              </div>
            )}
            {/* Status mini-bar */}
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{agents.length} agents</span>
              <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{tasks.length} tasks</span>
              {(company.totalRevenue || 0) > 0 && (
                <>
                  <span className="text-[11px]" style={{ color: 'var(--teal)' }}>Revenue {formatCurrency(company.totalRevenue || 0)}</span>
                </>
              )}
            </div>
          </div>
          <button onClick={runHeartbeat} disabled={heartbeatLoading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-30"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
            {heartbeatLoading ? (
              <><div className="flex gap-0.5"><div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--surface-0)' }} /><div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--surface-0)' }} /><div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--surface-0)' }} /></div> Running...</>
            ) : 'Run Heartbeat'}
          </button>
        </div>

        {/* Running Jobs Banner */}
        {runningJobs.length > 0 && (
          <div className="mb-3 px-3 py-2 rounded-lg flex items-center gap-2 text-[13px]" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="flex gap-0.5">
              <div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--teal)' }} />
              <div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--teal)' }} />
              <div className="typing-dot" style={{ width: 4, height: 4, background: 'var(--teal)' }} />
            </div>
            <span style={{ color: 'var(--text-dim)' }}>
              {runningJobs.map((j: any) => j.type === 'initialize' ? 'Setting up agents' : j.type === 'build-website' ? 'Building website' : j.type === 'heartbeat' ? 'Running heartbeat' : j.type).join(', ')} in progress...
            </span>
          </div>
        )}

        {/* Autopilot working banner (visible from any tab) */}
        {autopilotStatus?.isWorking && tab !== 'autopilot' && (
          <div onClick={() => setTab('autopilot')} className="mb-3 px-3 py-2 rounded-lg flex items-center gap-2 cursor-pointer transition-colors hover:opacity-80"
            style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)' }}>
            <style>{`@keyframes ap-dot-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: '#3B82F6', animation: 'ap-dot-pulse 1.5s ease-in-out infinite' }} />
            <span className="text-[11px] font-medium" style={{ color: '#3B82F6' }}>
              AI is working — {autopilotStatus.currentTask?.agent}: {autopilotStatus.currentTask?.title}
            </span>
            <span className="text-[10px] ml-auto" style={{ color: 'var(--text-dim)' }}>View</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
          {([
            { key: 'website', label: 'App' },
            { key: 'domains', label: 'Domains' },
            { key: 'revenue', label: 'Revenue' },
            { key: 'agents', label: 'Activity' },
            { key: 'tasks', label: `Tasks (${tasks.length})` },
            { key: 'growth', label: 'Growth' },
            { key: 'ads', label: `Ads (${ads.length})` },
            { key: 'emails', label: `Emails (${emails.length})` },
            { key: 'docs', label: `Docs (${documents.length})` },
            { key: 'reports', label: 'Reports' },
            { key: 'autopilot', label: autopilotStatus?.isWorking ? '🟢 Autopilot' : autopilotStatus?.enabled ? '⚡ Autopilot' : '⏸ Autopilot' },

          ] as { key: Tab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap"
              style={tab === t.key ? { background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' } : { color: 'var(--text-dim)' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Explication simple de l'onglet actif */}
        {TAB_DESCRIPTIONS[tab] && (
          <p className="text-[12px] mb-4 px-1" style={{ color: 'var(--text-dim)' }}>
            {TAB_DESCRIPTIONS[tab]}
          </p>
        )}

        {/* ─── Website Tab ─── */}
        {tab === 'website' && (
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <button type="button" onClick={() => window.open(`/api/companies/${id}/website`, '_blank', 'noopener,noreferrer')}
                className="text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)', border: 'none', cursor: 'pointer' }}>Open in new tab ↗</button>
              <button
                onClick={() => navigate(`/company/${id}/editor`)}
                className="text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: 'var(--accent-primary)', color: '#fff' }}>
                ✏️ Edit Website
              </button>


              {!isMobile && (
                <span className="text-[11px] ml-auto tabular-nums" style={{ color: 'var(--text-dim)' }}>
                  {iframeWidthPct < 8 ? 'Hidden' : `${Math.round(iframeWidthPct)}%`}
                </span>
              )}
            </div>
            {/* Page tabs — only show default-lang pages */}
            {websitePages.length > 0 && (
              <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
                {websitePages.filter((p: any) => !p.lang || p.lang === '' || (companyLangs.length > 0 && p.lang === companyLangs[0])).map((p: any) => (
                  <button key={p.slug} onClick={() => {
                    setActivePageSlug(p.slug);
                    const f = document.getElementById('website-iframe') as HTMLIFrameElement;
                    if (f) f.src = `/api/companies/${id}/website${p.slug === 'index' ? '' : '/' + p.slug}`;
                  }}
                    className="text-[11px] px-3 py-1 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5"
                    style={{
                      background: activePageSlug === p.slug ? 'var(--surface-5)' : 'var(--surface-2)',
                      color: activePageSlug === p.slug ? 'var(--text-primary)' : 'var(--text-dim)',
                      border: activePageSlug === p.slug ? '1px solid var(--border-strong)' : '1px solid transparent',
                    }}>
                    {p.title}
                    {p.pageType !== 'static' && (
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--purple)', color: '#fff' }}>{p.pageType}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* Resizable iframe container */}
            {isMobile ? (
              /* Mobile : preview desktop scalée pour rentrer en entier, hauteur compacte, pas de resize */
              <div
                ref={(el) => {
                  iframeContainerRef.current = el;
                  if (el) {
                    const w = el.clientWidth;
                    if (w > 0) {
                      const s = w / 1024;
                      if (Math.abs(s - mobPreviewScale) > 0.005) setMobPreviewScale(s);
                    }
                  }
                }}
                className="relative rounded-xl overflow-hidden"
                style={{ height: 340, background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}
              >
                <iframe
                  id="website-iframe"
                  src={`/api/companies/${id}/website`}
                  title={`${company.name} website`}
                  style={{
                    border: 'none',
                    width: 1024,
                    height: 340 / mobPreviewScale,
                    transform: `scale(${mobPreviewScale})`,
                    transformOrigin: 'top left',
                  }}
                />
              </div>
            ) : (
            <div ref={iframeContainerRef} className="relative" style={{ height: 600 }}>
              {/* The iframe wrapper — right-aligned, width controlled by pct */}
              <div
                className="absolute top-0 right-0 bottom-0 rounded-xl overflow-hidden transition-opacity"
                style={{
                  width: `${Math.max(iframeWidthPct, 0)}%`,
                  border: iframeWidthPct < 8 ? 'none' : '1px solid var(--border-default)',
                  background: 'var(--surface-0)',
                  opacity: iframeWidthPct < 8 ? 0 : 1,
                }}
              >
                {iframeWidthPct >= 8 && (
                  <iframe
                    id="website-iframe"
                    src={`/api/companies/${id}/website`}
                    className="w-full h-full"
                    style={{ border: 'none', pointerEvents: isDraggingRef.current ? 'none' : 'auto' }}
                    title={`${company.name} website`}
                  />
                )}
              </div>
              {/* Drag handle — on the LEFT edge of the iframe box */}
              <div
                className="absolute top-0 bottom-0 flex items-center justify-center"
                style={{
                  right: `${Math.max(iframeWidthPct, 0)}%`,
                  width: 16,
                  transform: 'translateX(50%)',
                  cursor: 'col-resize',
                  zIndex: 20,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isDraggingRef.current = true;
                  const container = iframeContainerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  // Disable iframe pointer events during drag
                  const iframe = document.getElementById('website-iframe') as HTMLIFrameElement;
                  if (iframe) iframe.style.pointerEvents = 'none';

                  const onMove = (ev: MouseEvent) => {
                    const x = ev.clientX - rect.left;
                    const pct = ((rect.width - x) / rect.width) * 100;
                    // Clamp: 0% (hidden) to 100% (full width)
                    setIframeWidthPct(Math.min(100, Math.max(0, pct)));
                  };
                  const onUp = () => {
                    isDraggingRef.current = false;
                    if (iframe) iframe.style.pointerEvents = 'auto';
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
              >
                {/* Visual grip */}
                <div className="rounded-full" style={{
                  width: 6, height: 48,
                  background: 'var(--border-strong)',
                  opacity: 0.6,
                  transition: 'opacity 0.15s',
                }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                   onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')} />
              </div>
            </div>
            )}
          </div>
        )}

        {/* ─── Domains Tab ─── */}
        {tab === 'domains' && <DomainsPanel companyId={id!} />}

        {/* ─── Revenue Tab ─── */}
        {tab === 'revenue' && (
          <div>
            {revenue.length === 0 ? (
              <div className="p-10 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
                <div className="text-2xl mb-3">💳</div>
                <h3 className="text-[15px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>No payment system connected</h3>
                <p className="text-[13px] max-w-md mx-auto mb-4" style={{ color: 'var(--text-dim)' }}>
                  Connect a payment provider (Stripe, PayPal, etc.) to start tracking real revenue, MRR, and ARR automatically.
                </p>
                <button className="text-[12px] font-medium px-4 py-2 rounded-lg transition-colors" style={{ background: 'var(--surface-5)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                  Coming Soon
                </button>
              </div>
            ) : (
              <>
                {/* Revenue KPIs — only shown when real data exists */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    { label: 'Total Revenue', num: Math.round(company.totalRevenue || 0), prefix: '$', color: '#F59E0B' },
                    { label: 'MRR', num: Math.round(company.mrr || 0), prefix: '$', color: '#8B5CF6' },
                    { label: 'ARR', num: Math.round(company.arr || 0), prefix: '$', color: 'var(--teal)' },
                  ].map(kpi => (
                    <div key={kpi.label} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>{kpi.label}</div>
                      <div className="text-lg font-semibold" style={{ color: kpi.color }}><AnimatedCounter value={kpi.num} prefix={kpi.prefix} fontSize={18} /></div>
                    </div>
                  ))}
                </div>
                {/* Revenue Events */}
                <div className="space-y-1.5">
                  {revenue.map((evt: any) => (
                    <div key={evt.id} className="p-3 rounded-lg flex items-center gap-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: evt.type === 'subscription' ? '#4EAADC' : evt.type === 'refund' ? '#ff6b6b' : '#F59E0B' }} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium capitalize" style={{ color: 'var(--text-muted)' }}>{evt.type.replace('_', ' ')}</span>
                          {evt.recurring ? <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--teal-bg)', color: 'var(--teal)' }}>recurring</span> : null}
                        </div>
                        <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>{evt.description}</p>
                      </div>
                      <span className="text-[13px] font-semibold" style={{ color: evt.type === 'refund' ? '#ff6b6b' : '#4EAADC' }}>
                        {evt.type === 'refund' ? '-' : '+'}${evt.amount?.toFixed(2)}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{evt.source}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── Growth Tab ─── */}
        {tab === 'growth' && (
          <GrowthTab companyId={id!} />
        )}

        {/* ─── Ads Tab ─── */}
        {tab === 'ads' && (
          <div>
            {/* Ad KPIs */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { label: 'Total Spend', num: totalAdSpend, prefix: '$', decimals: 2, color: '#EC4899' },
                { label: 'Impressions', num: totalImpressions, prefix: '', decimals: 0, color: '#3B82F6' },
                { label: 'Clicks', num: totalClicks, prefix: '', decimals: 0, color: '#F59E0B' },
                { label: 'Conversions', num: totalConversions, prefix: '', decimals: 0, color: 'var(--teal)' },
              ].map(kpi => (
                <div key={kpi.label} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>{kpi.label}</div>
                  <div className="text-lg font-semibold" style={{ color: kpi.color }}><AnimatedCounter value={kpi.num} prefix={kpi.prefix} decimals={kpi.decimals} fontSize={18} /></div>
                </div>
              ))}
            </div>
            {/* Generate buttons */}
            <div className="flex gap-2 mb-4">
              {['meta', 'google', 'tiktok'].map(p => (
                <button key={p} onClick={() => generateAd(p)} disabled={!!genLoading}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-medium capitalize transition-colors disabled:opacity-30"
                  style={{ background: 'var(--surface-3)', color: PLATFORM_COLORS[p] || '#aaa', border: '1px solid var(--border-default)' }}>
                  {genLoading === `ad-${p}` ? 'Generating...' : `+ ${p} ad`}
                </button>
              ))}
            </div>
            {/* Ad list */}
            <div className="space-y-1.5">
              {ads.map((ad: any) => (
                <div key={ad.id} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded" style={{ background: `${PLATFORM_COLORS[ad.platform] || '#555'}22`, color: PLATFORM_COLORS[ad.platform] || '#888' }}>{ad.platform}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{ad.type}</span>
                    <span className="text-[10px] font-mono ml-auto" style={{ color: ad.status === 'active' ? '#4EAADC' : '#666' }}>{ad.status}</span>
                  </div>
                  <p className="text-[13px] font-medium mb-0.5" style={{ color: 'var(--text-secondary)' }}>{ad.headline}</p>
                  <p className="text-[12px] mb-2" style={{ color: 'var(--text-dim)' }}>{ad.primaryText}</p>
                  <div className="flex items-center gap-4 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                    <span>Budget: ${ad.dailyBudget?.toFixed(0)}/day</span>
                    <span>Spend: ${ad.spend?.toFixed(2)}</span>
                    <span>{ad.impressions?.toLocaleString()} imp</span>
                    <span>{ad.clicks} clicks</span>
                    <span>{ad.conversions} conv</span>
                    <span>CTR: {ad.ctr?.toFixed(2)}%</span>
                    <span>ROAS: {ad.roas?.toFixed(1)}x</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Emails Tab ─── */}
        {tab === 'emails' && (
          <EmailsTab companyId={id!} emails={emails} genLoading={genLoading} generateEmail={generateEmail} />
        )}

        {/* ─── Activity Tab ─── */}
        {tab === 'agents' && (
          <div className="space-y-1.5">
            {activity.length === 0 ? (
              <div className="p-10 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No activity yet. Click "Run Heartbeat" to start.</p>
              </div>
            ) : activity.map((a: any, i: number) => {
              const cfg = ROLE_CONFIG[a.agentRole] || { color: 'var(--text-faint)', label: a.agentRole };
              return (
                <div key={a.id} className="p-3 rounded-lg flex items-start gap-3 animate-slide-up" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', animationDelay: `${i * 0.03}s` }}>
                  <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: cfg.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{a.action}</span>
                      <span className="text-[10px] ml-auto shrink-0" style={{ color: 'var(--text-ghost)' }}>{timeAgo(a.createdAt)}</span>
                    </div>
                    <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{a.message?.replace(/\[IMG:https?:\/\/[^\]]+\]/g, '')}</p>
                    {(() => {
                      const imgs = a.message?.match(/\[IMG:(https?:\/\/[^\]]+)\]/g);
                      if (!imgs) return null;
                      return imgs.map((tag: string, idx: number) => {
                        const url = tag.match(/\[IMG:(https?:\/\/[^\]]+)\]/)?.[1];
                        if (!url) return null;
                        return (
                          <img
                            key={idx}
                            src={url}
                            alt="Product"
                            className="mt-2 rounded-lg page-preview-enter"
                            style={{ maxWidth: 320, maxHeight: 220, objectFit: 'cover', border: '1px solid var(--border-default)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                          />
                        );
                      });
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Tasks Tab ─── */}
        {tab === 'tasks' && (
          <div className="space-y-1.5">
            {tasks.map((task: any) => {
              const cfg = ROLE_CONFIG[task.type] || ROLE_CONFIG[task.agentRole] || { color: 'var(--text-faint)' };
              const isOpen = selectedTask?.id === task.id;
              return (
                <div key={task.id} className="rounded-lg cursor-pointer transition-colors"
                  style={{ background: 'var(--surface-2)', border: isOpen ? '1px solid var(--text-ghost)' : '1px solid var(--border-default)' }}
                  onClick={() => setSelectedTask(isOpen ? null : task)}>
                  <div className="p-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                      <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: cfg.color }}>{task.type}</span>
                      
                      <span className="text-[10px] font-mono ml-auto" style={{ color: task.status === 'running' ? '#F59E0B' : '#4EAADC' }}>
                        {task.status === 'running' ? 'Running' : 'Done'}
                      </span>
                    </div>
                    <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>{task.title}</p>
                  </div>
                  {isOpen && task.result && (
                    <div className="px-3.5 pb-3.5" style={{ borderTop: '1px solid var(--border-default)' }}>
                      <div className="pt-3">
                        <div className="text-[10px] font-mono mb-2" style={{ color: 'var(--text-dim)' }}>AI Output</div>
                        <pre className="text-[12px] whitespace-pre-wrap leading-relaxed font-mono p-3 rounded-lg" style={{ background: 'var(--surface-0)', color: 'var(--text-muted)', maxHeight: 400, overflowY: 'auto' }}>{task.result}</pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Docs Tab ─── */}
        {tab === 'docs' && (
          <div>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {['market_research', 'strategy', 'pitch', 'summary'].map(type => (
                <button key={type} onClick={() => generateDoc(type)} disabled={!!genLoading}
                  className="p-2.5 rounded-lg text-[12px] text-left capitalize transition-colors disabled:opacity-30 hover:border-[var(--border-hover)]"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-dim)' }}>
                  {genLoading === type ? 'Generating...' : `+ ${type.replace('_', ' ')}`}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              {documents.map((doc: any) => {
                const isOpen = selectedDoc?.id === doc.id;
                return (
                  <div key={doc.id} className="rounded-lg cursor-pointer" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
                    onClick={() => setSelectedDoc(isOpen ? null : doc)}>
                    <div className="p-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] capitalize" style={{ color: 'var(--text-dim)' }}>{doc.type?.replace('_', ' ')}</span>
                        {doc.verifiedBy && <span className="text-[10px] font-mono" style={{ color: 'var(--teal)' }}>verified</span>}
                      </div>
                      <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>{doc.title}</p>
                    </div>
                    {isOpen && (
                      <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--border-default)' }}>
                        <pre className="text-[12px] whitespace-pre-wrap leading-relaxed font-mono pt-3" style={{ color: 'var(--text-muted)' }}>{doc.content}</pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Reports Tab ─── */}
        {tab === 'reports' && (
          <div className="space-y-2">
            {reports.length === 0 ? (
              <div className="p-10 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No reports yet. Run a heartbeat cycle.</p>
              </div>
            ) : reports.map((r: any) => (
              <div key={r.id} className="p-4 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-[13px]" style={{ color: 'var(--text-secondary)' }}>Day {r.dayNumber} Report</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-4)', color: 'var(--text-faint)' }}>{r.tasksCompleted} tasks</span>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{timeAgo(r.createdAt)}</span>
                </div>
                <pre className="text-[12px] whitespace-pre-wrap leading-relaxed font-mono" style={{ color: 'var(--text-muted)' }}>{r.summary}</pre>
              </div>
            ))}
          </div>
        )}

        {/* ─── Autopilot Tab ─── */}
        {tab === 'autopilot' && <AutopilotTab companyId={id!} onStatusChange={setAutopilotStatus} />}

      </div>

      {/* ─── Website Links Popup ─── */}
      {showLinksPopup && detectedLinks.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
            <div className="p-5 border-b" style={{ borderColor: 'var(--border-default)' }}>
              <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>Configure Website Links</h3>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-dim)' }}>
                Your website has placeholder links. Add your real URLs below, or leave empty to remove the link from your site.
              </p>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {detectedLinks.map(link => {
                const icons: Record<string, string> = {
                  discord: '💬', instagram: '📸', twitter: '🐦', facebook: '📘', linkedin: '💼',
                  tiktok: '🎵', youtube: '📺', github: '🐙', email: '✉️', phone: '📞',
                  whatsapp: '💬', telegram: '✈️', appstore: '🍎', playstore: '▶️', website: '🌐', address: '📍',
                };
                return (
                  <div key={link.type} className="flex items-center gap-3">
                    <span className="text-[18px] w-7 text-center flex-shrink-0">{icons[link.type] || '🔗'}</span>
                    <div className="flex-1">
                      <label className="text-[11px] font-medium mb-0.5 block" style={{ color: 'var(--text-secondary)' }}>
                        {link.type.charAt(0).toUpperCase() + link.type.slice(1)}
                      </label>
                      <input
                        type="text"
                        value={linkValues[link.type] || ''}
                        onChange={e => setLinkValues(prev => ({ ...prev, [link.type]: e.target.value }))}
                        placeholder={link.type === 'email' ? 'hello@example.com' : link.type === 'phone' ? '+1234567890' : `https://${link.type}.com/...`}
                        className="w-full text-[12px] px-3 py-2 rounded-lg outline-none"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-5 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-default)' }}>
              <button onClick={() => setShowLinksPopup(false)}
                className="text-[12px] px-4 py-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-dim)' }}>
                Skip for now
              </button>
              <button
                disabled={savingLinks}
                onClick={async () => {
                  setSavingLinks(true);
                  try {
                    await api.companies.websiteLinks.update(id!, linkValues);
                    setShowLinksPopup(false);
                    // Reload iframe to reflect changes
                    const f = document.getElementById('website-iframe') as HTMLIFrameElement;
                    if (f) f.src = f.src;
                  } catch {}
                  setSavingLinks(false);
                }}
                className="text-[12px] font-medium px-5 py-2 rounded-lg transition-colors"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
                {savingLinks ? 'Saving...' : 'Save Links'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
