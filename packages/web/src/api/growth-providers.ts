// ─── Growth Engine providers (demo-first) ───────────────────────────────────
// No key = demo mode: record the action, show a simulated result, make zero paid
// network calls. Once keys are present, the same functions switch to real APIs.

export type GrowthChannelStatus = 'demo' | 'sent' | 'completed' | 'failed' | 'skipped';

export interface GrowthProviderResult {
  ok: boolean;
  status: GrowthChannelStatus;
  provider: string;
  id?: string;
  mediaUrl?: string;
  transcript?: string;
  error?: string;
}

const env = (key: string) => process.env[key] || '';

export function isSmsConfigured() {
  return !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM'));
}

export function isCallConfigured() {
  return !!env('BLAND_API_KEY');
}

export async function sendSms(input: { to?: string | null; body: string }): Promise<GrowthProviderResult> {
  if (!input.to) return { ok: false, status: 'skipped', provider: 'twilio', error: 'Missing phone number' };
  if (!isSmsConfigured()) {
    return { ok: true, status: 'demo', provider: 'twilio-demo', id: `demo_sms_${Date.now()}` };
  }
  try {
    const sid = env('TWILIO_ACCOUNT_SID');
    const token = env('TWILIO_AUTH_TOKEN');
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: env('TWILIO_FROM'), To: input.to, Body: input.body }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: 'failed', provider: 'twilio', error: data?.message || `Twilio ${res.status}` };
    return { ok: true, status: 'sent', provider: 'twilio', id: data.sid };
  } catch (e: any) {
    return { ok: false, status: 'failed', provider: 'twilio', error: String(e?.message || e) };
  }
}

export async function placeCall(input: { to?: string | null; script: string; voice?: string }): Promise<GrowthProviderResult> {
  if (!input.to) return { ok: false, status: 'skipped', provider: 'bland-ai', error: 'Missing phone number' };
  if (!isCallConfigured()) {
    return {
      ok: true,
      status: 'demo',
      provider: 'bland-demo',
      id: `demo_call_${Date.now()}`,
      transcript: `DEMO CALL\nAI: ${input.script.slice(0, 220)}\nProspect: Sounds interesting, send me details by email.`,
    };
  }
  try {
    const body: Record<string, unknown> = { phone_number: input.to, task: input.script, voice: input.voice || 'maya', wait_for_greeting: true };
    if (env('BLAND_FROM')) body.from = env('BLAND_FROM');
    const res = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: { Authorization: env('BLAND_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: 'failed', provider: 'bland-ai', error: data?.message || data?.error || `Bland ${res.status}` };
    return { ok: true, status: 'sent', provider: 'bland-ai', id: data.call_id || data.id };
  } catch (e: any) {
    return { ok: false, status: 'failed', provider: 'bland-ai', error: String(e?.message || e) };
  }
}

