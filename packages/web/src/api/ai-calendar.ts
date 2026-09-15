/**
 * VELBAZ — CALENDRIER INTERNE DE L'IA (INVISIBLE pour l'utilisateur)
 * ================================================================
 * Chaque projet/entreprise a SON calendrier privé. L'IA y note tout ce qui est
 * prévu : campagnes marketing / emails programmés, tâches à faire, rappels /
 * relances (follow-up), mises à jour du site, deadlines, et rendez-vous / actions
 * avec des clients.
 *
 * Règles produit (demandées par l'utilisateur) :
 *  - Le calendrier n'est JAMAIS affiché dans l'UI utilisateur. Seule l'IA
 *    l'utilise en interne et peut en parler dans le chat SI on lui demande.
 *    Il est aussi consultable côté développeur via l'admin panel.
 *  - Quand la date d'un événement arrive, l'IA en fait AUTOMATIQUEMENT une tâche
 *    dans la liste des tâches (autopilot_tasks).
 *  - GESTION DES CONFLITS : une tâche = une date. Si deux tâches tombent le MÊME
 *    JOUR, l'IA le détecte et :
 *       • soit le signale (dans sa réflexion / à l'utilisateur s'il demande),
 *       • soit décale automatiquement à un AUTRE jour libre.
 *    Ici : les rendez-vous clients (client_meeting) et deadlines à heure fixe ne
 *    se décalent PAS (on garde la date, on signale le conflit) ; le reste est
 *    décalé automatiquement vers le prochain jour libre.
 */

import { db } from './database/index';
import { and, eq, gte, lte, asc, desc, isNull, or } from 'drizzle-orm';
import * as schema from './database/schema';
import { v4 as uuidv4 } from 'uuid';

export type CalendarCategory =
  | 'marketing'      // campagne, email programmé
  | 'task'           // tâche à faire
  | 'reminder'       // rappel / relance (follow-up)
  | 'update'         // mise à jour du site / projet
  | 'deadline'       // échéance / deadline
  | 'client_meeting'; // rendez-vous / action avec un client

export interface CalendarEventInput {
  category: CalendarCategory;
  title: string;
  description?: string;
  eventDate: Date;
  hasExactTime?: boolean;
  clientName?: string;
  leadId?: string;
  source?: 'ai' | 'autopilot' | 'system' | 'admin';
}

const CAT_LABELS: Record<CalendarCategory, string> = {
  marketing: 'Marketing',
  task: 'Tâche',
  reminder: 'Rappel / relance',
  update: 'Mise à jour',
  deadline: 'Deadline',
  client_meeting: 'Rendez-vous client',
};

// Catégories dont la date est "sacrée" : on ne les décale JAMAIS
// automatiquement — on garde la date et on signale le conflit.
const FIXED_DATE_CATEGORIES: CalendarCategory[] = ['client_meeting', 'deadline'];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function ymd(d: Date): string {
  return new Date(d).toISOString().split('T')[0];
}

// ─── Détection de conflit : y a-t-il déjà quelque chose ce jour-là ? ─────────
// Regarde À LA FOIS le calendrier interne ET les tâches autopilot planifiées,
// pour que "une tâche = une date" soit vraiment respecté.
export async function findDayConflicts(
  companyId: string,
  day: Date,
  ignoreEventId?: string,
): Promise<{ calendar: any[]; tasks: any[] }> {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);

  const calRows = await db.select().from(schema.aiCalendarEvents)
    .where(and(
      eq(schema.aiCalendarEvents.companyId, companyId),
      gte(schema.aiCalendarEvents.eventDate, dayStart),
      lte(schema.aiCalendarEvents.eventDate, dayEnd),
    ));

  const taskRows = await db.select().from(schema.autopilotTasks)
    .where(and(
      eq(schema.autopilotTasks.companyId, companyId),
      gte(schema.autopilotTasks.scheduledFor, dayStart),
      lte(schema.autopilotTasks.scheduledFor, dayEnd),
    ));

  return {
    calendar: calRows.filter(r => r.id !== ignoreEventId && r.status !== 'cancelled'),
    tasks: taskRows.filter(t => t.status !== 'cancelled' && t.status !== 'completed'),
  };
}

// Cherche le prochain jour libre (aucune tâche ni événement) à partir de `from`.
export async function findNextFreeDay(companyId: string, from: Date, maxLookahead = 60): Promise<Date> {
  let d = startOfDay(from);
  for (let i = 0; i < maxLookahead; i++) {
    const { calendar, tasks } = await findDayConflicts(companyId, d);
    if (calendar.length === 0 && tasks.length === 0) return d;
    d = addDays(d, 1);
  }
  return d; // fallback : le dernier jour testé
}

