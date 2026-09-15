/**
 * XCloneLogin — écran de connexion, calé au pixel sur la capture fournie.
 *
 * Mesures reprises telles quelles : titre 40px/1.05 800, boutons 300×40 radius 9999,
 * séparateur « or » 15px, champ 56px radius 4, bouton « Continue » 40px désactivé
 * tant que le champ est vide, légal 11px, pied de liens 13px.
 * Police : Inter (chargée depuis /xclone/fonts) + repli système, la pile de X.
 *
 * Purement additif.
 */

import { useState } from 'react';

/** Pile de polices identique à celle du site d'origine (Chirp → Inter → système). */
export const X_FONT =
  "'Inter','Chirp',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const FONT_CSS = `
@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:url('/xclone/fonts/inter-400.woff2') format('woff2');}
@font-face{font-family:'Inter';font-style:normal;font-weight:500;font-display:swap;src:url('/xclone/fonts/inter-500.woff2') format('woff2');}
@font-face{font-family:'Inter';font-style:normal;font-weight:700;font-display:swap;src:url('/xclone/fonts/inter-700.woff2') format('woff2');}
@font-face{font-family:'Inter';font-style:normal;font-weight:800;font-display:swap;src:url('/xclone/fonts/inter-800.woff2') format('woff2');}
.xcl-scroll::-webkit-scrollbar{width:0;height:0}
`;

/** Polices + réglages communs aux deux écrans. */
export function XCloneFonts() {
  return <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />;
}

/** Le sigle, en vectoriel (net à toute taille). */
export function XGlyph({ size = 24, color = '#0f1419' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function AppleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#000" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C3.33 15.45 4.04 8.2 9.4 7.92c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.89 4.47zM12.03 7.87C11.88 5.15 14.09 3 16.5 3c.28 3.01-2.79 4.9-4.47 4.87z" />
    </svg>
  );
}

function PhoneIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15.4 14.6l-1.5 1.5a13.6 13.6 0 0 1-4.8-4.8l1.5-1.5c.3-.3.4-.8.2-1.2L9.3 5.3a1 1 0 0 0-1.2-.5l-2.6.9c-.5.2-.8.6-.8 1.1.3 6.6 5.6 11.9 12.2 12.2.5 0 1-.3 1.1-.8l.9-2.6a1 1 0 0 0-.5-1.2l-3.3-1.5c-.4-.2-.9-.1-1.2.2z" />
    </svg>
  );
}

const FOOTER = [
  'About', 'Get App', 'Grok', 'Imagine', 'Help', 'Terms', 'Privacy', 'Cookies',
  'Careers', 'Ads & Business', 'Developers', 'News', 'Accessibility',
];

interface Props {
  onSignedIn: (identity: string) => void;
  className?: string;
}

export function XCloneLogin({ onSignedIn, className = '' }: Props) {
  const [value, setValue] = useState('');
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = value.trim().length > 0;

  const submit = (identity: string) => {
    if (busy) return;
    setBusy(true);
    setTimeout(() => { setBusy(false); onSignedIn(identity); }, 240);
  };

  /** Bouton méthode : 300×40, radius 9999, texte 15px/700, icône puis libellé centrés. */
  const method = (
    icon: React.ReactNode, label: string, dark: boolean, onClick: () => void,
  ) => (
    <button
      onClick={onClick}
      style={{
        width: 300, height: 40, borderRadius: 9999, display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 8, fontSize: 15, fontWeight: 700, lineHeight: '20px',
        background: dark ? '#0f1419' : '#fff',
        color: dark ? '#fff' : '#0f1419',
        border: dark ? 'none' : '1px solid #cfd9de',
        cursor: 'pointer',
      }}
    >
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <div
      className={`xcl-scroll overflow-y-auto ${className}`}
      style={{ background: '#fff', color: '#0f1419', fontFamily: X_FONT, WebkitFontSmoothing: 'antialiased' }}
    >
      <XCloneFonts />
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
          <div style={{ width: '100%', maxWidth: 980, display: 'flex', alignItems: 'center', gap: 40, flexWrap: 'wrap-reverse' }}>

            {/* Colonne gauche */}
            <div style={{ flex: '1 1 340px', minWidth: 320 }}>
              <h1 style={{ fontSize: 40, lineHeight: '48px', fontWeight: 800, letterSpacing: '-0.6px', margin: '0 0 28px' }}>
                Happening now.
              </h1>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {method(<PhoneIcon />, 'Continue with phone', true, () => submit('phone'))}
                {method(<GoogleLogo />, 'Continue with Google', false, () => submit('google'))}
                {method(<AppleLogo />, 'Continue with Apple', false, () => submit('apple'))}

                <div style={{ width: 300, display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                  <span style={{ flex: 1, height: 1, background: '#eff3f4' }} />
                  <span style={{ fontSize: 15, color: '#536471' }}>or</span>
                  <span style={{ flex: 1, height: 1, background: '#eff3f4' }} />
                </div>

                <div
                  style={{
                    width: 300, height: 56, borderRadius: 4, padding: '0 8px',
                    border: `1px solid ${focus ? '#1d9bf0' : '#cfd9de'}`,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  }}
                >
                  {(focus || ready) && (
                    <label style={{ fontSize: 13, color: focus ? '#1d9bf0' : '#536471', lineHeight: '16px' }}>
                      Email or username
                    </label>
                  )}
                  <input
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    onFocus={() => setFocus(true)}
                    onBlur={() => setFocus(false)}
                    onKeyDown={e => { if (e.key === 'Enter' && ready) submit(value.trim()); }}
                    placeholder={focus || ready ? '' : 'Email or username'}
                    style={{
                      border: 'none', outline: 'none', background: 'transparent',
                      fontSize: 17, lineHeight: '24px', color: '#0f1419', fontFamily: X_FONT,
                    }}
                  />
                </div>

                <button
                  onClick={() => ready && submit(value.trim())}
                  disabled={!ready || busy}
                  style={{
                    width: 300, height: 40, borderRadius: 9999, border: 'none',
                    fontSize: 15, fontWeight: 700,
                    background: ready ? '#0f1419' : '#d3d3d3',
                    color: ready ? '#fff' : '#8a8a8a',
                    cursor: ready ? 'pointer' : 'default',
                  }}
                >
                  {busy ? 'Signing in…' : 'Continue'}
                </button>

                <p style={{ width: 300, fontSize: 11, lineHeight: '16px', color: '#536471', margin: '2px 0 0' }}>
                  By continuing, you agree to our{' '}
                  <span style={{ fontWeight: 700, color: '#0f1419' }}>Terms of Service</span>,{' '}
                  <span style={{ fontWeight: 700, color: '#0f1419' }}>Privacy Policy</span> and{' '}
                  <span style={{ fontWeight: 700, color: '#0f1419' }}>Cookie Use</span>.
                </p>
              </div>
            </div>

            {/* Colonne droite : le sigle, très grand */}
            <div style={{ flex: '1 1 340px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <XGlyph size={330} />
            </div>
          </div>
        </div>

        {/* Pied de page */}
        <div style={{ padding: '0 16px 20px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '4px 10px' }}>
            {FOOTER.map(l => (
              <span key={l} style={{ fontSize: 13, color: '#536471' }}>{l}</span>
            ))}
            <span style={{ fontSize: 13, color: '#536471' }}>© 2026 X Corp.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default XCloneLogin;
