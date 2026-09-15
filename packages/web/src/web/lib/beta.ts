import { create } from 'zustand';
import { api } from './api';

/**
 * Bêta : accès au site par code d'invitation saisi à l'ENTRÉE.
 * Une fois validé, l'appareil (deviceId localStorage) + l'IP sont enregistrés
 * côté serveur → on ne redemande plus le code sur cet appareil/IP.
 */

const DEVICE_KEY = 'velbaz_device_id';
const GRANTED_KEY = 'velbaz_beta_ok';

/** Identifiant d'appareil stable (persisté en localStorage). */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `dev_${Date.now()}`;
  }
}

interface BetaStore {
  status: 'checking' | 'locked' | 'granted';
  init: () => Promise<void>;
  verify: (code: string) => Promise<{ ok: boolean; message?: string; remaining?: number | null }>;
}

export const useBeta = create<BetaStore>((set) => ({
  status: 'checking',

  init: async () => {
    const deviceId = getDeviceId();
    // Optimiste : si déjà accordé localement, on débloque tout de suite,
    // puis on revalide en arrière-plan.
    if (localStorage.getItem(GRANTED_KEY) === '1') {
      set({ status: 'granted' });
    }
    try {
      const res = await api.beta.check(deviceId);
      if (res?.access) {
        localStorage.setItem(GRANTED_KEY, '1');
        set({ status: 'granted' });
      } else {
        localStorage.removeItem(GRANTED_KEY);
        set({ status: 'locked' });
      }
    } catch {
      // Réseau KO : ne pas bloquer un accès déjà accordé localement.
      if (localStorage.getItem(GRANTED_KEY) === '1') set({ status: 'granted' });
      else set({ status: 'locked' });
    }
  },

  verify: async (code: string) => {
    const deviceId = getDeviceId();
    try {
      const res = await api.beta.verify(code, deviceId);
      if (res?.ok) {
        localStorage.setItem(GRANTED_KEY, '1');
        set({ status: 'granted' });
        return { ok: true, remaining: res.remaining ?? null };
      }
      return { ok: false, message: res?.message || 'Invalid code.' };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Network error.' };
    }
  },
}));