// ─── Ajout d'un événement (avec détection de conflit) ────────────────────────
// Retourne l'événement créé + un éventuel avertissement de conflit lisible (fr)
// que l'IA peut relayer dans sa réflexion ou à l'utilisateur.
export async function addCalendarEvent(
  companyId: string,
  input: CalendarEventInput,
): Promise<{ id: string; conflict: string | null; movedTo: Date | null; event: any }> {
  let eventDate = input.hasExactTime ? new Date(input.eventDate) : startOfDay(input.eventDate);
  let conflict: string | null = null;
  let movedTo: Date | null = null;
  let status: string = 'planned';
  let conflictNote: string | null = null;

  const { calendar, tasks } = await findDayConflicts(companyId, eventDate);
  const dayBusy = calendar.length + tasks.length;

  if (dayBusy > 0) {
    const existing = [
      ...calendar.map(c => `« ${c.title} »`),
      ...tasks.map(t => `« ${t.title} »`),
    ].join(', ');

    if (FIXED_DATE_CATEGORIES.includes(input.category)) {
      // Date sacrée (rdv client / deadline) → on garde la date, on SIGNALE.
      conflict = `⚠️ Conflit le ${ymd(eventDate)} : il y a déjà ${dayBusy} chose(s) prévue(s) ce jour-là (${existing}). J'ai gardé la date car c'est ${CAT_LABELS[input.category].toLowerCase()}, mais préviens-moi si tu veux réorganiser.`;
      status = 'conflict';
      conflictNote = JSON.stringify({ type: 'kept', day: ymd(eventDate), with: existing });
    } else {
      // Décalage automatique vers le prochain jour libre.
      const free = await findNextFreeDay(companyId, addDays(eventDate, 1));
      movedTo = input.hasExactTime
        ? new Date(new Date(free).setHours(eventDate.getHours(), eventDate.getMinutes(), 0, 0))
        : free;
      conflict = `📅 Le ${ymd(eventDate)} était déjà pris (${existing}). J'ai déplacé « ${input.title} » au ${ymd(free)} (prochain jour libre).`;
      conflictNote = JSON.stringify({ type: 'moved', from: ymd(eventDate), to: ymd(free), with: existing });
      eventDate = movedTo;
    }
  }

  const id = uuidv4();
  await db.insert(schema.aiCalendarEvents).values({
    id,
    companyId,
    category: input.category,
    title: input.title,
    description: input.description || null,
    eventDate,
    hasExactTime: input.hasExactTime || false,
    clientName: input.clientName || null,
    leadId: input.leadId || null,
    source: input.source || 'ai',
    status,
    conflictNote,
  });

  const event = await db.select().from(schema.aiCalendarEvents)
    .where(eq(schema.aiCalendarEvents.id, id)).get();

  return { id, conflict, movedTo, event };
}

export async function updateCalendarEvent(companyId: string, id: string, patch: Partial<CalendarEventInput> & { status?: string }) {
  const set: any = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.eventDate !== undefined) set.eventDate = patch.eventDate;
  if (patch.hasExactTime !== undefined) set.hasExactTime = patch.hasExactTime;
  if (patch.clientName !== undefined) set.clientName = patch.clientName;
  if ((patch as any).status !== undefined) set.status = (patch as any).status;
  await db.update(schema.aiCalendarEvents).set(set)
    .where(and(eq(schema.aiCalendarEvents.id, id), eq(schema.aiCalendarEvents.companyId, companyId)));
}

export async function deleteCalendarEvent(companyId: string, id: string) {
  await db.delete(schema.aiCalendarEvents)
    .where(and(eq(schema.aiCalendarEvents.id, id), eq(schema.aiCalendarEvents.companyId, companyId)));
}

export async function getCalendarEvents(companyId: string, opts?: { from?: Date; to?: Date; includeDone?: boolean }) {
  const conds: any[] = [eq(schema.aiCalendarEvents.companyId, companyId)];
  if (opts?.from) conds.push(gte(schema.aiCalendarEvents.eventDate, startOfDay(opts.from)));
  if (opts?.to) conds.push(lte(schema.aiCalendarEvents.eventDate, endOfDay(opts.to)));
  const rows = await db.select().from(schema.aiCalendarEvents)
    .where(and(...conds))
    .orderBy(asc(schema.aiCalendarEvents.eventDate));
  return opts?.includeDone ? rows : rows.filter(r => r.status !== 'cancelled');
}

export async function getUpcomingEvents(companyId: string, days = 30) {
  const from = startOfDay(new Date());
  const to = endOfDay(addDays(new Date(), days));
  return getCalendarEvents(companyId, { from, to });
}

// ─── Résumé compact (fr) pour le contexte du chat ────────────────────────────
// Injecté dans le system prompt du projet : l'IA "connaît" son calendrier et
// peut en parler SI on le lui demande. Reste court pour ne pas polluer le prompt.
export async function getCalendarSummary(companyId: string, maxItems = 12): Promise<string> {
  const events = await getUpcomingEvents(companyId, 45);
  if (events.length === 0) return '';
  const lines = events.slice(0, maxItems).map(e => {
    const d = ymd(e.eventDate);
    const time = e.hasExactTime ? ' ' + new Date(e.eventDate).toISOString().slice(11, 16) : '';
    const who = e.clientName ? ` — ${e.clientName}` : '';
    return `- ${d}${time} [${CAT_LABELS[e.category as CalendarCategory] || e.category}] ${e.title}${who}`;
  });
  return lines.join('\n');
}

