"use client";

import { useState, useMemo, useRef, useEffect } from "react";

/* ─── Types ─── */
export type CalCategory =
  | "marketing"
  | "task"
  | "reminder"
  | "update"
  | "deadline"
  | "client_meeting";

export interface CalViewEvent {
  id: string;
  name: string;
  time: string; // '' ou 'HH:MM'
  category: CalCategory;
  client?: string;
}
export interface CalViewDay {
  day: string; // 'YYYY-MM-DD'
  events: CalViewEvent[];
}
export interface CalViewData {
  focusDate?: string;
  count?: number;
  days: CalViewDay[];
}

/* ─── Couleurs / libellés par catégorie ─── */
const CAT: Record<CalCategory, { label: string; color: string }> = {
  marketing: { label: "Tueketing", color: "#8B5CF6" },
  task: { label: "Task", color: "#3B82F6" },
  reminder: { label: "Reminder", color: "#F59E0B" },
  update: { label: "Update", color: "#10B981" },
  deadline: { label: "Deadline", color: "#EF4444" },
  client_meeting: { label: "Client meeting", color: "#EC4899" },
};
function catOf(c: string) {
  return CAT[c as CalCategory] || { label: c, color: "var(--text-dim)" };
}

/* ─── Date helpers (sans dépendance externe) ─── */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "Tuech", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
// Grille du mois : commence lundi, se termine dimanche, 6 seMaynes max.
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  // getDay(): 0=dim..6=sam → on veut lundi=0
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  // On retire la 6e seMayne si elle est entièrement hors mois
  const lastWeek = days.slice(35);
  if (lastWeek.every((d) => !sameMonth(d, anchor))) return days.slice(0, 35);
  return days;
}

/* ─── Icônes ─── */
function IconChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
  );
}
function IconCal() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
  );
}

