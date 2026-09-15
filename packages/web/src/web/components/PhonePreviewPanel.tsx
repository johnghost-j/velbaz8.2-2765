/**
 * PhonePreviewPanel — preview d'une app mobile Expo dans un cadre iPhone.
 *
 * - Cadre iPhone 15 Pro (IPhoneMockup) + iframe de l'export web statique
 *   servi par /api/companies/:id/mobile-preview/.
 * - Expo Go QR code (URL exp://…exp.direct du tunnel) + lien copiable dessous.
 * - États détectables SANS couleur (protanopie) : [EN COURS] / [TERMINÉ] /
 *   [ERREUR] avec symboles ▶ ✓ ✗ — jamais uniquement rouge/vert.
 * - Bouton Réessayer → POST /mobile/start (relance tunnel + re-export si besoin).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { RefreshCw, Copy, Check, Smartphone, QrCode } from 'lucide-react';
import IPhoneMockup from './IPhoneMockup';
import { api } from '../lib/api';

interface MobileStatus {
  running: boolean;
  expoUrl: string | null;
  webPreviewReady: boolean;
  /** true si une construction/reconstruction de l'app tourne côté serveur. */
  building?: boolean;
  /** false si l'app mobile n'a jamais été sauvegardée (conversion interrompue). */
  hasMobileFiles?: boolean;
}

interface PhonePreviewPanelProps {
  companyId: string;
  /** true pendant qu'un build est en cours (le panneau affiche [EN COURS]). */
  building?: boolean;
}

