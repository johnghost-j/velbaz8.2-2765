"use client";

import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────
 * AUDIO VIEW — lecteur vocal / audio que l'IA peut afficher dans le chat.
 *
 * Deux façons de l'invoquer :
 *  1) Tag court  [AUDIO:https://…/voix.mp3]   → lecteur simple auto.
 *  2) Bloc riche [AUDIO_VIEW]{json}[/AUDIO_VIEW] :
 *     { "url": "...", "title": "V3-Sandra-femme.mp3", "duration": 11 }
 *
 * Self-contained : <audio> caché piloté par une UI custom à la charte.
 * Design : carte sombre + titre/waveform + bouton Download, ligne de lecture
 * avec temps courant, barre de progression fine cliquable, temps total,
 * et pilule "Play/Pause" contrastée.
 * ───────────────────────────────────────────────────────────────────────── */

export interface AudioViewData {
  url: string;
  title?: string;
  subtitle?: string;
  duration?: number; // secondes (fallback avant metadata)
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || "audio");
  } catch {
    return url.split("/").pop() || "audio";
  }
}

/* ─── Icônes inline ─── */
const IconWave = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="10" x2="4" y2="14" />
    <line x1="8" y1="7" x2="8" y2="17" />
    <line x1="12" y1="4" x2="12" y2="20" />
    <line x1="16" y1="8" x2="16" y2="16" />
    <line x1="20" y1="10" x2="20" y2="14" />
  </svg>
);
const IconPlay = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
const IconPause = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
);

export function AudioView({ data }: { data: AudioViewData }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(data.duration || 0);

  const title = data.title || fileNameFromUrl(data.url);
  const progress = total > 0 ? Math.min(1, current / total) : 0;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime);
    const onMeta = () => { if (isFinite(a.duration)) setTotal(a.duration); };
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const seekTo = (clientX: number, el: HTMLDivElement) => {
    const a = audioRef.current;
    if (!a || !total) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * total;
    setCurrent(ratio * total);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        border: "1px solid var(--border-default)",
        background: "var(--surface-2)",
        borderRadius: 18,
        padding: "18px 20px",
        margin: "8px 0",
        maxWidth: 480,
      }}
    >
      <audio ref={audioRef} src={data.url} preload="metadata" />

      {/* Ligne du haut : waveform + titre + Download */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--text-dim)", flexShrink: 0, display: "inline-flex" }}>
          <IconWave />
        </span>
        <div
          style={{
            flex: 1, minWidth: 0,
            fontSize: 17, fontWeight: 600, color: "var(--text-primary)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
          title={title}
        >
          {title}
        </div>
        <a
          href={data.url}
          download={title}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "8px 18px", borderRadius: 999,
            border: "1px solid var(--border-default)", background: "transparent",
            color: "var(--text-secondary)", textDecoration: "none",
            fontSize: 14, fontWeight: 500,
          }}
        >
          Download
        </a>
      </div>

      {/* Ligne du bas : temps + barre + temps + Play */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", color: "var(--text-dim)", flexShrink: 0 }}>
          {fmtTime(current)}
        </span>

        <div
          onClick={(e) => seekTo(e.clientX, e.currentTarget)}
          style={{ flex: 1, minWidth: 0, height: 14, display: "flex", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ position: "relative", width: "100%", height: 4, borderRadius: 999, background: "var(--border-default)" }}>
            <div
              style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${progress * 100}%`,
                borderRadius: 999, background: "var(--text-secondary)",
                transition: "width 0.1s linear",
              }}
            />
          </div>
        </div>

        <span style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", color: "var(--text-dim)", flexShrink: 0 }}>
          {fmtTime(total)}
        </span>

        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            flexShrink: 0,
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 18px", borderRadius: 999, border: "none", cursor: "pointer",
            background: "var(--text-primary)", color: "var(--surface-2)",
            fontSize: 14, fontWeight: 600,
            transition: "transform 0.12s ease, opacity 0.12s ease",
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.95)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          {playing ? <IconPause /> : <IconPlay />}
          {playing ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
}

export default AudioView;
