// ─── Email provider (Resend) ─────────────────────────────────────────────────
// Branche l'envoi réel côté API. Sans RESEND_API_KEY, mode "dry-run": on log et on
// enregistre l'email en base (status='not_sent') sans planter — le produit continue
// de tourner et tu ajoutes la clé quand tu veux (env RESEND_API_KEY).
//
// Setup: crée un compte resend.com → API key → ajoute RESEND_API_KEY et
// RESEND_FROM (ex: "Velbaz <hello@tondomaine.com>") dans .env.

// Clés résolues au RUNTIME (secret-store chiffré -> repli env). Permet d'ajouter
// la clé Resend depuis le panel admin sans redémarrer.
import { getSecret } from './secret-store';
const resendKey = () => getSecret('RESEND_API_KEY') || '';
const resendFrom = () => getSecret('RESEND_FROM') || 'Velbaz <onboarding@resend.dev>';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;   // true si pas de clé (dry-run)
  error?: string;
}

export function isEmailConfigured(): boolean {
  return resendKey().length > 0;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  if (!input.html && !input.text) {
    return { ok: false, error: 'Email needs html or text body' };
  }
  const RESEND_API_KEY = resendKey();
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY manquante — dry-run. to=${to.join(',')} subject="${input.subject}"`);
    return { ok: false, skipped: true, error: 'RESEND_API_KEY not set' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from || resendFrom(),
        to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email] Resend error ${res.status}: ${body.slice(0, 300)}`);
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const data: any = await res.json().catch(() => ({}));
    return { ok: true, id: data?.id };
  } catch (e: any) {
    console.error('[email] send failed:', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// ─── Provider auto-select (Resend → CLI interne) ─────────────────────────────
// Nouvelle brique pour Money Maker + apps générées. On NE change PAS le
// comportement de sendEmail()/isEmailConfigured() ci-dessus (dry-run Resend-only)
// pour ne pas déclencher d'envois inattendus dans les flux existants.
//
// Priorité : Resend si RESEND_API_KEY présent, sinon la commande sandbox
// `send-email` (envoi RÉEL immédiat). Bascule automatique dès que la clé Resend
// est ajoutée par l'utilisateur.

export type EmailProvider = 'resend' | 'cli' | 'none';

export function emailProvider(): EmailProvider {
  if (resendKey().length > 0) return 'resend';
  // La commande `send-email` est dispo dans le sandbox Runable.
  return 'cli';
}

export function canSendEmail(): boolean {
  return emailProvider() !== 'none';
}

async function sendViaCli(input: SendEmailInput): Promise<SendEmailResult> {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const args: string[] = [];
  for (const r of to) {
    args.push('--to', r);
  }
  args.push('--subject', input.subject);
  const useHtml = !!input.html;
  const body = input.html || input.text || '';
  args.push(useHtml ? '--html' : '--body', '-');
  if (input.replyTo) args.push('--reply-to', input.replyTo);
  try {
    // node:child_process (et non Bun.spawn) : sous Vite SSR le global `Bun`
    // n'existe pas. spawn est dispo partout (Node + Bun).
    const { spawn } = await import('node:child_process');
    return await new Promise<SendEmailResult>((resolve) => {
      const proc = spawn('send-email', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.on('error', (e: any) => {
        console.error('[email:cli] spawn failed:', e?.message || e);
        resolve({ ok: false, error: String(e?.message || e) });
      });
      proc.on('close', (code) => {
        if (code !== 0) {
          const msg = (err || out || `send-email exited ${code}`).slice(0, 300);
          console.error('[email:cli] failed:', msg);
          resolve({ ok: false, error: msg });
          return;
        }
        const idMatch = (out || '').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || (out || '').match(/id[:=]\s*([\w-]+)/i);
        resolve({ ok: true, id: idMatch?.[1] });
      });
      proc.stdin.write(body);
      proc.stdin.end();
    });
  } catch (e: any) {
    console.error('[email:cli] spawn failed:', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Envoi réel avec sélection auto du provider. À utiliser pour Money Maker et
 * pour les apps générées. Ne fait jamais de dry-run silencieux : si aucun
 * provider n'est dispo, renvoie une erreur explicite.
 */
export async function sendEmailAuto(input: SendEmailInput): Promise<SendEmailResult> {
  if (!input.html && !input.text) {
    return { ok: false, error: 'Email needs html or text body' };
  }
  const provider = emailProvider();
  if (provider === 'resend') return sendEmail(input);
  if (provider === 'cli') return sendViaCli(input);
  return { ok: false, error: 'No email provider available' };
}