/* ─── Composant ─── */
export function CalendarView({ data }: { data: CalViewData }) {
  const today = useMemo(() => new Date(), []);
  const focus = useMemo(() => (data.focusDate ? parseYMD(data.focusDate) : today), [data.focusDate, today]);
  const [anchor, setAnchor] = useState<Date>(() => new Date(focus.getFullYear(), focus.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(focus);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Applique une date choisie dans la roulette iOS : met à jour le mois affiché
  // ET le jour sélectionné.
  function applyPicked(d: Date) {
    setAnchor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelected(d);
    setPickerOpen(false);
  }

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalViewEvent[]>();
    for (const d of data.days || []) m.set(d.day, d.events || []);
    return m;
  }, [data.days]);

  // Années réellement utilisées par des événements / la date focus / la date
  // sélectionnée. Elles seront TOUJOURS présentes dans la roulette même si
  // elles sortent de la plage par défaut (-100 / +30) → aucune date ajoutée par
  // l'IA ne peut manquer dans le sélecteur.
  const eventYears = useMemo(() => {
    const s = new Set<number>();
    for (const d of data.days || []) {
      const y = Number((d.day || "").slice(0, 4));
      if (Number.isFinite(y) && y > 0) s.add(y);
    }
    if (data.focusDate) { const y = Number(data.focusDate.slice(0, 4)); if (y > 0) s.add(y); }
    return s;
  }, [data.days, data.focusDate]);

  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const selKey = ymd(selected);
  const selectedEvents = eventsByDay.get(selKey) || [];

  function prevMonth() { setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)); }
  function nextMonth() { setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)); }
  function goToday() { setAnchor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(today); }

  const border = "1px solid var(--border-default)";
  const rangeStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);

  return (
    <div
      className="page-preview-enter"
      style={{
        marginTop: 10,
        borderRadius: 16,
        border,
        background: "var(--surface-2, var(--surface-3))",
        overflow: "hidden",
        maxWidth: 560,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: border }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 46, borderRadius: 10, border, background: "var(--surface-4)", padding: 3 }}>
            <span style={{ fontSize: 9, textTransform: "uppercase", color: "var(--text-dim)", letterSpacing: 0.5 }}>{MONTHS[today.getMonth()].slice(0, 3)}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>{today.getDate()}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <button
              onClick={() => setPickerOpen(true)}
              title="Choose date"
              style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)" }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, textTransform: "capitalize" }}>{MONTHS[anchor.getMonth()]} {anchor.getFullYear()}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.55 }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
              {rangeStart.getDate()} – {rangeEnd.getDate()} {MONTHS[anchor.getMonth()]}
              {typeof data.count === "number" ? ` · ${data.count} event${data.count > 1 ? "s" : ""}` : ""}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={prevMonth} title="Previous month" style={navBtn(border)}><IconChevronLeft /></button>
          <button onClick={goToday} title="Today" style={{ ...navBtn(border), width: "auto", padding: "0 12px", fontSize: 12.5, fontWeight: 600 }}>Today</button>
          <button onClick={nextMonth} title="Next month" style={navBtn(border)}><IconChevronRight /></button>
        </div>
      </div>

      {/* Week days */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: border }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ textAlign: "center", padding: "7px 0", fontSize: 10.5, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.4 }}>{w}</div>
        ))}
      </div>

      {/* Days grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {grid.map((day, i) => {
          const key = ymd(day);
          const evs = eventsByDay.get(key) || [];
          const inMonth = sameMonth(day, anchor);
          const isToday = sameDay(day, today);
          const isSel = sameDay(day, selected);
          const conflict = evs.length > 1;
          return (
            <button
              key={i}
              onClick={() => setSelected(day)}
              style={{
                position: "relative",
                minHeight: 66,
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "5px 5px 6px",
                textAlign: "left",
                border: "none",
                borderRight: (i % 7 !== 6) ? border : "none",
                borderBottom: i < grid.length - 7 ? border : "none",
                background: isSel ? "var(--surface-4)" : inMonth ? "transparent" : "var(--surface-3, transparent)",
                opacity: inMonth ? 1 : 0.45,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  alignSelf: "flex-end",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 21,
                  height: 21,
                  borderRadius: "50%",
                  fontSize: 11.5,
                  fontWeight: isToday || isSel ? 700 : 500,
                  background: isToday ? "var(--accent, #6C5BFF)" : "transparent",
                  // Pastille "aujourd'hui" = --accent (clair en thème sombre).
                  // Texte = couleur appairée --accent-foreground (noir en thème
                  // sombre, blanc en clair). Fallback noir pour rester lisible
                  // sur la pastille claire même si la variable manque.
                  color: isToday ? "var(--accent-foreground, #111111)" : "var(--text-secondary)",
                }}
              >
                {day.getDate()}
              </span>
              {/* Event chips (max 2) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: "auto" }}>
                {evs.slice(0, 2).map((e) => {
                  const c = catOf(e.category);
                  return (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--surface-3)", borderRadius: 5, padding: "1.5px 4px", overflow: "hidden" }}>
                      <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: c.color }} />
                      <span style={{ fontSize: 9.5, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</span>
                    </div>
                  );
                })}
                {evs.length > 2 && (
                  <span style={{ fontSize: 9.5, color: "var(--text-dim)", paddingLeft: 2 }}>+ {evs.length - 2} more</span>
                )}
              </div>
              {conflict && (
                <span title="Multiple events on this day (potential conflict)" style={{ position: "absolute", top: 4, left: 5, fontSize: 9, color: "#F59E0B" }}>⚠</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      <div style={{ borderTop: border, padding: "12px 16px", background: "var(--surface-3, transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, color: "var(--text-secondary)" }}>
          <IconCal />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            {selected.getDate()} {MONTHS[selected.getMonth()]} {selected.getFullYear()}
          </span>
          {selectedEvents.length > 1 && (
            <span style={{ fontSize: 11, color: "#F59E0B", marginLeft: 4 }}>⚠ {selectedEvents.length} events on the same day</span>
          )}
        </div>
        {selectedEvents.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>Nothing scheduled for this day.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {selectedEvents.map((e) => {
              const c = catOf(e.category);
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 10px", borderRadius: 9, background: "var(--surface-4)", border }}>
                  <span style={{ flexShrink: 0, marginTop: 4, width: 8, height: 8, borderRadius: "50%", background: c.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{e.name}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 600, color: c.color, background: `${c.color}22`, borderRadius: 5, padding: "1px 6px" }}>{c.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                      {e.time ? e.time : "All day"}{e.client ? ` · ${e.client}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sélecteur de date style iPhone (roulettes jour / mois / année) */}
      {pickerOpen && (
        <IOSDatePicker
          initial={selected}
          extraYears={eventYears}
          onCancel={() => setPickerOpen(false)}
          onConfirm={applyPicked}
        />
      )}
    </div>
  );
}

/* ─── Sélecteur de date iOS : 3 roulettes (jour · mois · année) ─── */
const WHEEL_ITEM_H = 38;
const WHEEL_VISIBLE = 5; // nombre de lignes visibles (impair → une au centre)

function daysInMonth(year: number, monthIdx: number) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

