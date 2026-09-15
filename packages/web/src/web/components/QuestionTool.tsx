"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ─── Types ─── */
export type QuestionOption = { id: string; label: string; description?: string };

export type QuestionConfig = {
  q: string;
  placeholder?: string;
  kind?: "single" | "multi" | "text";
  options?: QuestionOption[];
  allowCustom?: boolean;
  customPlaceholder?: string;
  /** When true, all options start selected (user unchecks what they don't want). */
  preselectAll?: boolean;
};

const CUSTOM_ID = "__custom__";

function optionBadge(idx: number) {
  return String.fromCharCode(65 + idx);
}

/* ─── Icons ─── */
function IconQuestion({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 20l1.3 -3.9a9 9 0 1 1 3.4 2.9z" />
      <path d="M12 16v.01" />
      <path d="M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" />
    </svg>
  );
}

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 6l-6 6l6 6" />
    </svg>
  );
}

function IconChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 15l6 -6l6 6" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6l6 -6" />
    </svg>
  );
}

/* ─── QuestionPrompt (single question view) ─── */
function QuestionPrompt({
  question,
  questionIndex,
  totalQuestions,
  onSubmit,
  onSkip,
  onBack,
  initialAnswer,
}: {
  question: QuestionConfig;
  questionIndex: number;
  totalQuestions: number;
  onSubmit: (answer: string) => void;
  onSkip: () => void;
  /** Revenir à la question précédente. Absent = pas de bouton (1re question). */
  onBack?: () => void;
  /** Réponse déjà donnée à CETTE question : réaffichée telle quelle quand on
   *  revient en arrière, pour ne pas retaper ce qui a déjà été répondu. */
  initialAnswer?: string;
}) {
  const kind = question.kind || (question.options && question.options.length > 0 ? "single" : "text");
  const hasOptions = kind !== "text" && question.options && question.options.length > 0;
  const isLast = questionIndex >= totalQuestions - 1;
  const customEnabled = question.allowCustom ?? false;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [textValue, setTextValue] = useState("");

  // Reset on question change — sauf si une réponse existe déjà pour cette
  // question (retour en arrière) : on la restaure dans le formulaire.
  useEffect(() => {
    const prev = (initialAnswer || "").trim();
    if (prev) {
      if (kind === "text") {
        setSelectedIds([]);
        setCustomText("");
        setTextValue(prev);
        return;
      }
      // Réponse à options : elle a été enregistrée sous forme de libellés
      // séparés par « , ». On retrouve les options cochées, le reste (texte
      // libre) retourne dans le champ personnalisé.
      const parts = prev.split(",").map((x) => x.trim()).filter(Boolean);
      const ids: string[] = [];
      const leftovers: string[] = [];
      for (const part of parts) {
        const hit = question.options?.find(
          (o) => o.label.trim().toLowerCase() === part.toLowerCase(),
        );
        if (hit) ids.push(hit.id);
        else leftovers.push(part);
      }
      const custom = customEnabled ? leftovers.join(", ") : "";
      if (custom) ids.push(CUSTOM_ID);
      setSelectedIds(ids);
      setCustomText(custom);
      setTextValue("");
      return;
    }
    if (question.preselectAll && kind === "multi" && question.options) {
      setSelectedIds(question.options.map((o) => o.id));
    } else {
      setSelectedIds([]);
    }
    setCustomText("");
    setTextValue("");
  }, [questionIndex]);

  const canSubmit = useMemo(() => {
    if (kind === "text") return textValue.trim().length > 0;
    const nonCustom = selectedIds.filter((id) => id !== CUSTOM_ID).length;
    const hasCustom = customText.trim().length > 0;
    const total = nonCustom + (hasCustom ? 1 : 0);
    return total > 0;
  }, [kind, selectedIds, customText, textValue]);

  // Sélection cumulative : cliquer une proposition l'AJOUTE aux précédentes
  // (au lieu de remplacer). Re-cliquer la retire. Vaut pour single et multi.
  const handleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleCustomChange = (val: string) => {
    setCustomText(val);
    setSelectedIds((prev) => {
      const has = prev.includes(CUSTOM_ID);
      if (val.trim() && !has) return [...prev, CUSTOM_ID];
      if (!val.trim() && has) return prev.filter((id) => id !== CUSTOM_ID);
      return prev;
    });
  };

  const doSubmit = () => {
    if (!canSubmit) return;
    let answer: string;
    if (kind === "text") {
      answer = textValue.trim();
    } else {
      const labels = selectedIds
        .filter((id) => id !== CUSTOM_ID)
        .map((id) => question.options?.find((o) => o.id === id)?.label || id);
      if (customText.trim()) labels.push(customText.trim());
      answer = labels.join(", ");
    }
    onSubmit(answer);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSubmit();
    }
  };

  const optionRowBase =
    "w-full text-left rounded-md px-2 py-1.5 flex items-center gap-2 -mx-2 hover:bg-neutral-100 dark:hover:bg-neutral-800";
  const badgeBase =
    "h-5 min-w-5 px-1 rounded-[4px] inline-flex items-center justify-center text-sm font-medium border";
  const badgeOff =
    "bg-transparent text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700";
  const badgeOn =
    "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100";

  return (
    <div className="px-3 py-2 space-y-2 bg-white dark:bg-neutral-950">
      {/* Question text */}
      <div className="flex items-center justify-between gap-px">
        <div className="flex items-center gap-2 text-sm text-neutral-900 dark:text-neutral-100">
          <span className="h-5 min-w-5 px-1 rounded-[4px] inline-flex items-center justify-center text-sm font-medium text-neutral-500 dark:text-neutral-400">
            {questionIndex + 1}
          </span>
          <span>{question.q}</span>
        </div>
      </div>

      {/* Options */}
      {hasOptions && (
        <div className="space-y-px">
          {question.options!.map((opt, idx) => {
            const checked = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelect(opt.id)}
                className={optionRowBase}
              >
                <span className={cn(badgeBase, checked ? badgeOn : badgeOff)}>
                  {optionBadge(idx)}
                </span>
                <span className="text-sm text-neutral-900 dark:text-neutral-100">
                  {opt.label}
                  {opt.description && (
                    <span className="text-neutral-500 dark:text-neutral-400">
                      {" "}{opt.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {/* Custom option */}
          {customEnabled && (
            <div className="pt-1 flex items-center gap-2">
              <span className={cn(badgeBase, selectedIds.includes(CUSTOM_ID) ? badgeOn : badgeOff)}>
                {optionBadge(question.options!.length)}
              </span>
              <input
                value={customText}
                onChange={(e) => handleCustomChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={question.customPlaceholder ?? "Type your answer"}
                className="w-full h-7 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
            </div>
          )}
        </div>
      )}

      {/* Text input */}
      {kind === "text" && (
        <textarea
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={question.placeholder ?? "Type your answer"}
          rows={3}
          autoFocus
          className="w-full rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 resize-y outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-1.5">
        {/* Bas à gauche : retour à la question précédente (jamais sur la 1re). */}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="h-6 pl-1 pr-2 rounded-[4px] inline-flex items-center gap-0.5 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-[0.98] transition-[background-color,color,transform] duration-150"
          >
            <IconChevronLeft className="w-3.5 h-3.5" />
            Précédent
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSkip}
          className="h-6 px-2 rounded-[4px] text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-[0.98] transition-[background-color,color,transform] duration-150"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={doSubmit}
          disabled={!canSubmit}
          className="h-6 px-2.5 rounded-[4px] text-sm font-medium bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-white active:scale-[0.98] transition-[background-color,transform] duration-150 disabled:opacity-60 disabled:hover:bg-neutral-900 dark:disabled:hover:bg-neutral-100 disabled:active:scale-100"
        >
          {isLast ? "Send" : "Next"}
        </button>
        </div>
      </div>
    </div>
  );
}

/* ─── QuestionTool (wrapper with header + nav) ─── */
export function QuestionTool({
  questions,
  questionIndex,
  onAnswer,
  onSkip,
  onFinish,
  onBack,
  answers,
}: {
  questions: QuestionConfig[];
  questionIndex: number;
  onAnswer: (index: number, answer: string) => void;
  onSkip: (index: number) => void;
  onFinish: () => void;
  /** Retour à la question précédente. Sans ce callback, aucun bouton. */
  onBack?: (index: number) => void;
  /** Réponses déjà données, par index : réaffichées au retour en arrière. */
  answers?: Record<number, string>;
}) {
  const q = questions[questionIndex];
  if (!q) return null;

  const total = questions.length;
  const showNav = total > 1;

  return (
    <div className="rounded-[10px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden">
      {/* Header bar */}
      <div className="h-7 border-b border-neutral-200 dark:border-neutral-800 px-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <div className="inline-flex items-center gap-1.5">
          <IconQuestion className="w-3.5 h-3.5" />
          Question
        </div>
        {showNav && (
          <span>{questionIndex + 1} of {total}</span>
        )}
      </div>

      {/* Active question */}
      <QuestionPrompt
        key={questionIndex}
        question={q}
        questionIndex={questionIndex}
        totalQuestions={total}
        onSubmit={(answer) => onAnswer(questionIndex, answer)}
        onSkip={() => onSkip(questionIndex)}
        onBack={onBack && questionIndex > 0 ? () => onBack(questionIndex) : undefined}
        initialAnswer={answers?.[questionIndex]}
      />
    </div>
  );
}
