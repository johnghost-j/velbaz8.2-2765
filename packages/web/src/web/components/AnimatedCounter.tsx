import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { MotionValue, motion, useSpring, useTransform } from 'motion/react';

// Rolling-digit animated counter (slot-machine style).
// Fixed total duration regardless of magnitude — big numbers roll faster.

interface Props {
  value: number;
  duration?: number; // total animation duration in ms (same for any size)
  prefix?: string;
  suffix?: string;
  decimals?: number;
  fontSize?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function AnimatedCounter({
  value,
  duration = 1500,
  prefix = '',
  suffix = '',
  decimals = 0,
  fontSize,
  className,
  style,
}: Props) {
  // Start already at the target value so the very first mount does NOT animate.
  // The roll animation only plays when `value` actually changes while mounted —
  // never on remounts (e.g. switching tabs) when the number is unchanged.
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) return;
    let raf = 0;
    let start: number | null = null;
    const animate = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const cur = from + (to - from) * eased;
      displayRef.current = cur;
      setDisplay(cur);
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  // Le ressort de chaque chiffre est indexé sur `duration` : une durée courte
  // doit aussi donner un roulement court, sinon le chiffre continue de glisser
  // bien après la fin de la rampe numérique (c'est ce qui donnait l'impression
  // d'une animation interminable). 1500 ms = réglage d'origine.
  const stiffness = Math.min(1600, Math.max(220, Math.round(220 * (1500 / duration))));
  const damping = Math.round(2 * Math.sqrt(stiffness * 0.6) * 1.05); // ~critique, sans rebond

  const size = fontSize ?? 20;
  const height = Math.round(size * 1.2);
  const factor = Math.pow(10, decimals);
  const scaled = Math.round(Math.abs(display) * factor);
  const intDigits = Math.max(String(Math.floor(Math.abs(value))).length, 1);

  const cells: React.ReactNode[] = [];
  for (let i = intDigits - 1; i >= 0; i--) {
    const place = Math.pow(10, i) * factor;
    if (i > 0 && scaled < place) continue; // hide leading digits until reached
    cells.push(<Digit key={`i${i}`} place={place} value={scaled} height={height} stiffness={stiffness} damping={damping} />);
    if (i > 0 && i % 3 === 0) cells.push(<Sep key={`s${i}`} char="," height={height} />);
  }
  if (decimals > 0) {
    cells.push(<Sep key="dot" char="." height={height} />);
    for (let i = decimals - 1; i >= 0; i--) {
      cells.push(<Digit key={`d${i}`} place={Math.pow(10, i)} value={scaled} height={height} stiffness={stiffness} damping={damping} />);
    }
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        overflow: 'hidden',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        verticalAlign: 'bottom',
        ...(fontSize ? { fontSize } : {}),
        ...style,
      }}
    >
      {value < 0 && <Sep char="-" height={height} />}
      {prefix && <Sep char={prefix} height={height} />}
      {cells}
      {suffix && <Sep char={suffix} height={height} />}
    </span>
  );
}

function Sep({ char, height }: { char: string; height: number }) {
  return (
    <span style={{ height, display: 'flex', alignItems: 'center', whiteSpace: 'pre' }}>{char}</span>
  );
}

function Digit({ place, value, height, stiffness, damping }: { place: number; value: number; height: number; stiffness: number; damping: number }) {
  const rounded = Math.floor(value / place);
  const spring = useSpring(rounded, { stiffness, damping, mass: 0.6 });

  useEffect(() => {
    spring.set(rounded);
  }, [spring, rounded]);

  return (
    <span style={{ height, width: '1ch', position: 'relative', display: 'inline-block' }}>
      {Array.from({ length: 10 }, (_, i) => (
        <Num key={i} mv={spring} number={i} height={height} />
      ))}
    </span>
  );
}

function Num({ mv, number, height }: { mv: MotionValue<number>; number: number; height: number }) {
  const y = useTransform(mv, (latest) => {
    const placeValue = ((latest % 10) + 10) % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) memo -= 10 * height;
    return memo;
  });

  return (
    <motion.span
      style={{
        y,
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {number}
    </motion.span>
  );
}
