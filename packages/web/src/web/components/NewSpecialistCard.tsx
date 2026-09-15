// ─── Carte « Nouveau spécialiste créé » ──────────────────────────────────────
// Affichée en tête d'une réponse produite par un spécialiste IA créé à la demande
// (ou réutilisé) par Velbaz. Rend visible le fait qu'un expert dédié a été monté
// spécialement pour la demande.

import { motion } from 'motion/react';

export type NewSpecialistData = {
  label: string;
  emoji?: string;
  color?: string;
  desc?: string;
  domain?: string;
  isNew?: boolean;
};

export default function NewSpecialistCard({ data }: { data: NewSpecialistData }) {
  const color = /^#([0-9a-f]{6})$/i.test(data.color || '') ? data.color! : '#6366f1';
  const emoji = data.emoji || '🧠';
  const isNew = data.isNew !== false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="my-2 flex items-center gap-3 rounded-2xl px-4 py-3"
      style={{
        background: `linear-gradient(135deg, ${color}1a, ${color}05)`,
        border: `1px solid ${color}44`,
      }}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl"
        style={{ background: `${color}22`, border: `1px solid ${color}55` }}
      >
        <span aria-hidden>{emoji}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color }}
          >
            {isNew ? '✨ New specialist created' : '♻️ Specialist reused'}
          </span>
        </div>
        <div className="truncate text-[15px] font-semibold" style={{ color: 'var(--text-1, #f5f5f5)' }}>
          {data.label}
        </div>
        {data.desc ? (
          <div className="mt-0.5 truncate text-[12.5px]" style={{ color: 'var(--text-3, #9ca3af)' }}>
            {data.desc}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
