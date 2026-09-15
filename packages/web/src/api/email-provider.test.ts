import { describe, it, expect } from 'vitest';
import { sendEmail, isEmailConfigured } from './email-provider';

describe('email-provider (dry-run sans clé)', () => {
  it('isEmailConfigured false sans RESEND_API_KEY', () => {
    // Pas de clé dans l'env de test → non configuré.
    expect(isEmailConfigured()).toBe(false);
  });

  it('skip proprement sans clé au lieu de crasher', async () => {
    const r = await sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.error).toMatch(/RESEND_API_KEY/);
  });

  it('refuse un email sans corps', async () => {
    const r = await sendEmail({ to: 'a@b.com', subject: 'Hi' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/html or text/);
  });
});