function WheelColumn({
  items,
  value,
  onChange,
  align = "center",
}: {
  items: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
  align?: "left" | "center" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tmr = useRef<any>(null);
  const idx = Math.max(0, items.findIndex((it) => it.value === value));

  // Positionne la roulette sur la valeur courante (sans animation au montage
  // ni quand la valeur change de l'extérieur — ex. jour clampé après un mois).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = idx * WHEEL_ITEM_H;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [idx]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    if (tmr.current) clearTimeout(tmr.current);
    // Débounce : on attend la fin du défilement, puis on aimante et on valide.
    tmr.current = setTimeout(() => {
      const i = Math.round(el.scrollTop / WHEEL_ITEM_H);
      const clamped = Math.max(0, Math.min(items.length - 1, i));
      el.scrollTo({ top: clamped * WHEEL_ITEM_H, behavior: "smooth" });
      const v = items[clamped]?.value;
      if (v !== undefined && v !== value) onChange(v);
    }, 110);
  }

  const pad = ((WHEEL_VISIBLE - 1) / 2) * WHEEL_ITEM_H;
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="ios-wheel-col"
      style={{
        height: WHEEL_ITEM_H * WHEEL_VISIBLE,
        overflowY: "scroll",
        scrollSnapType: "y mandatory",
        flex: 1,
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, #000 30%, #000 70%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, transparent 0%, #000 30%, #000 70%, transparent 100%)",
      }}
    >
      <div style={{ height: pad }} />
      {items.map((it) => {
        const active = it.value === value;
        return (
          <div
            key={it.value}
            onClick={() => onChange(it.value)}
            style={{
              height: WHEEL_ITEM_H,
              scrollSnapAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: align === "center" ? "center" : align === "left" ? "flex-start" : "flex-end",
              padding: align === "center" ? 0 : "0 14px",
              fontSize: active ? 20 : 16.5,
              fontWeight: active ? 700 : 500,
              color: active ? "var(--text-primary)" : "var(--text-dim)",
              opacity: active ? 1 : 0.6,
              cursor: "pointer",
              transition: "font-size .14s ease, color .14s ease, opacity .14s ease",
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
          </div>
        );
      })}
      <div style={{ height: pad }} />
    </div>
  );
}

function IOSDatePicker({
  initial,
  extraYears,
  onConfirm,
  onCancel,
}: {
  initial: Date;
  extraYears?: Set<number>;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [day, setDay] = useState(initial.getDate());

  // Le jour doit rester valide quand le mois/année change (ex. 31 → February).
  const maxDay = daysInMonth(year, month);
  const safeDay = Math.min(day, maxDay);
  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [maxDay, day]);

  const yearItems = useMemo(() => {
    // Plage large basée sur l'ANNÉE COURANTE RÉELLE : de 100 ans en arrière
    // jusqu'à 30 ans en avant. Comme la borne est calculée avec new Date() au
    // rendu, à chaque nouvelle année réelle la plage se décale automatiquement
    // d'un an → une année supplémentaire s'ajoute toute seule, sans rien coder.
    const base = now.getFullYear();
    const lo = base - 100;
    const hi = base + 30;
    const seen = new Set<number>();
    const list: { label: string; value: number }[] = [];
    for (let y = lo; y <= hi; y++) { seen.add(y); list.push({ label: String(y), value: y }); }
    // Garantit que toute année réellement utilisée (année initiale + années des
    // événements ajoutés par l'IA / date focus) soit présente, même hors plage.
    const mustHave = new Set<number>(extraYears || []);
    mustHave.add(initial.getFullYear());
    let added = false;
    for (const y of mustHave) {
      if (Number.isFinite(y) && y > 0 && !seen.has(y)) {
        seen.add(y);
        list.push({ label: String(y), value: y });
        added = true;
      }
    }
    if (added) list.sort((a, b) => a.value - b.value);
    return list;
  }, [now, initial, extraYears]);

  const monthItems = useMemo(
    () => MONTHS.map((m, i) => ({ label: m.charAt(0).toUpperCase() + m.slice(1), value: i })),
    [],
  );
  const dayItems = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => ({ label: String(i + 1), value: i + 1 })),
    [maxDay],
  );

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        animation: "cal-fade-in .18s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(92vw, 360px)",
          borderRadius: 22,
          background: "var(--surface-2, #1c1c1e)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          overflow: "hidden",
          animation: "cal-pop-in .22s cubic-bezier(0.2,0.9,0.3,1.2)",
        }}
      >
        {/* Barre de titre */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Cancel</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Choose date</span>
          <button onClick={() => onConfirm(new Date(year, month, safeDay))} style={{ background: "none", border: "none", color: "var(--accent, #6C5BFF)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>OK</button>
        </div>

        {/* Roulettes : jour · mois · année */}
        <div style={{ position: "relative", display: "flex", padding: "6px 10px 18px" }}>
          {/* Bande de sélection centrale (gris translucide, AUCUN contour) */}
          <div
            style={{
              position: "absolute",
              left: 10,
              right: 10,
              top: `calc(6px + ${((WHEEL_VISIBLE - 1) / 2) * WHEEL_ITEM_H}px)`,
              height: WHEEL_ITEM_H,
              borderRadius: 12,
              background: "var(--surface-4, rgba(255,255,255,0.06))",
              pointerEvents: "none",
            }}
          />
          <WheelColumn items={dayItems} value={safeDay} onChange={setDay} />
          <WheelColumn items={monthItems} value={month} onChange={setMonth} />
          <WheelColumn items={yearItems} value={year} onChange={setYear} />
        </div>
      </div>
    </div>
  );
}

function navBtn(border: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 8,
    border,
    background: "var(--surface-4)",
    color: "var(--text-secondary)",
    cursor: "pointer",
  };
}
