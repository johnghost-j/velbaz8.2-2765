import { useEffect, useState } from 'react';

/**
 * Renvoie true quand la largeur de l'écran est <= breakpoint (téléphone).
 * Utilisé pour basculer la sidebar en barre du haut / drawer plein écran.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isMobile;
}

/**
 * Renvoie true quand l'appareil est en orientation paysage (largeur > hauteur).
 */
export function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  useEffect(() => {
    const onResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return isLandscape;
}

/**
 * Renvoie true uniquement sur un vrai appareil tactile (téléphone/tablette).
 * Sert à n'activer les gestes de swipe (drawer gauche/droite) que sur mobile,
 * jamais sur ordinateur — même si la fenêtre est étroite.
 */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      'ontouchstart' in window ||
      (navigator.maxTouchPoints ?? 0) > 0 ||
      window.matchMedia?.('(pointer: coarse)').matches
    );
  });

  useEffect(() => {
    const check = () =>
      setIsTouch(
        'ontouchstart' in window ||
          (navigator.maxTouchPoints ?? 0) > 0 ||
          window.matchMedia?.('(pointer: coarse)').matches
      );
    check();
    const mq = window.matchMedia?.('(pointer: coarse)');
    mq?.addEventListener?.('change', check);
    return () => mq?.removeEventListener?.('change', check);
  }, []);

  return isTouch;
}
