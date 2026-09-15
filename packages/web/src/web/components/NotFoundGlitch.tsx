'use client';

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useEffect, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const NOT_FOUND_DEFAULTS = {
  code: "404",
  title: "Page not found",
  description: "The page you are looking for does not exist or has been moved.",
  homeHref: "/",
  homeLabel: "Go home",
};

export interface NotFoundGlitchProps {
  className?: string;
  code?: string;
  title?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
}

interface NotFoundStageProps {
  className?: string;
  children: ReactNode;
}

function NotFoundStage({ className, children }: NotFoundStageProps) {
  return (
    <section
      className={cn(
        "flex min-h-[520px] w-full flex-col items-center justify-center gap-8 px-6 py-20 text-center",
        className,
      )}
    >
      {children}
    </section>
  );
}

interface NotFoundActionsProps {
  homeHref?: string;
  homeLabel?: string;
}

// Un seul CTA — retour à l'accueil. (Le bouton "Browse pages" a été retiré à la demande.)
function NotFoundActions({
  homeHref = NOT_FOUND_DEFAULTS.homeHref,
  homeLabel = NOT_FOUND_DEFAULTS.homeLabel,
}: NotFoundActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <a
        href={homeHref}
        className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-transform active:scale-[0.97]"
      >
        {homeLabel}
      </a>
    </div>
  );
}

// ── [2026-09-15] Easter egg : le 404 qui dégénère ──────────────────────────
// Le glitch existait déjà (un tic aléatoire toutes les 2,6 s). Il ne menait
// nulle part. Maintenant, insister dessus ESCALADE : chaque clic sur le grand
// chiffre accélère la contamination, le titre se met lui aussi à se brouiller,
// puis tout se stabilise sur un message caché — et la page cesse de glitcher,
// comme si on l'avait enfin cassée dans le bon sens.
// Aucun comportement réel ne change : le bouton « Go home » reste intact.
const EGG_CLICKS = 6;
/** À partir d'ici le titre se brouille aussi : la contamination se voit. */
const EGG_TITLE_AT = 3;
const EGG = {
  code: "418",
  title: "I'm a teapot",
  description:
    "Six clicks on a 404. There was never a page here — so have a teapot instead.",
};

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@$?/\\";
const SCRAMBLE_MS = 700;
const TICK_MS = 45;

// `retrigger` change de valeur à chaque tic glitch → relance l'animation
// de scramble sur le même texte (sinon elle ne joue qu'au tout premier montage).
function Scramble({ text, retrigger }: { text: string; retrigger?: number }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (reduce) {
      setDisplay(text);
      return;
    }

    const chars = text.split("");
    const start = performance.now();
    let raf = 0;
    let last = 0;

    const loop = (now: number) => {
      if (now - last >= TICK_MS) {
        last = now;

        const progress = Math.min((now - start) / SCRAMBLE_MS, 1);
        const settled = Math.floor(progress * chars.length);

        setDisplay(
          chars
            .map((ch, i) =>
              i < settled || ch === " "
                ? ch
                : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
            )
            .join(""),
        );
      }

      if (now - start < SCRAMBLE_MS) {
        raf = requestAnimationFrame(loop);
      } else {
        setDisplay(text);
      }
    };

    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [text, reduce, retrigger]);

  return <span className="tabular-nums">{display}</span>;
}

// Page d'erreur générique (404 par défaut, réutilisable pour d'autres codes)
// avec effet glitch/scramble sur le code et un seul bouton "Go home".
export function NotFoundGlitch({
  className,
  code = NOT_FOUND_DEFAULTS.code,
  title = NOT_FOUND_DEFAULTS.title,
  description = NOT_FOUND_DEFAULTS.description,
  homeHref,
  homeLabel,
}: NotFoundGlitchProps) {
  const reduce = useReducedMotion();
  // Déclenche l'effet glitch chromatique automatiquement (pas seulement au
  // survol) : un flash au chargement, puis un tic aléatoire répété, pour que
  // l'effet soit visible même sans bouger la souris.
  const [glitching, setGlitching] = useState(true);
  const [tick, setTick] = useState(0);
  // Nombre de clics sur le grand chiffre (easter egg, voir en haut du fichier).
  const [clicks, setClicks] = useState(0);
  const egg = clicks >= EGG_CLICKS;

  const shownCode = egg ? EGG.code : code;
  const shownTitle = egg ? EGG.title : title;
  const shownDescription = egg ? EGG.description : description;

  useEffect(() => {
    if (reduce) return;
    // L'œuf atteint : la page se stabilise, plus aucun tic. C'est le contraste
    // qui fait la blague — on a cliqué comme un forcené, et tout se calme.
    if (egg) { setGlitching(false); return; }
    const flashOff = setTimeout(() => setGlitching(false), 500);
    // Chaque clic rapproche les tics : 2600 ms au repos, ~950 ms juste avant
    // le déclenchement. Plancher à 400 ms, on ne veut pas d'un stroboscope.
    const period = Math.max(400, 2600 - clicks * 340);
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      setGlitching(true);
      setTimeout(() => setGlitching(false), 220);
    }, period);
    return () => { clearTimeout(flashOff); clearInterval(interval); };
  }, [reduce, clicks, egg]);

  return (
    <NotFoundStage className={className}>
      <div
        // Clic = escalade du glitch (easter egg). Élément décoratif : pas de
        // rôle ARIA, rien à annoncer, et le seul vrai contrôle de la page
        // reste le bouton « Go home ».
        onClick={() => setClicks((c) => (c >= EGG_CLICKS ? c : c + 1))}
        className="group relative select-none font-mono font-bold leading-none tracking-tighter text-foreground [font-size:clamp(5rem,18vw,11rem)]"
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 text-[#ff0040] mix-blend-screen transition-[transform,opacity] duration-150 ease-out group-hover:translate-x-[3px] group-hover:opacity-70 motion-reduce:hidden",
            glitching ? "translate-x-[3px] opacity-70" : "opacity-0",
          )}
        >
          <Scramble text={shownCode} retrigger={tick} />
        </span>

        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 text-[#00e5ff] mix-blend-screen transition-[transform,opacity] duration-150 ease-out group-hover:-translate-x-[3px] group-hover:opacity-70 motion-reduce:hidden",
            glitching ? "-translate-x-[3px] opacity-70" : "opacity-0",
          )}
        >
          <Scramble text={shownCode} retrigger={tick} />
        </span>

        <h1 className="relative">
          <Scramble text={shownCode} retrigger={tick} />
        </h1>
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="text-lg font-semibold text-foreground">
          {clicks >= EGG_TITLE_AT
            ? <Scramble text={shownTitle} retrigger={egg ? -1 : tick} />
            : shownTitle}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">{shownDescription}</p>
      </div>

      <NotFoundActions homeHref={homeHref} homeLabel={homeLabel} />
    </NotFoundStage>

  );
}
