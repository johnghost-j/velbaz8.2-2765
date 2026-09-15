"use client";

import { useState, useRef, useEffect } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ─── Types ─── */
export type PlanPage = {
  name: string;
  purpose?: string;
  /** true = row is checked / will be created. */
  enabled: boolean;
};

/* ─── Icons ─── */
function IconLayout({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
      <path d="M9 7V4a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5l10 -10" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/* ─── Row (one page) ─── */
function PageRow({
  page,
  index,
  onToggle,
  onEdit,
  onDelete,
}: {
  page: PlanPage;
  index: number;
  onToggle: () => void;
  onEdit: (name: string, purpose: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(page.name);
  const [purpose, setPurpose] = useState(page.purpose ?? "");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setName(page.name);
    setPurpose(page.purpose ?? "");
    setEditing(true);
  };

  const commit = () => {
    const n = name.trim();
    if (!n) { setEditing(false); return; }
    onEdit(n, purpose.trim());
    setEditing(false);
  };

  const cancel = () => {
    setName(page.name);
    setPurpose(page.purpose ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-md border border-neutral-400 dark:border-neutral-500 bg-white dark:bg-neutral-950 px-2 py-2 space-y-1.5">
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          placeholder="Page name"
          className="w-full h-7 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-sm font-medium text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
        />
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          placeholder="Page purpose (optional)"
          className="w-full h-7 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-xs text-neutral-600 dark:text-neutral-400 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" onClick={cancel} className="h-6 px-2 rounded-[4px] text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            Cancel
          </button>
          <button type="button" onClick={commit} className="h-6 px-2.5 rounded-[4px] text-xs font-medium bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-white">
            OK
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 -mx-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
      {/* Checkbox */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={page.enabled ? "Uncheck" : "Check"}
        className={cn(
          "h-5 w-5 shrink-0 rounded-[5px] inline-flex items-center justify-center border transition-colors",
          page.enabled
            ? "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100"
            : "bg-transparent text-transparent border-neutral-300 dark:border-neutral-600",
        )}
      >
        <IconCheck className="w-3 h-3" />
      </button>

      {/* Name + purpose */}
      <div className={cn("flex-1 min-w-0", !page.enabled && "opacity-40")}>
        <div className="text-sm text-neutral-900 dark:text-neutral-100 truncate">{page.name}</div>
        {page.purpose && (
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">{page.purpose}</div>
        )}
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          type="button"
          onClick={startEdit}
          aria-label="Edit"
          title="Edit"
          className="h-6 w-6 rounded-[5px] inline-flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          <IconPencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete"
          title="Delete"
          className="h-6 w-6 rounded-[5px] inline-flex items-center justify-center text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
        >
          <IconTrash className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── PagePlanTool ─── */
export function PagePlanTool({
  title = "Here are the pages I will create for your site.",
  hint,
  initialPages,
  onConfirm,
  onSkip,
}: {
  title?: string;
  hint?: string;
  initialPages: { name: string; purpose?: string }[];
  /** Called with the final list of pages to create (name + purpose). */
  onConfirm: (pages: { name: string; purpose?: string }[]) => void;
  onSkip: () => void;
}) {
  const [pages, setPages] = useState<PlanPage[]>(
    initialPages.map((p) => ({ name: String(p.name), purpose: p.purpose ? String(p.purpose) : "", enabled: true })),
  );

  // Inline "add new page" state
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) newNameRef.current?.focus();
  }, [adding]);

  const toggle = (i: number) =>
    setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, enabled: !p.enabled } : p)));

  const editAt = (i: number, name: string, purpose: string) =>
    setPages((prev) => prev.map((p, idx) => (idx === i ? { ...p, name, purpose } : p)));

  // Delete → remaining rows shift up automatically (filtered array).
  const deleteAt = (i: number) =>
    setPages((prev) => prev.filter((_, idx) => idx !== i));

  const commitNew = () => {
    const n = newName.trim();
    if (!n) { setAdding(false); setNewName(""); setNewPurpose(""); return; }
    setPages((prev) => [...prev, { name: n, purpose: newPurpose.trim(), enabled: true }]);
    // Keep the add row open so the user can add many pages in a row.
    setNewName("");
    setNewPurpose("");
    newNameRef.current?.focus();
  };

  const closeAdd = () => {
    setAdding(false);
    setNewName("");
    setNewPurpose("");
  };

  const selectedCount = pages.filter((p) => p.enabled).length;

  const confirm = () => {
    const chosen = pages
      .filter((p) => p.enabled)
      .map((p) => ({ name: p.name, purpose: p.purpose || undefined }));
    onConfirm(chosen);
  };

  return (
    <div className="rounded-[10px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden">
      {/* Header */}
      <div className="h-7 border-b border-neutral-200 dark:border-neutral-800 px-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <div className="inline-flex items-center gap-1.5">
          <IconLayout className="w-3.5 h-3.5" />
          Page plan
        </div>
        <span>{selectedCount} page{selectedCount > 1 ? "s" : ""}</span>
      </div>

      <div className="px-3 py-2 space-y-2 bg-white dark:bg-neutral-950">
        <p className="text-sm text-neutral-900 dark:text-neutral-100">{title}</p>

        {/* Page list */}
        <div className="space-y-px">
          {pages.map((p, i) => (
            <PageRow
              key={`${i}-${p.name}`}
              page={p}
              index={i}
              onToggle={() => toggle(i)}
              onEdit={(name, purpose) => editAt(i, name, purpose)}
              onDelete={() => deleteAt(i)}
            />
          ))}
        </div>

        {/* Add page */}
        {adding ? (
          <div className="rounded-md border border-neutral-400 dark:border-neutral-500 bg-white dark:bg-neutral-950 px-2 py-2 space-y-1.5">
            <input
              ref={newNameRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitNew(); }
                if (e.key === "Escape") { e.preventDefault(); closeAdd(); }
              }}
              placeholder="Page name (e.g. Blog, Pricing…)"
              className="w-full h-7 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-sm font-medium text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
            <input
              value={newPurpose}
              onChange={(e) => setNewPurpose(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitNew(); }
                if (e.key === "Escape") { e.preventDefault(); closeAdd(); }
              }}
              placeholder="Page purpose (optional)"
              className="w-full h-7 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-xs text-neutral-600 dark:text-neutral-400 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button type="button" onClick={closeAdd} className="h-6 px-2 rounded-[4px] text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                Close
              </button>
              <button type="button" onClick={commitNew} className="h-6 px-2.5 rounded-[4px] text-xs font-medium bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-white">
                Add
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full flex items-center gap-2 rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-400 dark:hover:border-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
          >
            <span className="h-5 w-5 rounded-[5px] inline-flex items-center justify-center border border-current">
              <IconPlus className="w-3 h-3" />
            </span>
            Add a page
          </button>
        )}

        {hint && (
          <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>{hint}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={onSkip}
            className="h-6 px-2 rounded-[4px] text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-[0.98] transition-[background-color,color,transform] duration-150"
          >
            Skip — let the AI decide
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selectedCount === 0}
            className="h-6 px-2.5 rounded-[4px] text-sm font-medium bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-white active:scale-[0.98] transition-[background-color,transform] duration-150 disabled:opacity-60 disabled:active:scale-100"
          >
            Create these pages
          </button>
        </div>
      </div>
    </div>
  );
}