export default function PhonePreviewPanel({ companyId, building }: PhonePreviewPanelProps) {
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [frameScale, setFrameScale] = useState(0.55);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api.companies.mobile.status(companyId);
      if (res && !res.error) setStatus(res as MobileStatus);
    } catch { /* réseau : on garde le dernier état connu */ }
  }, [companyId]);

  // Poll le statut (plus rapproché pendant un build ou une reconstruction).
  const isBuilding = building || rebuilding || !!status?.building;
  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, isBuilding ? 5000 : 15000);
    return () => clearInterval(t);
  }, [refreshStatus, isBuilding]);

  // Fin de reconstruction : dès que la preview est prête, on recharge l'iframe.
  useEffect(() => {
    if (rebuilding && status?.webPreviewReady && !status?.building) {
      setRebuilding(false);
      setIframeKey(k => k + 1);
    }
  }, [rebuilding, status?.webPreviewReady, status?.building]);

  // ── Auto-réparation : si la preview n'est pas prête (export manquant,
  // redémarrage du serveur…), on la relance TOUT SEUL une fois — l'utilisateur
  // n'a pas à cliquer « Réessayer » pour voir son app.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!status || isBuilding || starting || autoStartedRef.current) return;
    if (!status.webPreviewReady || !status.running) {
      autoStartedRef.current = true;
      handleStart();
    }
  }, [status, isBuilding, starting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Adapte l'échelle du cadre iPhone à la hauteur disponible.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const h = el.clientHeight;
      if (h > 0) setFrameScale(Math.max(0.3, Math.min(0.9, (h - 24) / 876)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await api.companies.mobile.start(companyId);
      if (res?.error) setStartError(String(res.error));
      else if (res?.rebuilding) {
        // L'app mobile n'existait pas encore (conversion interrompue) : le
        // serveur la reconstruit tout seul — on suit la progression ici.
        setRebuilding(true);
      } else {
        setStatus(s => ({ ...s, running: true, expoUrl: res.expoUrl || s?.expoUrl || null, webPreviewReady: !!res.webPreviewReady }));
        setIframeKey(k => k + 1);
      }
    } catch (e: any) {
      setStartError(String(e?.message || e));
    } finally {
      setStarting(false);
      refreshStatus();
    }
  }, [companyId, refreshStatus]);

  const copyLink = useCallback(() => {
    if (!status?.expoUrl) return;
    navigator.clipboard.writeText(status.expoUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [status?.expoUrl]);

  const previewUrl = `/api/companies/${companyId}/mobile-preview/`;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Cadre iPhone + iframe ── */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden p-3">
        <div style={{ width: 417 * frameScale, height: 876 * frameScale }}>
          <IPhoneMockup model="15-pro" color="space-black" scale={frameScale} safeArea={false}>
            {status?.webPreviewReady ? (
              <iframe
                key={iframeKey}
                src={previewUrl}
                title="Mobile preview"
                className="w-full h-full border-0 bg-black"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-black text-center px-6">
                <Smartphone size={28} className="text-white/40" aria-hidden />
                {isBuilding ? (
                  <p className="text-white/70 text-sm font-medium">▶ [IN PROGRESS] {rebuilding || status?.building ? "Building the mobile app… (a few minutes)" : "Building the mobile app…"}</p>
                ) : starting ? (
                  <p className="text-white/70 text-sm font-medium">▶ [IN PROGRESS] Starting the preview…</p>
                ) : (
                  <>
                    <p className="text-white/70 text-sm font-medium">Phone preview not ready yet</p>
                    <p className="text-white/40 text-xs">Start the app with the Retry button on the right.</p>
                  </>
                )}
              </div>
            )}
          </IPhoneMockup>
        </div>
      </div>

      {/* ── Colonne QR / lien / actions ── */}
      <div className="w-60 shrink-0 border-l border-border/60 p-4 flex flex-col items-center gap-3 overflow-y-auto">
        <div className="flex items-center gap-2 self-start">
          <QrCode size={15} aria-hidden />
          <h3 className="text-sm font-semibold">Test on your phone</h3>
        </div>
        <p className="text-xs text-muted-foreground self-start">
          Scan with the <strong>Expo Go</strong> app (iOS/Android) — the app runs natively on your phone.
        </p>

        {status?.expoUrl ? (
          <>
            <div className="bg-white p-2.5 rounded-lg" aria-label="Expo Go QR code">
              <QRCodeSVG value={status.expoUrl} size={168} level="M" />
            </div>
            {/* Lien sous le QR + copie */}
            <div className="w-full">
              <p className="text-[11px] font-mono break-all text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5" data-testid="expo-url">
                {status.expoUrl}
              </p>
              <button
                onClick={copyLink}
                className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-xs font-medium rounded-md border border-border px-2 py-1.5 hover:bg-muted transition-colors"
              >
                {copied ? <><Check size={13} aria-hidden /> Copied ✓</> : <><Copy size={13} aria-hidden /> Copy link</>}
              </button>
            </div>
            <p className="text-xs self-start">
              {status.running
                ? <span className="font-medium">✓ [DONE] Phone connection active</span>
                : <span className="font-medium">✗ [ERROR] Connection stopped — the QR may have expired, restart below.</span>}
            </p>
          </>
        ) : (
          <p className="text-xs self-start font-medium">
            {rebuilding || status?.building
              ? '▶ [IN PROGRESS] Building the mobile app — the QR code arrives at the end…'
              : isBuilding || starting
                ? '▶ [IN PROGRESS] Preparing the QR code…'
                : '✗ Pas encore de QR code — lance l\'app ci-dessous.'}
          </p>
        )}

        {startError && (
          <p className="text-xs self-start font-medium break-words w-full" role="alert">
            ✗ [ERREUR] {startError.slice(0, 220)}
          </p>
        )}

        {(!status?.running || !status?.webPreviewReady || startError) && !isBuilding && (
          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md border border-border px-2 py-2 hover:bg-muted transition-colors disabled:opacity-60"
          >
            <RefreshCw size={13} className={starting ? 'animate-spin' : ''} aria-hidden />
            {starting ? '▶ [IN PROGRESS] Starting…' : 'Retry / Restart the app'}
          </button>
        )}
      </div>
    </div>
  );
}