// ─── Données pour l'AFFICHAGE calendrier dans le chat ────────────────────────
// Renvoyé au front UNIQUEMENT quand l'utilisateur demande explicitement à voir
// son calendrier. Groupé par jour, format attendu par le composant CalendarView.
export interface CalendarViewDay {
  day: string; // 'YYYY-MM-DD'
  events: { id: string; name: string; time: string; category: CalendarCategory; client?: string }[];
}
export interface CalendarViewData {
  focusDate: string;                 // jour à centrer (aujourd'hui ou 1er événement)
  count: number;                     // nombre total d'événements
  days: CalendarViewDay[];
}

export async function getCalendarViewData(companyId: string, days = 120): Promise<CalendarViewData> {
  const from = startOfDay(new Date());
  const to = endOfDay(addDays(new Date(), days));
  // On inclut aussi le passé récent (30j) pour le contexte, mais on centre sur aujourd'hui.
  const past = startOfDay(addDays(new Date(), -30));
  const events = await getCalendarEvents(companyId, { from: past, to });
  const byDay = new Map<string, CalendarViewDay>();
  for (const e of events) {
    const d = ymd(e.eventDate);
    const time = e.hasExactTime ? new Date(e.eventDate).toISOString().slice(11, 16) : '';
    if (!byDay.has(d)) byDay.set(d, { day: d, events: [] });
    byDay.get(d)!.events.push({
      id: e.id,
      name: e.title,
      time,
      category: e.category as CalendarCategory,
      client: e.clientName || undefined,
    });
  }
  const upcoming = events.find(e => ymd(e.eventDate) >= ymd(new Date()));
  return {
    focusDate: upcoming ? ymd(upcoming.eventDate) : ymd(new Date()),
    count: events.length,
    days: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ─── Matérialisation : la date est arrivée → on crée une tâche ───────────────
// Appelé à chaque tick autopilot. Pour chaque événement dont la date est
// atteinte et pas encore matérialisé, on crée une tâche autopilot. On applique
// la règle "une tâche = une date" : si le jour est déjà occupé par une autre
// tâche, on décale (sauf rdv client/deadline → on garde + on signale).
// `createTaskFn` est injectée par index.ts (on réutilise addAutopilotTask).
type CreateTaskFn = (companyId: string, when: Date, title: string, description: string, category: CalendarCategory) => Promise<string>;

export async function materializeDueEvents(companyId: string, createTaskFn: CreateTaskFn): Promise<{ created: number; conflicts: string[] }> {
  const now = new Date();
  const due = await db.select().from(schema.aiCalendarEvents)
    .where(and(
      eq(schema.aiCalendarEvents.companyId, companyId),
      lte(schema.aiCalendarEvents.eventDate, now),
    ));

  let created = 0;
  const conflicts: string[] = [];

  for (const ev of due) {
    if (ev.status === 'materialized' || ev.status === 'done' || ev.status === 'cancelled') continue;
    if (ev.relatedTaskId) continue;

    let when = new Date(ev.eventDate);
    const cat = ev.category as CalendarCategory;

    // Conflit : une autre tâche existe déjà ce jour-là ?
    const { tasks } = await findDayConflicts(companyId, when, ev.id);
    if (tasks.length > 0) {
      if (FIXED_DATE_CATEGORIES.includes(cat)) {
        conflicts.push(`⚠️ ${ymd(when)} : « ${ev.title} » (${CAT_LABELS[cat]}) tombe le même jour qu'une autre tâche. Je garde la date car c'est prioritaire — à réorganiser si besoin.`);
      } else {
        const free = await findNextFreeDay(companyId, addDays(when, 1));
        conflicts.push(`📅 « ${ev.title} » déplacée au ${ymd(free)} (le ${ymd(when)} était déjà pris).`);
        when = free;
        await db.update(schema.aiCalendarEvents)
          .set({ eventDate: when, status: 'conflict', conflictNote: JSON.stringify({ type: 'moved', to: ymd(free) }), updatedAt: new Date() })
          .where(eq(schema.aiCalendarEvents.id, ev.id));
        // Décalé dans le futur → on ne matérialise pas ce tick.
        continue;
      }
    }

    const taskId = await createTaskFn(
      companyId,
      when,
      ev.title,
      ev.description || ev.title,
      cat,
    );
    await db.update(schema.aiCalendarEvents)
      .set({ status: 'materialized', relatedTaskId: taskId, updatedAt: new Date() })
      .where(eq(schema.aiCalendarEvents.id, ev.id));
    created++;
  }

  return { created, conflicts };
}
