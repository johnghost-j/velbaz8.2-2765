import { useState, useEffect, useRef, useCallback } from 'react';
import { toastSuccess } from '../lib/toast';
import { getAuthToken } from '../lib/token';
import CommsConsole from './CommsConsole';
import AiCreditsPanel from './AiCreditsPanel';

const ADMIN_EMAIL = 'johnemadmansour1@gmail.com';

interface DebugEntry {
  id: string;
  ts: number;
  level: 'info' | 'warn' | 'error' | 'ai' | 'job' | 'debug';
  category: string;
  message: string;
  meta?: any;
}

interface Job {
  id: string;
  type: string;
  companyId: string;
  status: string;
  startedAt: number;
  error?: string;
}

interface ModelHealth {
  model: string;
  failures: number;
  blocked: boolean;
  blockedUntil?: number;
  lastUsed?: number;
}

const LEVEL_COLORS: Record<string, string> = {
  error: '#ff4d4f',
  warn: '#faad14',
  ai: '#b37feb',
  job: '#1890ff',
  info: '#8c8c8c',
  debug: '#595959',
};

const LEVEL_BG: Record<string, string> = {
  error: 'rgba(255,77,79,0.08)',
  warn: 'rgba(250,173,20,0.06)',
  ai: 'rgba(179,127,235,0.06)',
  job: 'rgba(24,144,255,0.06)',
  info: 'transparent',
  debug: 'transparent',
};

interface UserError {
  id: string;
  companyId?: string;
  companyName?: string;
  agentRole?: string;
  message: string;
  source?: string;
  jobType?: string;
  createdAt?: any;
  ts?: number;
}

type Tab = 'terminal' | 'logs' | 'jobs' | 'models' | 'stats' | 'credits' | 'users' | 'errors' | 'beta';

interface BetaCode {
  id: string;
  code: string;
  label: string | null;
  maxUses: number | null;
  uses: number;
  isAdmin: boolean;
  active: boolean;
  batchId?: string | null;
  usedAt?: number | null;
  usedIp?: string | null;
  usedDeviceId?: string | null;
  usedUserAgent?: string | null;
  usedByUserId?: string | null;
  usedByEmail?: string | null;
  account?: {
    connected: boolean;
    name?: string;
    email?: string;
    creditsAvailable?: number;
    creditsUsed?: number;
  };
  createdAt?: number;
}

function getToken() {
  return getAuthToken();
}

async function adminFetch(path: string, opts?: RequestInit) {
  const token = getToken();
  return fetch(`/api/admin${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  }).then(r => r.json());
}

// ─── Command System ──────────────────────────────────────────
interface CmdOutput {
  type: 'text' | 'error' | 'success' | 'table' | 'info';
  content: string;
}

interface Command {
  name: string;
  aliases: string[];
  desc: string;
  usage: string;
  run: (args: string[], ctx: CommandContext) => Promise<CmdOutput[]>;
}

interface CommandContext {
  jobs: Job[];
  models: ModelHealth[];
  logs: DebugEntry[];
  setTab: (t: Tab) => void;
  refreshJobs: () => Promise<void>;
  refreshModels: () => Promise<void>;
  clearLogs: () => void;
  openApiKeyForm: () => void;
  openCommsConsole: () => void;
}

const COMMANDS: Command[] = [
  {
    name: 'help',
    aliases: ['h', '?'],
    desc: 'Show available commands or help for a specific command',
    usage: 'help [command]',
    run: async (args) => {
      if (args[0]) {
        const cmd = COMMANDS.find(c => c.name === args[0] || c.aliases.includes(args[0]));
        if (!cmd) return [{ type: 'error', content: `Unknown command: ${args[0]}` }];
        return [
          { type: 'info', content: `Command: ${cmd.name}` },
          { type: 'text', content: `Description: ${cmd.desc}` },
          { type: 'text', content: `Usage: ${cmd.usage}` },
          { type: 'text', content: `Aliases: ${cmd.aliases.length ? cmd.aliases.join(', ') : 'none'}` },
        ];
      }
      return [
        { type: 'info', content: '╔══════════════════════════════════════╗' },
        { type: 'info', content: '║       VELBAZ ADMIN COMMANDS          ║' },
        { type: 'info', content: '╚══════════════════════════════════════╝' },
        { type: 'text', content: '' },
        { type: 'text', content: 'Type "all commands" or "commands" for full list.' },
        { type: 'text', content: 'Type "help <command>" for details on a command.' },
        { type: 'text', content: '' },
        { type: 'success', content: 'Quick start:' },
        { type: 'text', content: '  status     → system overview' },
        { type: 'text', content: '  jobs       → list active jobs' },
        { type: 'text', content: '  models     → model health status' },
        { type: 'text', content: '  errors     → recent errors' },
        { type: 'text', content: '  users      → list all users' },
        { type: 'text', content: '  kill <id>  → kill a job' },
        { type: 'text', content: '  add <n> token <user>  → give tokens' },
        { type: 'text', content: '  remove <n> token <user> → take tokens' },
        { type: 'text', content: '  clear      → clear terminal' },
        { type: 'text', content: '' },
        { type: 'error', content: 'GOD MODE:' },
        { type: 'text', content: '  message <user> <title> | <body>  → DM a user' },
        { type: 'text', content: '  broadcast <title> | <body>       → message ALL users' },
        { type: 'text', content: '  ban <user>                       → ban/unban toggle' },
        { type: 'text', content: '  impersonate <user>               → login as user' },
        { type: 'text', content: '  whois <user>                     → full user profile & data' },
        { type: 'text', content: '  set-password <user> <pw>         → change user password' },
        { type: 'text', content: '  inspect <company>                → company deep dive' },
        { type: 'text', content: '  force-heartbeat <company>        → trigger heartbeat (free)' },
        { type: 'text', content: '  force-build <company>            → trigger website build (free)' },
        { type: 'text', content: '  delete-company <company>         → nuke company + data' },
        { type: 'text', content: '  reset-company <company>          → wipe data, keep shell' },
        { type: 'text', content: '  delete-user <user>               → nuke user + everything' },
        { type: 'text', content: '  ai [model:name] <prompt>         → raw AI query' },
        { type: 'text', content: '' },
        { type: 'success', content: '🔐 API KEYS (encrypted, write-only):' },
        { type: 'text', content: '  keys                             → key status + AI providers' },
        { type: 'text', content: '  setkey <NAME> <value>            → set a key (Resend/HF/GitHub…)' },
        { type: 'text', content: '  delkey <NAME>                    → delete a key' },
        { type: 'text', content: '  setai <provider> <key> [baseUrl] → custom AI key (DIRECT, no gateway)' },
        { type: 'text', content: '  testai <provider>                → test an AI key' },
        { type: 'text', content: '  toggleai <provider> on|off       → enable/disable' },
        { type: 'text', content: '  delai <provider>                 → delete (fallback to gateway)' },
      ];
    },
  },
  {
    name: 'commands',
    aliases: ['all commands', 'allcommands', 'all', 'allcmds', 'cmds', 'list', 'ls'],
    desc: 'Show all available commands with descriptions',
    usage: 'commands',
    run: async () => {
      const out: CmdOutput[] = [
        { type: 'info', content: '╔══════════════════════════════════════════════════════════════╗' },
        { type: 'info', content: '║              TOUTES LES COMMANDES DISPONIBLES                 ║' },
        { type: 'info', content: '╚══════════════════════════════════════════════════════════════╝' },
        { type: 'text', content: '' },
      ];
      for (const cmd of COMMANDS) {
        // Nom + syntaxe exacte à taper
        out.push({ type: 'success', content: `▶ ${cmd.usage}` });
        out.push({ type: 'text', content: `    ${cmd.desc}` });
        if (cmd.aliases.length) {
          out.push({ type: 'info', content: `    alias : ${cmd.aliases.join(', ')}` });
        }
        out.push({ type: 'text', content: '' });
      }
      out.push({ type: 'info', content: `── ${COMMANDS.length} commands ── type "help <command>" for details.` });
      return out;
    },
  },
  {
    name: 'status',
    aliases: ['s', 'stat', 'overview'],
    desc: 'Show system status overview',
    usage: 'status',
    run: async () => {
      try {
        const data = await adminFetch('/stats');
        const mem = data.memory ? Math.round(data.memory.heapUsed / 1024 / 1024) : '?';
        const uptime = data.uptime ? `${Math.floor(data.uptime / 3600)}h ${Math.floor((data.uptime % 3600) / 60)}m` : '?';
        return [
          { type: 'info', content: '── SYSTEM STATUS ──' },
          { type: 'success', content: `  Uptime:       ${uptime}` },
          { type: 'text', content: `  Memory:       ${mem} MB` },
          { type: 'text', content: `  Active Jobs:  ${data.activeJobs ?? 0}` },
          { type: 'text', content: `  Debug Logs:   ${data.debugLogCount ?? 0}` },
          { type: 'text', content: `  Models:       ${(data.models || []).length} tracked` },
          { type: data.models?.some((m: any) => m.blocked) ? 'error' : 'success', content: `  Blocked:      ${(data.models || []).filter((m: any) => m.blocked).length} models` },
        ];
      } catch (e: any) {
        return [{ type: 'error', content: `Failed to fetch status: ${e.message}` }];
      }
    },
  },
  {
    name: 'jobs',
    aliases: ['j', 'job', 'tasks'],
    desc: 'List all active/recent jobs',
    usage: 'jobs',
    run: async (_args, ctx) => {
      try {
        const data = await adminFetch('/stats');
        const jobs = data.jobs || [];
        ctx.jobs.length = 0;
        jobs.forEach((j: Job) => ctx.jobs.push(j));
        if (jobs.length === 0) return [{ type: 'info', content: 'No active jobs.' }];
        const out: CmdOutput[] = [{ type: 'info', content: `── ${jobs.length} JOBS ──` }];
        for (const j of jobs) {
          const age = Date.now() - j.startedAt;
          const ageStr = age < 60000 ? `${Math.floor(age / 1000)}s` : `${Math.floor(age / 60000)}m`;
          const statusColor = j.status === 'running' ? 'success' : j.status === 'failed' ? 'error' : 'info';
          out.push({ type: statusColor as any, content: `  [${j.status.toUpperCase().padEnd(8)}] ${j.type.padEnd(20)} ${j.id.slice(0, 8)}  (${ageStr} ago)` });
          if (j.error) out.push({ type: 'error', content: `             └─ ${j.error}` });
        }
        out.push({ type: 'text', content: '' });
        out.push({ type: 'text', content: 'Use "kill <id>" to kill a job, "kill all" to kill all.' });
        return out;
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'kill',
    aliases: ['k', 'stop'],
    desc: 'Kill a job by ID (or "kill all" to kill all jobs)',
    usage: 'kill <jobId | all>',
    run: async (args, ctx) => {
      if (!args[0]) return [{ type: 'error', content: 'Usage: kill <jobId | all>' }];
      try {
        if (args[0] === 'all') {
          await adminFetch('/jobs/kill-all', { method: 'POST' });
          return [{ type: 'success', content: 'All jobs killed.' }];
        }
        const id = args[0];
        // find matching job
        const match = ctx.jobs.find(j => j.id.startsWith(id));
        if (!match) {
          await adminFetch(`/jobs/${id}/kill`, { method: 'POST' });
          return [{ type: 'success', content: `Sent kill signal for ${id}` }];
        }
        await adminFetch(`/jobs/${match.id}/kill`, { method: 'POST' });
        return [{ type: 'success', content: `Killed job ${match.id.slice(0, 8)} (${match.type})` }];
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'clear-jobs',
    aliases: ['cj', 'cleanup'],
    desc: 'Clear completed/failed jobs from the list',
    usage: 'clear-jobs',
    run: async () => {
      try {
        await adminFetch('/jobs/clear', { method: 'POST' });
        return [{ type: 'success', content: 'Cleared completed/failed jobs.' }];
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'models',
    aliases: ['m', 'model', 'health'],
    desc: 'Show model health status',
    usage: 'models',
    run: async () => {
      try {
        const data = await adminFetch('/stats');
        const models = data.models || [];
        if (models.length === 0) return [{ type: 'info', content: 'No model data available.' }];
        const out: CmdOutput[] = [{ type: 'info', content: '── MODEL HEALTH ──' }];
        for (const m of models) {
          const status = m.blocked ? '✖ BLOCKED' : '● HEALTHY';
          const statusType = m.blocked ? 'error' : 'success';
          out.push({ type: statusType as any, content: `  ${status}  ${m.model.padEnd(30)} failures: ${m.failures}` });
          if (m.blocked && m.blockedUntil) {
            out.push({ type: 'error', content: `            └─ blocked until ${new Date(m.blockedUntil).toLocaleTimeString()}` });
          }
        }
        out.push({ type: 'text', content: '' });
        out.push({ type: 'text', content: 'Use "reset models" to clear all failures.' });
        return out;
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'reset',
    aliases: ['r'],
    desc: 'Reset model health (clears all failures/blocks)',
    usage: 'reset models',
    run: async (args) => {
      if (args[0] === 'models' || args.length === 0) {
        try {
          const r = await adminFetch('/models/reset', { method: 'POST' });
          return [{ type: 'success', content: `Model health reset. ${r?.cleared ?? 0} record(s) cleared.` }];
        } catch (e: any) {
          return [{ type: 'error', content: `Failed: ${e.message}` }];
        }
      }
      return [{ type: 'error', content: 'Usage: reset models' }];
    },
  },
  {
    name: 'users',
    aliases: ['u', 'user'],
    desc: 'List all registered users',
    usage: 'users',
    run: async () => {
      try {
        const data = await adminFetch('/users');
        const users = data.users || [];
        if (users.length === 0) return [{ type: 'info', content: 'No users found.' }];
        const out: CmdOutput[] = [{ type: 'info', content: `── ${users.length} USERS ──` }];
        for (const u of users) {
          const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '?';
          out.push({ type: 'text', content: `  ${(u.name || 'Unnamed').padEnd(20)} ${(u.email || '').padEnd(35)} joined ${date}` });
        }
        return out;
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'beta',
    aliases: ['b'],
    desc: 'Beta: mode on|off (access gate) | gen <n> | list | stats | revoke <code> | on|off <code>',
    usage: 'beta <mode|gen|list|stats|revoke|on|off> [arg]',
    run: async (args) => {
      const sub = (args[0] || '').toLowerCase();
      try {
        // ── Mode global : activer / désactiver la porte d'accès par code ──
        if (sub === 'mode') {
          const action = (args[1] || '').toLowerCase();
          if (action === 'on' || action === 'off' || action === 'enable' || action === 'disable') {
            const enabled = action === 'on' || action === 'enable';
            const res = await adminFetch('/beta/mode', { method: 'POST', body: JSON.stringify({ enabled }) });
            if (!res?.ok) return [{ type: 'error', content: res?.error || 'Failure' }];
            return enabled
              ? [{ type: 'success', content: '🔒 Beta mode ENABLED — the site requires an access code at entry.' }]
              : [{ type: 'success', content: '🔓 Beta mode DISABLED — the site is freely accessible, no code required.' }];
          }
          // Sans argument → montre l'état courant.
          const r = await adminFetch('/beta/mode');
          return [{ type: r?.enabled ? 'error' : 'success', content: `Beta mode: ${r?.enabled ? 'ENABLED (code required)' : 'DISABLED (open access)'}` },
                  { type: 'text', content: 'Usage: beta mode on  |  beta mode off' }];
        }
        if (sub === 'gen' || sub === 'generate') {
          const n = Math.min(500, Math.max(1, parseInt(args[1], 10) || 0));
          if (!n) return [{ type: 'error', content: 'Usage: beta gen <n>  (1-500)' }];
          const r = await adminFetch('/beta/generate', { method: 'POST', body: JSON.stringify({ count: n }) });
          if (!r?.ok) return [{ type: 'error', content: r?.error || 'Failure' }];
          const out: CmdOutput[] = [{ type: 'success', content: `${r.count} code(s) generated — batch ${r.batchId}` }];
          for (const c of (r.codes || [])) out.push({ type: 'text', content: `  ${c}` });
          return out;
        }
        if (sub === 'list' || sub === 'ls' || !sub) {
          const r = await adminFetch('/beta/codes');
          const codes: any[] = (r?.codes || []).filter((c: any) => !c.isAdmin);
          if (codes.length === 0) return [{ type: 'info', content: 'No beta codes.' }];
          const out: CmdOutput[] = [{ type: 'info', content: `── ${codes.length} CODES ──` }];
          for (const c of codes) {
            const used = (c.uses || 0) > 0 || c.usedAt;
            const acc = c.account?.connected ? ` → ${c.account.email} (${c.account.creditsAvailable ?? 0} available / ${c.account.creditsUsed ?? 0} used)` : '';
            out.push({ type: 'text', content: `  ${c.code.padEnd(16)} ${c.active ? 'ON ' : 'OFF'} ${used ? 'USED' : 'free'} ${(c.usedIp || '').padEnd(15)}${acc}` });
          }
          return out;
        }
        if (sub === 'stats') {
          const r = await adminFetch('/beta/codes');
          const codes: any[] = (r?.codes || []).filter((c: any) => !c.isAdmin);
          const used = codes.filter(c => (c.uses || 0) > 0 || c.usedAt).length;
          const connected = codes.filter(c => c.account?.connected).length;
          const active = codes.filter(c => c.active).length;
          let mode = false;
          try { mode = !!(await adminFetch('/beta/mode'))?.enabled; } catch {}
          return [
            { type: 'info', content: '── BETA STATS ──' },
            { type: mode ? 'error' : 'success', content: `  Mode     : ${mode ? 'ENABLED (code required)' : 'DISABLED (open access)'}` },
            { type: 'text', content: `  Generated: ${codes.length}` },
            { type: 'text', content: `  Active   : ${active}` },
            { type: 'text', content: `  Used  : ${used}` },
            { type: 'text', content: `  Accounts : ${connected}` },
          ];
        }
        if (sub === 'revoke' || sub === 'on' || sub === 'off') {
          const codeStr = (args[1] || '').trim();
          if (!codeStr) return [{ type: 'error', content: `Usage: beta ${sub} <code>` }];
          const r = await adminFetch('/beta/codes');
          const found = (r?.codes || []).find((c: any) => c.code.toLowerCase() === codeStr.toLowerCase());
          if (!found) return [{ type: 'error', content: `Code not found: ${codeStr}` }];
          const active = sub === 'on';
          const res = await adminFetch(`/beta/codes/${found.id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
          if (!res?.ok) return [{ type: 'error', content: res?.error || 'Failure' }];
          return [{ type: 'success', content: `${found.code} → ${active ? 'ENABLED' : 'DISABLED'}` }];
        }
        return [{ type: 'error', content: 'Unknown subcommand. beta <gen|list|stats|revoke|on|off>' }];
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'errors',
    aliases: ['e', 'err'],
    desc: 'Show recent error logs (all sources)',
    usage: 'errors [count]',
    run: async (args) => {
      try {
        const data = await adminFetch('/errors?limit=50');
        const out: CmdOutput[] = [];
        const limit = parseInt(args[0]) || 20;

        // Runtime errors
        const mem = (data.memErrors || []).slice(-limit);
        if (mem.length > 0) {
          out.push({ type: 'error', content: `── RUNTIME ERRORS (${mem.length}) ──` });
          for (const e of mem) {
            const time = new Date(e.ts).toLocaleTimeString('en-US', { hour12: false });
            out.push({ type: 'error', content: `  [${time}] ${e.level.toUpperCase()} ${e.message.slice(0, 120)}` });
          }
        }

        // Failed jobs
        const fj = data.failedJobs || [];
        if (fj.length > 0) {
          out.push({ type: 'text', content: '' });
          out.push({ type: 'info', content: `── FAILED JOBS (${fj.length}) ──` });
          for (const j of fj) {
            out.push({ type: 'error', content: `  [${j.jobType}] ${j.message.slice(0, 120)}` });
          }
        }

        // Agent errors
        const db = (data.dbErrors || []).slice(0, limit);
        if (db.length > 0) {
          out.push({ type: 'text', content: '' });
          out.push({ type: 'info', content: `── AGENT ERRORS (${db.length}) ──` });
          for (const e of db) {
            const time = e.ts ? new Date(e.ts).toLocaleTimeString('en-US', { hour12: false }) : '?';
            const company = e.companyName || e.companyId?.slice(0, 8) || '?';
            out.push({ type: 'error', content: `  [${time}] [${company}] [${e.agentRole || '?'}] ${e.message.slice(0, 100)}` });
          }
        }

        if (out.length === 0) return [{ type: 'success', content: 'No errors recorded. Clean slate!' }];
        out.push({ type: 'text', content: '' });
        out.push({ type: 'text', content: `Total: ${data.total || 0} errors` });
        return out;
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'logs',
    aliases: ['l', 'log'],
    desc: 'Show recent debug logs (switch to Logs tab)',
    usage: 'logs [count]',
    run: async (args, ctx) => {
      const count = parseInt(args[0]) || 30;
      const recent = ctx.logs.slice(-count);
      if (recent.length === 0) return [{ type: 'info', content: 'No logs yet.' }];
      const out: CmdOutput[] = [{ type: 'info', content: `── LAST ${recent.length} LOGS ──` }];
      for (const l of recent) {
        const time = new Date(l.ts).toLocaleTimeString('en-US', { hour12: false });
        out.push({
          type: l.level === 'error' ? 'error' : l.level === 'warn' ? 'error' : l.level === 'ai' ? 'info' : 'text',
          content: `  [${time}] ${l.level.toUpperCase().padEnd(5)} [${l.category}] ${l.message}`,
        });
      }
      return out;
    },
  },
  {
    name: 'clear',
    aliases: ['cls', 'c'],
    desc: 'Clear the terminal output',
    usage: 'clear',
    run: async () => {
      return [{ type: 'text', content: '__CLEAR__' }];
    },
  },
  {
    name: 'goto',
    aliases: ['go', 'tab', 'open'],
    desc: 'Switch to a specific tab (logs, jobs, models, stats, credits, users, errors, beta)',
    usage: 'goto <tab>',
    run: async (args, ctx) => {
      // La liste doit couvrir TOUS les onglets réellement rendus, sinon
      // « goto credits » / « goto beta » échouaient alors que l'onglet existe.
      const valid: Tab[] = ['terminal', 'logs', 'jobs', 'models', 'stats', 'credits', 'users', 'errors', 'beta'];
      const target = args[0]?.toLowerCase() as Tab;
      if (!target || !valid.includes(target)) {
        return [{ type: 'error', content: `Usage: goto <${valid.join(' | ')}>` }];
      }
      ctx.setTab(target);
      return [{ type: 'success', content: `Switched to ${target} tab.` }];
    },
  },
  {
    name: 'companies',
    aliases: ['comp', 'projects'],
    desc: 'List all companies/projects',
    usage: 'companies',
    run: async () => {
      try {
        const data = await adminFetch('/companies');
        const companies = data.companies || [];
        if (companies.length === 0) return [{ type: 'info', content: 'No companies found.' }];
        const out: CmdOutput[] = [{ type: 'info', content: `── ${companies.length} COMPANIES ──` }];
        for (const c of companies) {
          out.push({ type: 'text', content: `  ${(c.name || 'Unnamed').padEnd(25)} ${(c.industry || '').padEnd(20)} id: ${(c.id || '').slice(0, 8)}` });
        }
        return out;
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'debug',
    aliases: ['d', 'raw'],
    desc: 'Fetch raw debug data from server',
    usage: 'debug',
    run: async () => {
      try {
        const data = await adminFetch('/debug');
        const count = data.logs?.length || 0;
        return [
          { type: 'info', content: `── RAW DEBUG: ${count} entries ──` },
          { type: 'text', content: JSON.stringify(data.logs?.slice(-5) || [], null, 2) },
        ];
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'add',
    aliases: [],
    desc: 'Add tokens to a user: add <number> token <username>',
    usage: 'add <number> token <username>',
    run: async (args) => {
      // parse: add 100 token john
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount <= 0) return [{ type: 'error', content: 'Usage: add <number> token <username>' }];
      if (args[1] !== 'token' && args[1] !== 'tokens') return [{ type: 'error', content: 'Usage: add <number> token <username>' }];
      const username = args.slice(2).join(' ');
      if (!username) return [{ type: 'error', content: 'Usage: add <number> token <username>' }];
      try {
        const res = await adminFetch('/tokens/add', { method: 'POST', body: JSON.stringify({ username, amount }) });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [{ type: 'success', content: `Added ${res.added} tokens to ${res.user} (${res.email}). New balance: ${res.tokens}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'comms',
    aliases: ['marketing', 'pub'],
    desc: 'Open the communication / ads / marketing console (test + train the AI)',
    usage: 'comms',
    run: async (_args, ctx) => {
      ctx.openCommsConsole();
      return [{ type: 'success', content: 'Console comms ouverte. Simulation pure : rien n\'est publie ni envoye.' }];
    },
  },
  {
    name: 'set',
    aliases: ['apikey'],
    desc: 'Open the secure API keys panel (set api key)',
    usage: 'set api key',
    run: async (_args, ctx) => {
      ctx.openApiKeyForm();
      return [{ type: 'success', content: '🔐 API keys panel opened. Fill in the fields then "Confirm".' }];
    },
  },
  {
    name: 'remove',
    aliases: [],
    desc: 'Remove tokens from a user: remove <number> token <username>',
    usage: 'remove <number> token <username>',
    run: async (args) => {
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount <= 0) return [{ type: 'error', content: 'Usage: remove <number> token <username>' }];
      if (args[1] !== 'token' && args[1] !== 'tokens') return [{ type: 'error', content: 'Usage: remove <number> token <username>' }];
      const username = args.slice(2).join(' ');
      if (!username) return [{ type: 'error', content: 'Usage: remove <number> token <username>' }];
      try {
        const res = await adminFetch('/tokens/remove', { method: 'POST', body: JSON.stringify({ username, amount }) });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [{ type: 'success', content: `Removed ${res.removed} tokens from ${res.user} (${res.email}). New balance: ${res.tokens}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'ping',
    aliases: ['check'],
    desc: 'Check if admin API is reachable',
    usage: 'ping',
    run: async () => {
      try {
        const t0 = Date.now();
        await adminFetch('/check');
        const ms = Date.now() - t0;
        return [{ type: 'success', content: `Pong! Admin API responded in ${ms}ms` }];
      } catch (e: any) {
        return [{ type: 'error', content: `Admin API unreachable: ${e.message}` }];
      }
    },
  },
  // ══════════════════════════════════════════════════════
  //  GOD MODE COMMANDS
  // ══════════════════════════════════════════════════════
  {
    name: 'message',
    aliases: ['msg', 'notify', 'send'],
    desc: 'Send a notification to a user: message <username> <title> | <message>',
    usage: 'message <username> <title> | <body>',
    run: async (args) => {
      const raw = args.join(' ');
      // parse: username title | body
      const pipeIdx = raw.indexOf('|');
      if (pipeIdx === -1) return [{ type: 'error', content: 'Usage: message <username> <title> | <body>' }];
      const before = raw.slice(0, pipeIdx).trim();
      const body = raw.slice(pipeIdx + 1).trim();
      if (!body) return [{ type: 'error', content: 'Message body is empty' }];
      // first word is username, rest is title
      const parts = before.split(/\s+/);
      const username = parts[0];
      const title = parts.slice(1).join(' ') || 'Admin Message';
      if (!username) return [{ type: 'error', content: 'Usage: message <username> <title> | <body>' }];
      try {
        // Find user first
        const usersData = await adminFetch('/users');
        const user = (usersData.users || []).find((u: any) =>
          u.name?.toLowerCase() === username.toLowerCase() ||
          u.email?.toLowerCase() === username.toLowerCase()
        );
        if (!user) return [{ type: 'error', content: `User "${username}" not found` }];
        const res = await adminFetch(`/users/${user.id}/message`, {
          method: 'POST',
          body: JSON.stringify({ title, message: body, type: 'info' }),
        });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [{ type: 'success', content: `Message sent to ${res.sent.to} (${res.sent.email}): "${title}"` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'broadcast',
    aliases: ['announce', 'bc'],
    desc: 'Send a message to ALL users: broadcast <title> | <message>',
    usage: 'broadcast <title> | <message>',
    run: async (args) => {
      const raw = args.join(' ');
      const pipeIdx = raw.indexOf('|');
      if (pipeIdx === -1) return [{ type: 'error', content: 'Usage: broadcast <title> | <body>' }];
      const title = raw.slice(0, pipeIdx).trim();
      const body = raw.slice(pipeIdx + 1).trim();
      if (!title || !body) return [{ type: 'error', content: 'Title and body required' }];
      try {
        const res = await adminFetch('/broadcast', {
          method: 'POST',
          body: JSON.stringify({ title, message: body, type: 'info' }),
        });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [{ type: 'success', content: `Broadcast sent to ${res.sentTo} users: "${title}"` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    // Envoi simple : pas de titre, pas de pipe. `dm <email|userId> <texte…>`
    // Passe par /api/admin/notify (requireAdmin serveur, 404 pour un non-admin).
    name: 'dm',
    aliases: ['sendto', 'msgto', 'notif'],
    desc: 'Envoyer un message à un utilisateur (notification en haut de son écran): dm <email|userId> <texte>',
    usage: 'dm <email|userId> <texte…>',
    run: async (args) => {
      const to = (args[0] || '').trim();
      const body = args.slice(1).join(' ').trim();
      if (!to || !body) return [{ type: 'error', content: 'Usage: dm <email|userId> <texte…>' }];
      try {
        const res = await adminFetch('/notify', {
          method: 'POST',
          body: JSON.stringify({ to, message: body }),
        });
        if (res?.error) return [{ type: 'error', content: res.error }];
        return [{ type: 'success', content: `Message envoyé à ${res.sent.to} (${res.sent.email})` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    // Historique : tous les messages reçus par un compte, lus ou pas.
    // Lecture seule (GET /api/admin/notify/history) : ne marque rien comme lu,
    // ne supprime rien.
    name: 'msgs',
    aliases: ['history', 'historique', 'inbox', 'dmlog'],
    desc: "Voir l'historique des messages reçus par un compte (lus / non lus): msgs <email|userId> [nombre]",
    usage: 'msgs <email|userId> [nombre=50]',
    run: async (args) => {
      const to = (args[0] || '').trim();
      if (!to) return [{ type: 'error', content: 'Usage: msgs <email|userId> [nombre]' }];
      const limit = Math.min(Math.max(parseInt(args[1] || '50', 10) || 50, 1), 200);
      try {
        const res = await adminFetch(`/notify/history?to=${encodeURIComponent(to)}&limit=${limit}`);
        if (res?.error) return [{ type: 'error', content: res.error }];
        const out: CmdOutput[] = [
          { type: 'success', content: `${res.user.name || res.user.email} — ${res.total} message(s), ${res.unread} non lu(s)` },
          { type: 'text', content: `id: ${res.user.id}` },
          { type: 'text', content: '' },
        ];
        if (res.total === 0) {
          out.push({ type: 'info', content: "Aucun message reçu sur ce compte." });
          return out;
        }
        // Plus récent en haut (l'API renvoie déjà dans cet ordre).
        for (const m of res.messages) {
          const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : '—';
          const state = m.read ? 'lu' : 'NON LU';
          const src = m.fromAdmin ? 'admin' : 'système';
          out.push({ type: m.read ? 'text' : 'info', content: `[${state}] ${when} · ${src} · ${m.type}` });
          if (m.title) out.push({ type: 'text', content: `  ${m.title}` });
          out.push({ type: 'text', content: `  ${m.message}` });
          out.push({ type: 'text', content: '' });
        }
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'higgsfield',
    aliases: ['hf', 'marketing'],
    desc: 'Connect the master Higgsfield account (Marketing Studio) — owner login once',
    usage: 'higgsfield <connect|status|tools|queue|disconnect>',
    run: async (args) => {
      const sub = (args[0] || 'status').toLowerCase();
      try {
        if (sub === 'connect' || sub === 'login') {
          const res = await adminFetch('/higgsfield/oauth/start', { method: 'POST' });
          if (res.error) return [{ type: 'error', content: res.error }];
          return [
            { type: 'success', content: '🔗 Open this link, log in to YOUR Higgsfield account, authorize:' },
            { type: 'info', content: res.authUrl },
            { type: 'text', content: '' },
            { type: 'text', content: 'Just once. After that, Velbaz generates all ads on your account.' },
            { type: 'text', content: 'Come back here and type "higgsfield status" to verify.' },
          ];
        }
        if (sub === 'status') {
          const s = await adminFetch('/higgsfield/status');
          if (s.error) return [{ type: 'error', content: s.error }];
          if (!s.connected) return [{ type: 'error', content: '❌ Not connected. Type "higgsfield connect".' }];
          return [
            { type: 'success', content: `✅ Connected${s.accountEmail ? ' — ' + s.accountEmail : ''}` },
            { type: 'text', content: `Connected on: ${s.connectedAt ? new Date(s.connectedAt).toLocaleString() : '—'}` },
            { type: 'text', content: `Token valid until: ${s.tokenValidUntil ? new Date(s.tokenValidUntil).toLocaleTimeString() : '—'} (auto-renewed)` },
          ];
        }
        if (sub === 'tools') {
          const t = await adminFetch('/higgsfield/tools');
          if (t.error) return [{ type: 'error', content: t.error }];
          const out: CmdOutput[] = [{ type: 'success', content: `${t.count} Marketing Studio tools available:` }];
          for (const tool of t.tools || []) {
            out.push({ type: 'info', content: `• ${tool.name}` });
            if (tool.description) out.push({ type: 'text', content: `    ${String(tool.description).slice(0, 120)}` });
          }
          return out;
        }
        if (sub === 'queue') {
          // "higgsfield queue"      → état de la file
          // "higgsfield queue 8"    → règle le parallélisme max à 8
          const n = args[1] ? Number(args[1]) : NaN;
          const q = Number.isFinite(n) && n >= 1
            ? await adminFetch('/higgsfield/queue', { method: 'POST', body: JSON.stringify({ maxParallel: n }) })
            : await adminFetch('/higgsfield/queue');
          if (q.error) return [{ type: 'error', content: q.error }];
          const bs = q.byStatus || {};
          const out: CmdOutput[] = [
            { type: 'success', content: `🎬 Video ads queue — max parallelism: ${q.maxParallel}` },
            { type: 'text', content: `Running: ${q.running}   |   Pending: ${q.pending}` },
            { type: 'text', content: `Completed: ${bs.completed || 0}   |   Failures : ${bs.failed || 0}   |   En pause : ${bs.skipped || 0}   |   File DB : ${bs.queued || 0}` },
          ];
          if (!(Number.isFinite(n) && n >= 1)) out.push({ type: 'info', content: 'Tip: "higgsfield queue 8" to set parallelism according to your plan.' });
          else out.push({ type: 'success', content: `✅ Parallelism set to ${q.maxParallel}.` });
          return out;
        }
        if (sub === 'disconnect' || sub === 'logout') {
          const r = await adminFetch('/higgsfield/disconnect', { method: 'POST' });
          if (r.error) return [{ type: 'error', content: r.error }];
          return [{ type: 'success', content: 'Disconnected. Type "higgsfield connect" to reconnect.' }];
        }
        return [{ type: 'error', content: 'Usage: higgsfield <connect|status|tools|queue|disconnect>' }];
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'ban',
    aliases: ['unban', 'block'],
    desc: 'Ban or unban a user (toggles): ban <username>',
    usage: 'ban <username>',
    run: async (args) => {
      const username = args.join(' ');
      if (!username) return [{ type: 'error', content: 'Usage: ban <username>' }];
      try {
        const usersData = await adminFetch('/users');
        const user = (usersData.users || []).find((u: any) =>
          u.name?.toLowerCase() === username.toLowerCase() ||
          u.email?.toLowerCase() === username.toLowerCase()
        );
        if (!user) return [{ type: 'error', content: `User "${username}" not found` }];
        const res = await adminFetch(`/users/${user.id}/ban`, { method: 'POST' });
        if (res.error) return [{ type: 'error', content: res.error }];
        const color = res.action === 'banned' ? 'error' : 'success';
        return [{ type: color as any, content: `${res.action.toUpperCase()}: ${res.user} (${res.email})` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    // Ouvre une fenêtre (rectangle déplaçable) avec l'app entière connectée au
    // compte de l'utilisateur. Le token ne passe jamais par l'URL ni par
    // localStorage : code à usage unique de 60 s → token gardé en mémoire dans
    // l'iframe. Ta session admin de l'onglet parent n'est pas touchée.
    // `impersonate token <user>` garde l'ancien comportement (token affiché).
    name: 'impersonate',
    aliases: ['sudo', 'login-as', 'su', 'connectas'],
    desc: "Ouvrir l'app dans le compte d'un utilisateur (fenêtre): impersonate <email|userId|nom>",
    usage: 'impersonate <email|userId|nom>  |  impersonate token <nom>',
    run: async (args) => {
      // ── Ancien mode : impersonate token <nom> → affiche juste le token ──
      if ((args[0] || '').toLowerCase() === 'token') {
        const username = args.slice(1).join(' ');
        if (!username) return [{ type: 'error', content: 'Usage: impersonate token <username>' }];
        try {
          const usersData = await adminFetch('/users');
          const user = (usersData.users || []).find((u: any) =>
            u.name?.toLowerCase() === username.toLowerCase() ||
            u.email?.toLowerCase() === username.toLowerCase()
          );
          if (!user) return [{ type: 'error', content: `User "${username}" not found` }];
          const res = await adminFetch(`/users/${user.id}/impersonate`, { method: 'POST' });
          if (res.error) return [{ type: 'error', content: res.error }];
          return [
            { type: 'success', content: `Impersonation token for ${res.user} (${res.email}):` },
            { type: 'info', content: `  Token: ${res.token}` },
            { type: 'text', content: `  Expires: ${res.expiresIn}` },
          ];
        } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
      }

      // ── Mode fenêtre ──
      const who = args.join(' ').trim();
      if (!who) return [{ type: 'error', content: 'Usage: impersonate <email|userId|nom>' }];
      try {
        let to = who;
        // Ni email ni uuid → on résout le nom via la liste des utilisateurs.
        if (!who.includes('@') && !/^[0-9a-f-]{20,}$/i.test(who)) {
          const usersData = await adminFetch('/users');
          const user = (usersData.users || []).find((u: any) =>
            u.name?.toLowerCase() === who.toLowerCase() ||
            u.email?.toLowerCase() === who.toLowerCase()
          );
          if (!user) return [{ type: 'error', content: `User "${who}" not found` }];
          to = user.id;
        }
        const res = await adminFetch('/impersonate/start', {
          method: 'POST',
          body: JSON.stringify({ to }),
        });
        if (res?.error) return [{ type: 'error', content: res.error }];
        window.dispatchEvent(new CustomEvent('velbaz-login-as', { detail: { code: res.code, user: res.user } }));
        return [
          { type: 'success', content: `Fenêtre ouverte sur le compte de ${res.user.name || res.user.email}` },
          { type: 'text', content: `  ${res.user.email} · session ${res.expiresIn} · ferme la fenêtre pour quitter` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'force-heartbeat',
    aliases: ['fhb', 'heartbeat'],
    desc: 'Force-trigger heartbeat on a company (free, no tokens): force-heartbeat <companyId>',
    usage: 'force-heartbeat <companyId>',
    run: async (args) => {
      const companyId = args[0];
      if (!companyId) return [{ type: 'error', content: 'Usage: force-heartbeat <companyId>' }];
      try {
        // Try matching partial ID
        const companiesData = await adminFetch('/companies');
        const match = (companiesData.companies || []).find((c: any) => c.id.startsWith(companyId) || c.name?.toLowerCase() === companyId.toLowerCase());
        const id = match?.id || companyId;
        const res = await adminFetch(`/companies/${id}/force-heartbeat`, { method: 'POST' });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [{ type: 'success', content: `Heartbeat ${res.status} for "${res.company}" — Job: ${res.jobId?.slice(0, 8)}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'force-build',
    aliases: ['fb', 'build'],
    desc: 'Force-trigger website build on a company (free): force-build <companyId>',
    usage: 'force-build <companyId>',
    run: async (args) => {
      const companyId = args[0];
      if (!companyId) return [{ type: 'error', content: 'Usage: force-build <companyId>' }];
      try {
        const companiesData = await adminFetch('/companies');
        const match = (companiesData.companies || []).find((c: any) => c.id.startsWith(companyId) || c.name?.toLowerCase() === companyId.toLowerCase());
        const id = match?.id || companyId;
        const res = await adminFetch(`/companies/${id}/force-build`, { method: 'POST' });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [{ type: 'success', content: `Website build ${res.status} for "${res.company}" — Job: ${res.jobId?.slice(0, 8)}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'calendar',
    aliases: ['cal', 'agenda'],
    desc: 'Internal AI calendar for a company: calendar <list|add|delete> <companyId> ...',
    usage: 'calendar list <companyId> [all] | calendar add <companyId> <category> <YYYY-MM-DD> <title...> | calendar delete <companyId> <eventId>',
    run: async (args) => {
      const sub = (args[0] || '').toLowerCase();
      const rawId = args[1];
      if (!sub || !rawId) return [{ type: 'error', content: 'Usage: calendar <list|add|delete> <companyId> ...' }];
      try {
        const companiesData = await adminFetch('/companies');
        const match = (companiesData.companies || []).find((c: any) => c.id.startsWith(rawId) || c.name?.toLowerCase() === rawId.toLowerCase());
        const id = match?.id || rawId;
        const cname = match?.name || id.slice(0, 8);

        if (sub === 'list' || sub === 'ls') {
          const all = (args[2] || '').toLowerCase() === 'all' ? '?all=1' : '';
          const res = await adminFetch(`/companies/${id}/calendar${all}`);
          if (res.error) return [{ type: 'error', content: res.error }];
          const events = res.events || [];
          if (!events.length) return [{ type: 'info', content: `📅 No events for "${cname}".` }];
          const fmt = (d: any) => { try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d); } };
          const out: CmdOutput[] = [{ type: 'success', content: `📅 Internal calendar — "${cname}" (${events.length})` }];
          for (const ev of events) {
            const icon = ev.category === 'client_meeting' ? '🤝' : ev.category === 'deadline' ? '⏰' : ev.category === 'marketing' ? '📣' : ev.category === 'reminder' ? '🔔' : ev.category === 'update' ? '🔧' : '✅';
            out.push({ type: 'info', content: `${icon} [${fmt(ev.eventDate)}] ${ev.title}  ·  ${ev.category}  ·  ${ev.status}${ev.conflictNote ? '  ⚠️ ' + ev.conflictNote : ''}` });
            out.push({ type: 'text', content: `    id: ${ev.id}${ev.clientName ? '  ·  client: ' + ev.clientName : ''}` });
          }
          return out;
        }

        if (sub === 'add') {
          const category = (args[2] || '').toLowerCase();
          const date = args[3];
          const title = args.slice(4).join(' ');
          const valid = ['marketing', 'task', 'reminder', 'update', 'deadline', 'client_meeting'];
          if (!valid.includes(category)) return [{ type: 'error', content: `Invalid category. Choices: ${valid.join(', ')}` }];
          if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [{ type: 'error', content: 'Date required in YYYY-MM-DD format' }];
          if (!title) return [{ type: 'error', content: 'Title required' }];
          const res = await adminFetch(`/companies/${id}/calendar`, { method: 'POST', body: JSON.stringify({ category, title, date }) });
          if (res.error) return [{ type: 'error', content: res.error }];
          const fmtAdd = (d: any) => { try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d); } };
          const out: CmdOutput[] = [{ type: 'success', content: `✅ Event added to "${cname}" — ${fmtAdd(res.event?.eventDate)}: ${res.event?.title}` }];
          if (res.conflict) out.push({ type: 'text', content: res.conflict });
          out.push({ type: 'text', content: `id: ${res.event?.id}` });
          return out;
        }

        if (sub === 'delete' || sub === 'del' || sub === 'rm') {
          const eventId = args[2];
          if (!eventId) return [{ type: 'error', content: 'Usage: calendar delete <companyId> <eventId>' }];
          const res = await adminFetch(`/companies/${id}/calendar?eventId=${encodeURIComponent(eventId)}`, { method: 'DELETE' });
          if (res.error) return [{ type: 'error', content: res.error }];
          return [{ type: 'success', content: `🗑️ Event deleted (${eventId}).` }];
        }

        return [{ type: 'error', content: 'Usage: calendar <list|add|delete> <companyId> ...' }];
      } catch (e: any) {
        return [{ type: 'error', content: `Failed: ${e.message}` }];
      }
    },
  },
  {
    name: 'delete-company',
    aliases: ['dc', 'nuke-company'],
    desc: 'Permanently delete a company and ALL its data: delete-company <companyId>',
    usage: 'delete-company <companyId>',
    run: async (args) => {
      const companyId = args[0];
      if (!companyId) return [{ type: 'error', content: 'Usage: delete-company <companyId>' }];
      try {
        const companiesData = await adminFetch('/companies');
        const match = (companiesData.companies || []).find((c: any) => c.id.startsWith(companyId) || c.name?.toLowerCase() === companyId.toLowerCase());
        const id = match?.id || companyId;
        const token = getToken();
        const res = await fetch(`/api/admin/companies/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        }).then(r => r.json());
        if (res.error) return [{ type: 'error', content: res.error }];
        return [
          { type: 'error', content: `DELETED: "${res.deleted}" (${res.companyId.slice(0, 8)})` },
          { type: 'text', content: '  All agents, docs, website, memory, tasks — gone.' },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'reset-company',
    aliases: ['rc', 'wipe'],
    desc: 'Wipe all generated data for a company (keeps shell): reset-company <companyId>',
    usage: 'reset-company <companyId>',
    run: async (args) => {
      const companyId = args[0];
      if (!companyId) return [{ type: 'error', content: 'Usage: reset-company <companyId>' }];
      try {
        const companiesData = await adminFetch('/companies');
        const match = (companiesData.companies || []).find((c: any) => c.id.startsWith(companyId) || c.name?.toLowerCase() === companyId.toLowerCase());
        const id = match?.id || companyId;
        const res = await adminFetch(`/companies/${id}/reset`, { method: 'POST' });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [
          { type: 'success', content: `RESET: "${res.reset}" (${res.companyId.slice(0, 8)})` },
          { type: 'text', content: '  All data wiped. Company shell preserved for re-initialization.' },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'delete-user',
    aliases: ['du', 'nuke-user'],
    desc: 'Permanently delete a user and ALL their companies/data: delete-user <username>',
    usage: 'delete-user <username>',
    run: async (args) => {
      const username = args.join(' ');
      if (!username) return [{ type: 'error', content: 'Usage: delete-user <username>' }];
      try {
        const usersData = await adminFetch('/users');
        const user = (usersData.users || []).find((u: any) =>
          u.name?.toLowerCase() === username.toLowerCase() ||
          u.email?.toLowerCase() === username.toLowerCase()
        );
        if (!user) return [{ type: 'error', content: `User "${username}" not found` }];
        const token = getToken();
        const res = await fetch(`/api/admin/users/${user.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        }).then(r => r.json());
        if (res.error) return [{ type: 'error', content: res.error }];
        return [
          { type: 'error', content: `DELETED USER: ${res.deleted} (${res.email})` },
          { type: 'text', content: `  ${res.companiesDeleted} companies and all data destroyed.` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'ai',
    aliases: ['ask', 'prompt'],
    desc: 'Run a raw AI prompt: ai [model] <prompt>',
    usage: 'ai [model:] <prompt>  (e.g. ai What is 2+2 or ai model:gpt-5.4 Hello)',
    run: async (args) => {
      if (args.length === 0) return [{ type: 'error', content: 'Usage: ai [model:name] <prompt>' }];
      let model: string | undefined;
      let promptParts = [...args];
      // Check if first arg is model: prefix
      if (args[0].startsWith('model:')) {
        model = args[0].replace('model:', '');
        promptParts = args.slice(1);
      }
      const prompt = promptParts.join(' ');
      if (!prompt) return [{ type: 'error', content: 'Prompt is empty' }];
      try {
        const res = await adminFetch('/ai/prompt', {
          method: 'POST',
          body: JSON.stringify({ model, prompt, maxTokens: 2000 }),
        });
        if (res.error) return [{ type: 'error', content: res.error }];
        const lines = res.result.split('\n');
        return [
          { type: 'info', content: `── AI Response (${res.model}) ──` },
          ...lines.map((l: string) => ({ type: 'text' as const, content: `  ${l}` })),
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'inspect',
    aliases: ['company-info', 'ci'],
    desc: 'Inspect a company in detail: inspect <companyId or name>',
    usage: 'inspect <companyId>',
    run: async (args) => {
      const companyId = args[0];
      if (!companyId) return [{ type: 'error', content: 'Usage: inspect <companyId or name>' }];
      try {
        const companiesData = await adminFetch('/companies');
        const match = (companiesData.companies || []).find((c: any) => c.id.startsWith(companyId) || c.name?.toLowerCase() === companyId.toLowerCase());
        const id = match?.id || companyId;
        const res = await adminFetch(`/companies/${id}`);
        if (res.error) return [{ type: 'error', content: res.error }];
        const c = res.company;
        return [
          { type: 'info', content: `── COMPANY: ${c.name} ──` },
          { type: 'text', content: `  ID:            ${c.id}` },
          { type: 'text', content: `  Owner:         ${res.owner?.name || '?'} (${res.owner?.email || '?'})` },
          { type: 'text', content: `  Industry:      ${c.industry || 'N/A'}` },
          { type: 'text', content: `  Status:        ${c.status}` },
          { type: 'text', content: `  Idea:          ${(c.idea || '').slice(0, 100)}` },
          { type: 'text', content: `  Heartbeats:    ${c.heartbeatCount || 0}` },
          { type: 'text', content: `  Last HB:       ${c.lastHeartbeat ? new Date(c.lastHeartbeat).toLocaleString() : 'never'}` },
          { type: 'text', content: `  Auto HB:       ${c.autoHeartbeat ? 'ON' : 'OFF'}` },
          { type: 'text', content: `  ARR:           ${c.arr || 0}` },
          { type: 'text', content: `  MRR:           ${c.mrr || 0}` },
          { type: 'text', content: `  Agents:        ${res.agents}` },
          { type: 'text', content: `  Documents:     ${res.documents}` },
          { type: 'text', content: `  Website Pages: ${res.websitePages}` },
          { type: 'text', content: `  Active Jobs:   ${res.activeJobs}` },
          { type: 'text', content: `  Created:       ${c.createdAt ? new Date(c.createdAt).toLocaleString() : '?'}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'set-plan',
    aliases: ['plan', 'upgrade', 'give-plan', 'gift'],
    desc: 'Donner un abonnement à quelqu\'un. Durée optionnelle : 30d, 3m, 1y, une date (2026-12-31) ou forever. Sans durée = 1 mois.',
    usage: 'set-plan <username|email> <free|business|enterprise|banned> [durée|date]',
    run: async (args) => {
      if (args.length < 2) return [{ type: 'error', content: 'Usage: set-plan <username> <free|business|enterprise|banned> [durée|date]' }];
      const validPlans = ['free', 'business', 'pro', 'enterprise', 'banned'];
      // Le plan peut être le dernier mot, ou l'avant-dernier si une durée suit.
      const last = args[args.length - 1].toLowerCase();
      const beforeLast = args.length >= 3 ? args[args.length - 2].toLowerCase() : '';
      let plan = last, duration = '', consumed = 1;
      if (!validPlans.includes(last) && validPlans.includes(beforeLast)) {
        plan = beforeLast; duration = args[args.length - 1]; consumed = 2;
      }
      const username = args.slice(0, -consumed).join(' ');
      if (!validPlans.includes(plan)) return [{ type: 'error', content: `Plan invalide. Valides : free, business, enterprise, banned` }];
      if (!username) return [{ type: 'error', content: 'Utilisateur manquant. Usage: set-plan <username> <plan> [durée]' }];
      try {
        const usersData = await adminFetch('/users');
        const user = (usersData.users || []).find((u: any) =>
          u.name?.toLowerCase() === username.toLowerCase() ||
          u.email?.toLowerCase() === username.toLowerCase()
        );
        if (!user) return [{ type: 'error', content: `User "${username}" not found` }];
        // Use ban endpoint for banned, or direct update
        if (plan === 'banned') {
          const res = await adminFetch(`/users/${user.id}/ban`, { method: 'POST' });
          if (res.error) return [{ type: 'error', content: res.error }];
          return [{ type: 'error', content: `${res.user} is now BANNED` }];
        }
        const res = await adminFetch(`/users/${user.id}/set-plan`, {
          method: 'POST',
          body: JSON.stringify({ plan, duration: duration || undefined }),
        });
        if (res.error) return [{ type: 'error', content: res.error }];
        const out: CmdOutput[] = [
          { type: 'success', content: `${res.user} (${res.email}) : ${res.oldPlan} → ${res.newPlan}` },
        ];
        out.push({ type: 'info', content: res.expiresAt ? `  Valable jusqu'au ${res.expiresAtLabel}` : `  Abonnement sans date de fin` });
        if (res.creditsGranted > 0) out.push({ type: 'text', content: `  +${res.creditsGranted.toLocaleString()} crédits inclus (total : ${res.tokens.toLocaleString()})` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'set-password',
    aliases: ['passwd', 'reset-password', 'setpw'],
    desc: 'Change a user\'s password: set-password <username> <newpassword>',
    usage: 'set-password <username> <newpassword>',
    run: async (args) => {
      if (args.length < 2) return [{ type: 'error', content: 'Usage: set-password <username> <newpassword>' }];
      const newPassword = args[args.length - 1];
      const username = args.slice(0, -1).join(' ');
      try {
        const usersData = await adminFetch('/users');
        const user = (usersData.users || []).find((u: any) =>
          u.name?.toLowerCase() === username.toLowerCase() ||
          u.email?.toLowerCase() === username.toLowerCase()
        );
        if (!user) return [{ type: 'error', content: `User "${username}" not found` }];
        const res = await adminFetch(`/users/${user.id}/set-password`, {
          method: 'POST',
          body: JSON.stringify({ password: newPassword }),
        });
        if (res.error) return [{ type: 'error', content: res.error }];
        return [
          { type: 'success', content: `Password changed for ${res.user} (${res.email})` },
          { type: 'text', content: `  New password: ${newPassword}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'whois',
    aliases: ['lookup', 'profile', 'userinfo', 'who'],
    desc: 'Full profile of a user: whois <username or email>',
    usage: 'whois <username or email>',
    run: async (args) => {
      const username = args.join(' ');
      if (!username) return [{ type: 'error', content: 'Usage: whois <username or email>' }];
      try {
        // Find user ID first
        const usersData = await adminFetch('/users');
        const user = (usersData.users || []).find((u: any) =>
          u.name?.toLowerCase() === username.toLowerCase() ||
          u.email?.toLowerCase() === username.toLowerCase() ||
          u.id === username
        );
        if (!user) return [{ type: 'error', content: `User "${username}" not found` }];

        const data = await adminFetch(`/users/${user.id}/full-profile`);
        if (data.error) return [{ type: 'error', content: data.error }];

        const u = data.user;
        const s = data.stats;
        const created = u.createdAt ? new Date(u.createdAt).toLocaleString() : '?';

        const out: CmdOutput[] = [
          { type: 'info',    content: '╔══════════════════════════════════════════════════════════╗' },
          { type: 'info',    content: `║  WHOIS: ${(u.name || 'Unknown').toUpperCase().padEnd(46)}║` },
          { type: 'info',    content: '╠══════════════════════════════════════════════════════════╣' },
          { type: 'text',    content: '' },
          { type: 'success', content: '── IDENTITY ──' },
          { type: 'text',    content: `  ID:              ${u.id}` },
          { type: 'text',    content: `  Name:            ${u.name}` },
          { type: 'text',    content: `  Email:           ${u.email}` },
          { type: 'text',    content: `  Password Hash:   ${u.passwordHash}` },
          { type: 'text',    content: `  Plan:            ${u.plan}${u.planExpiresAt ? ` (jusqu'au ${new Date(u.planExpiresAt).toLocaleDateString('fr-FR')})` : u.plan !== 'free' ? ' (sans date de fin)' : ''}` },
          { type: 'text',    content: `  Tokens:          ${u.tokens}` },
          { type: 'text',    content: `  Joined:          ${created}` },
          { type: 'text',    content: '' },
          { type: 'success', content: '── STATS ──' },
          { type: 'text',    content: `  Companies:       ${s.totalCompanies}` },
          { type: 'text',    content: `  Total Tasks:     ${s.totalTasks}` },
          { type: 'text',    content: `  Messages Sent:   ${s.totalMessages}` },
          { type: 'text',    content: `  Tokens Spent:    ${s.totalTokensSpent}` },
          { type: 'text',    content: `  Tokens Added:    ${s.totalTokensAdded}` },
          { type: 'text',    content: `  Active Sessions: ${s.activeSessions}` },
        ];

        // Companies
        if (data.companies.length > 0) {
          out.push({ type: 'text', content: '' });
          out.push({ type: 'success', content: `── COMPANIES (${data.companies.length}) ──` });
          for (const co of data.companies) {
            const coDate = co.createdAt ? new Date(co.createdAt).toLocaleDateString() : '?';
            out.push({ type: 'text', content: `  ${co.name}` });
            out.push({ type: 'text', content: `    ID: ${co.id}` });
            out.push({ type: 'text', content: `    Status: ${co.status}  |  Industry: ${co.industry || 'N/A'}  |  Created: ${coDate}` });
            out.push({ type: 'text', content: `    Idea: ${(co.idea || '').slice(0, 80)}${(co.idea || '').length > 80 ? '...' : ''}` });
            out.push({ type: 'text', content: `    ARR: ${co.arr || 0}  |  MRR: ${co.mrr || 0}  |  Revenue: ${co.totalRevenue || 0}` });
            out.push({ type: 'text', content: `    Tasks: ${co.tasksCompleted || 0}  |  Emails: ${co.emailsSent || 0}  |  Heartbeats: ${co.heartbeatCount || 0}  |  Auto-HB: ${co.autoHeartbeat ? 'ON' : 'OFF'}` });
            if (co.website) out.push({ type: 'text', content: `    Website: ${co.website}` });
          }
        }

        // Sessions
        if (data.sessions.length > 0) {
          out.push({ type: 'text', content: '' });
          out.push({ type: 'success', content: `── SESSIONS (${data.sessions.length}) ──` });
          for (const sess of data.sessions) {
            const expires = sess.expiresAt ? new Date(sess.expiresAt).toLocaleString() : '?';
            const status = sess.active ? '● active' : '○ expired';
            out.push({ type: sess.active ? 'text' : 'error', content: `  ${sess.id}  ${status}  expires: ${expires}` });
          }
        }

        // Token history
        if (data.tokenHistory.length > 0) {
          out.push({ type: 'text', content: '' });
          out.push({ type: 'success', content: `── TOKEN HISTORY (last ${data.tokenHistory.length}) ──` });
          for (const t of data.tokenHistory) {
            const date = t.createdAt ? new Date(t.createdAt).toLocaleString() : '?';
            const sign = t.amount >= 0 ? '+' : '';
            const color = t.amount >= 0 ? 'success' : 'error';
            out.push({ type: color as any, content: `  ${sign}${t.amount}  [${t.type}${t.action ? '/' + t.action : ''}]  bal: ${t.balance}  ${date}` });
            if (t.note) out.push({ type: 'text', content: `    └─ ${t.note}` });
          }
        }

        out.push({ type: 'text', content: '' });
        out.push({ type: 'info', content: '╚══════════════════════════════════════════════════════════╝' });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  // ── Social Sandbox ──────────────────────────────────────────────
  {
    name: 'spawn',
    aliases: ['sandbox', 'social-test'],
    desc: 'Open social platform sandbox overlay for testing connections',
    usage: 'spawn',
    run: async () => {
      window.dispatchEvent(new CustomEvent('open-sandbox'));
      return [
        { type: 'success', content: '🔬 Spawning social sandbox overlay...' },
        { type: 'text', content: 'Fill in company context on the left, connect platforms on the right.' },
      ];
    },
  },
  // ── Template Mode Toggle ──────────────────────────────────────────
  {
    name: 'template-mode',
    aliases: ['templates', 'tm', 'template'],
    desc: 'Toggle template/style previews ON or OFF during website build',
    usage: 'template-mode [on|off|status]',
    run: async (args) => {
      const action = (args[0] || '').toLowerCase();
      try {
        if (action === 'status' || action === '') {
          const data = await adminFetch('/template-mode');
          return [
            { type: 'info', content: `Template Mode: ${data.enabled ? '🟢 ON' : '🔴 OFF'}` },
            { type: 'text', content: data.enabled
              ? 'AI will generate style previews before building.'
              : 'AI will skip previews and build directly from answers + research.' },
          ];
        }
        if (action === 'on') {
          const data = await adminFetch('/template-mode', { method: 'POST', body: JSON.stringify({ enabled: true }) });
          return [{ type: 'success', content: `Template Mode: 🟢 ON — Style previews enabled.` }];
        }
        if (action === 'off') {
          const data = await adminFetch('/template-mode', { method: 'POST', body: JSON.stringify({ enabled: false }) });
          return [{ type: 'success', content: `Template Mode: 🔴 OFF — Builds will skip style previews.` }];
        }
        // Toggle
        const data = await adminFetch('/template-mode', { method: 'POST' });
        return [{ type: 'success', content: `Template Mode toggled: ${data.enabled ? '🟢 ON' : '🔴 OFF'}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  // ─── Clés API sécurisées (write-only, chiffrées AES-256-GCM) ───────────────
  {
    name: 'keys',
    aliases: ['secrets', 'apikeys'],
    desc: 'List API key & AI provider status (values never shown)',
    usage: 'keys',
    run: async () => {
      try {
        const data = await adminFetch('/secrets');
        if (data?.error) return [{ type: 'error', content: data.error }];
        const out: CmdOutput[] = [];
        out.push({ type: 'info', content: '── 🔐 SECRETS (write-only, encrypted) ──' });
        for (const s of (data.secrets || [])) {
          const badge = s.isSet
            ? (s.source === 'db' ? '🟢 set (db)' : '🟡 env')
            : '⚪ not configured';
          const tail = s.last4 ? ` ····${s.last4}` : '';
          out.push({ type: s.isSet ? 'success' : 'text', content: `  ${s.name.padEnd(22)} ${badge}${tail}` });
        }
        out.push({ type: 'text', content: '' });
        out.push({ type: 'info', content: '── 🤖 AI PROVIDERS ──' });
        for (const p of (data.providers || [])) {
          let badge: string;
          if (!p.isSet) badge = '⚪ gateway (no key)';
          else if (!p.enabled) badge = '⏸️  disabled → gateway';
          else if (p.status === 'valid') badge = '🟢 DIRECT (personal key)';
          else if (p.status === 'invalid') badge = '🔴 invalid → gateway';
          else badge = '🟡 not tested';
          const tail = p.last4 ? ` ····${p.last4}` : '';
          const url = p.baseUrl ? `  [${p.baseUrl}]` : '';
          out.push({ type: p.status === 'valid' && p.enabled ? 'success' : 'text', content: `  ${String(p.provider).padEnd(12)} ${badge}${tail}${url}` });
          if (p.statusMessage && p.status === 'invalid') out.push({ type: 'text', content: `      ↳ ${String(p.statusMessage).slice(0, 60)}` });
        }
        out.push({ type: 'text', content: '' });
        out.push({ type: 'text', content: 'setkey <NAME> <value> · delkey <NAME>' });
        out.push({ type: 'text', content: 'setai <provider> <key> [baseUrl] · testai <provider> · delai <provider> · toggleai <provider> on|off' });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'setkey',
    aliases: ['set-key', 'setsecret'],
    desc: 'Store/replace an API key (RESEND_API_KEY, HF_API_KEY, GITHUB_TOKEN…). Write-only.',
    usage: 'setkey <NAME> <value>',
    run: async (args) => {
      const name = (args[0] || '').trim();
      const value = args.slice(1).join(' ').trim();
      if (!name || !value) return [{ type: 'error', content: 'Usage: setkey <NAME> <value>' }];
      try {
        const data = await adminFetch('/secrets/set', { method: 'POST', body: JSON.stringify({ name, value }) });
        if (data?.error) return [{ type: 'error', content: data.error }];
        return [
          { type: 'success', content: `🔐 ${data.name} saved (encrypted, active immediately).` },
          { type: 'text', content: `   Masked value · ····${data.last4}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'delkey',
    aliases: ['del-key', 'delsecret', 'rmkey'],
    desc: 'Delete a stored API key (falls back to .env if present)',
    usage: 'delkey <NAME>',
    run: async (args) => {
      const name = (args[0] || '').trim();
      if (!name) return [{ type: 'error', content: 'Usage: delkey <NAME>' }];
      try {
        const data = await adminFetch('/secrets/delete', { method: 'POST', body: JSON.stringify({ name }) });
        if (data?.error) return [{ type: 'error', content: data.error }];
        return [{ type: 'success', content: `🗑️  ${data.name} deleted (falls back to .env if present).` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'setai',
    aliases: ['set-ai', 'aiprovider'],
    desc: 'Set an AI provider key → builder uses it DIRECT instead of Runable Gateway',
    usage: 'setai <openai|anthropic|google|custom> <key> [baseUrl]',
    run: async (args) => {
      const provider = (args[0] || '').trim().toLowerCase();
      const apiKey = (args[1] || '').trim();
      const baseUrl = (args[2] || '').trim();
      if (!provider || !apiKey) return [{ type: 'error', content: 'Usage: setai <provider> <key> [baseUrl]' }];
      try {
        const data = await adminFetch('/ai-providers/set', { method: 'POST', body: JSON.stringify({ provider, apiKey, baseUrl }) });
        if (data?.error) return [{ type: 'error', content: data.error }];
        const out: CmdOutput[] = [
          { type: 'success', content: `🤖 ${data.provider} saved (encrypted) · ····${data.last4}` },
          { type: 'text', content: `   Running key test…` },
        ];
        // Test automatique juste après pour activer le routage direct.
        const t = await adminFetch('/ai-providers/test', { method: 'POST', body: JSON.stringify({ provider }) });
        if (t?.ok) out.push({ type: 'success', content: `   🟢 Key VALID → ${provider} now uses the personal key (DIRECT, no more gateway).` });
        else out.push({ type: 'error', content: `   🔴 Test failed: ${t?.error || 'invalid'} → falling back to gateway.` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'testai',
    aliases: ['test-ai', 'aitest'],
    desc: 'Test an AI provider key with a real minimal call → updates status',
    usage: 'testai <provider> [model]',
    run: async (args) => {
      const provider = (args[0] || '').trim().toLowerCase();
      const model = (args[1] || '').trim();
      if (!provider) return [{ type: 'error', content: 'Usage: testai <provider> [model]' }];
      try {
        const data = await adminFetch('/ai-providers/test', { method: 'POST', body: JSON.stringify({ provider, model }) });
        if (data?.error && data.status !== 'invalid') return [{ type: 'error', content: data.error }];
        if (data?.ok) return [{ type: 'success', content: `🟢 ${provider} VALID — response: "${data.sample}" · DIRECT routing active.` }];
        return [{ type: 'error', content: `🔴 ${provider} invalid: ${data?.error || 'empty response'} · gateway fallback.` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'toggleai',
    aliases: ['toggle-ai'],
    desc: 'Enable/disable a provider key without deleting it',
    usage: 'toggleai <provider> on|off',
    run: async (args) => {
      const provider = (args[0] || '').trim().toLowerCase();
      const state = (args[1] || '').trim().toLowerCase();
      if (!provider || (state !== 'on' && state !== 'off')) return [{ type: 'error', content: 'Usage: toggleai <provider> on|off' }];
      try {
        const data = await adminFetch('/ai-providers/toggle', { method: 'POST', body: JSON.stringify({ provider, enabled: state === 'on' }) });
        if (data?.error) return [{ type: 'error', content: data.error }];
        return [{ type: 'success', content: `${data.enabled ? '🟢 enabled (DIRECT if valid)' : '⏸️  disabled → gateway'}: ${data.provider}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'delai',
    aliases: ['del-ai', 'rmai'],
    desc: 'Delete an AI provider key → builder falls back to Runable Gateway',
    usage: 'delai <provider>',
    run: async (args) => {
      const provider = (args[0] || '').trim().toLowerCase();
      if (!provider) return [{ type: 'error', content: 'Usage: delai <provider>' }];
      try {
        const data = await adminFetch('/ai-providers/delete', { method: 'POST', body: JSON.stringify({ provider }) });
        if (data?.error) return [{ type: 'error', content: data.error }];
        return [{ type: 'success', content: `🗑️  ${data.provider} deleted → automatic fallback to gateway.` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  // ══════════════════════════════════════════════════════
  //  EXTENDED CONTROL COMMANDS (25) — admin-gated backend
  // ══════════════════════════════════════════════════════
  {
    name: 'sysinfo', aliases: ['sys'], desc: 'Runtime info: uptime, memory, node, pid', usage: 'sysinfo',
    run: async () => {
      try {
        const d = await adminFetch('/sysinfo');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [
          { type: 'info', content: '── SYSTEM ──' },
          { type: 'text', content: `pid ${d.pid} · node ${d.node} · ${d.platform}/${d.arch}` },
          { type: 'text', content: `uptime ${Math.floor(d.uptimeSec / 60)}m ${d.uptimeSec % 60}s` },
          { type: 'text', content: `RAM: rss ${d.rssMb}MB · heap ${d.heapUsedMb}/${d.heapTotalMb}MB` },
          { type: d.maintenanceMode ? 'error' : 'text', content: `maintenance: ${d.maintenanceMode ? 'ON 🔧' : 'off'}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'dbstats', aliases: ['db'], desc: 'Row counts for key tables', usage: 'dbstats',
    run: async () => {
      try {
        const d = await adminFetch('/dbstats');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [
          { type: 'info', content: '── DB ROW COUNTS ──' },
          { type: 'text', content: `users ${d.users} · companies ${d.companies} · pages ${d.pages}` },
          { type: 'text', content: `jobs ${d.jobs} · errors ${d.errors} · sessions ${d.sessions} · tokenTx ${d.tokenTx}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'metrics', aliases: ['kpi'], desc: 'Global KPIs (users, companies, revenue)', usage: 'metrics',
    run: async () => {
      try {
        const d = await adminFetch('/metrics');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [
          { type: 'info', content: '── KPIs ──' },
          { type: 'text', content: `users ${d.users} · companies ${d.companies} · active jobs ${d.activeJobs}` },
          { type: 'success', content: `MRR ${d.mrr} · ARR ${d.arr} · total ${d.totalRevenue}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'growth', aliases: [], desc: 'Signups over 24h / 7d / 30d', usage: 'growth',
    run: async () => {
      try {
        const d = await adminFetch('/growth');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [
          { type: 'info', content: '── SIGNUPS ──' },
          { type: 'text', content: `24h: ${d.last24h} · 7d: ${d.last7d} · 30d: ${d.last30d}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'signups', aliases: ['recent-users'], desc: 'Latest signups: signups [limit]', usage: 'signups [limit]',
    run: async (args) => {
      const limit = parseInt(args[0]) || 15;
      try {
        const d = await adminFetch(`/signups?limit=${limit}`);
        if (d?.error) return [{ type: 'error', content: d.error }];
        const out: CmdOutput[] = [{ type: 'info', content: `── ${d.users.length} RECENT USERS ──` }];
        for (const u of d.users) out.push({ type: 'text', content: `${u.email} · ${u.plan} · ${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '?'}` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'plan-stats', aliases: ['plans'], desc: 'User distribution by plan', usage: 'plan-stats',
    run: async () => {
      try {
        const d = await adminFetch('/plan-stats');
        if (d?.error) return [{ type: 'error', content: d.error }];
        const out: CmdOutput[] = [{ type: 'info', content: '── PLANS ──' }];
        for (const p of d.plans) out.push({ type: 'text', content: `${p.plan}: ${p.n}` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'top-users', aliases: ['leaderboard'], desc: 'Ranking by tokens: top-users [limit]', usage: 'top-users [limit]',
    run: async (args) => {
      const limit = parseInt(args[0]) || 10;
      try {
        const d = await adminFetch(`/top-users?limit=${limit}`);
        if (d?.error) return [{ type: 'error', content: d.error }];
        const out: CmdOutput[] = [{ type: 'info', content: '── TOP USERS (tokens) ──' }];
        d.users.forEach((u: any, i: number) => out.push({ type: 'text', content: `${i + 1}. ${u.email} — ${u.tokens} (${u.plan})` }));
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'active', aliases: ['online'], desc: 'Active sessions (not expired)', usage: 'active',
    run: async () => {
      try {
        const d = await adminFetch('/active');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `${d.activeSessions} active sessions · ${d.distinctUsers} distinct users` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'err-stats', aliases: ['errstats'], desc: 'Errors grouped by source/level', usage: 'err-stats',
    run: async () => {
      try {
        const d = await adminFetch('/err-stats');
        if (d?.error) return [{ type: 'error', content: d.error }];
        const out: CmdOutput[] = [{ type: 'info', content: '── ERRORS BY SOURCE ──' }];
        for (const s of d.bySource) out.push({ type: 'text', content: `${s.source}: ${s.n}` });
        out.push({ type: 'info', content: '── BY LEVEL ──' });
        for (const l of d.byLevel) out.push({ type: 'text', content: `${l.level}: ${l.n}` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'revenue', aliases: ['mrr'], desc: 'Revenue aggregates (MRR/ARR/total)', usage: 'revenue',
    run: async () => {
      try {
        const d = await adminFetch('/revenue');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [
          { type: 'info', content: '── REVENUE ──' },
          { type: 'success', content: `MRR ${d.mrr} · ARR ${d.arr} · total ${d.totalRevenue}` },
          { type: 'text', content: `paying companies: ${d.payingCompanies}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'search', aliases: ['find'], desc: 'Search users + companies: search <query>', usage: 'search <query>',
    run: async (args) => {
      const q = args.join(' ').trim();
      if (!q) return [{ type: 'error', content: 'Usage: search <query>' }];
      try {
        const d = await adminFetch(`/search?q=${encodeURIComponent(q)}`);
        if (d?.error) return [{ type: 'error', content: d.error }];
        const out: CmdOutput[] = [{ type: 'info', content: `── USERS (${d.users.length}) ──` }];
        for (const u of d.users) out.push({ type: 'text', content: `${u.email} · ${u.role} · ${u.plan} · ${u.tokens}t` });
        out.push({ type: 'info', content: `── COMPANIES (${d.companies.length}) ──` });
        for (const co of d.companies) out.push({ type: 'text', content: `${co.name} · ${co.status} · ${co.industry || '?'}` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'version', aliases: ['ver'], desc: 'Version app / runtime', usage: 'version',
    run: async () => {
      try {
        const d = await adminFetch('/version');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `${d.app} · node ${d.node} · env ${d.env} · uptime ${Math.floor(d.uptimeSec / 60)}m` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'whoami', aliases: ['me'], desc: 'Identity of the connected admin', usage: 'whoami',
    run: async () => {
      try {
        const d = await adminFetch('/whoami');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [
          { type: 'info', content: '── WHOAMI ──' },
          { type: 'text', content: `${d.name} <${d.email}>` },
          { type: 'text', content: `role ${d.role} · plan ${d.plan} · ${d.tokens} tokens` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'company-stats', aliases: ['cstats'], desc: 'Companies by status / type', usage: 'company-stats',
    run: async () => {
      try {
        const d = await adminFetch('/company-stats');
        if (d?.error) return [{ type: 'error', content: d.error }];
        const out: CmdOutput[] = [{ type: 'info', content: '── BY STATUS ──' }];
        for (const s of d.byStatus) out.push({ type: 'text', content: `${s.status}: ${s.n}` });
        out.push({ type: 'info', content: '── BY TYPE ──' });
        for (const t of d.byType) out.push({ type: 'text', content: `${t.type || '?'}: ${t.n}` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'token-stats', aliases: ['tstats'], desc: 'Tokens in circulation', usage: 'token-stats',
    run: async () => {
      try {
        const d = await adminFetch('/token-stats');
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [
          { type: 'info', content: '── TOKENS ──' },
          { type: 'text', content: `in circulation: ${d.totalInCirculation}` },
          { type: 'text', content: `average/user: ${d.avgPerUser} · max: ${d.maxBalance}` },
          { type: 'text', content: `transactions: ${d.transactions}` },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'grant-all', aliases: ['bulk-tokens'], desc: 'Add (or remove, if negative) tokens to ALL users', usage: 'grant-all <amount>',
    run: async (args) => {
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount === 0) return [{ type: 'error', content: 'Usage: grant-all <amount> (e.g. grant-all 1000)' }];
      try {
        const d = await adminFetch('/grant-all', { method: 'POST', body: JSON.stringify({ amount }) });
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `${amount > 0 ? '+' : ''}${amount} tokens applied to ${d.usersAffected} users.` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'set-role', aliases: ['role'], desc: 'Change a user\'s role (safeguards included)', usage: 'set-role <user> <admin|user>',
    run: async (args) => {
      const username = args[0];
      const role = (args[1] || '').toLowerCase();
      if (!username || (role !== 'admin' && role !== 'user')) return [{ type: 'error', content: 'Usage: set-role <user> <admin|user>' }];
      try {
        const d = await adminFetch('/set-role', { method: 'POST', body: JSON.stringify({ username, role }) });
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `${d.user} → role ${d.role}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'kill-user-jobs', aliases: ['kuj'], desc: 'Tue les jobs actifs de tous les projets d\'un user', usage: 'kill-user-jobs <user>',
    run: async (args) => {
      const username = args.join(' ').trim();
      if (!username) return [{ type: 'error', content: 'Usage: kill-user-jobs <user>' }];
      try {
        const d = await adminFetch('/kill-user-jobs', { method: 'POST', body: JSON.stringify({ username }) });
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `${d.killed} jobs killed for ${d.user}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'purge-errors', aliases: ['clear-errors'], desc: 'Delete error_logs (all or older than N days)', usage: 'purge-errors [olderThanDays]',
    run: async (args) => {
      const olderThanDays = args[0] ? parseInt(args[0]) : undefined;
      try {
        const d = await adminFetch('/purge-errors', { method: 'POST', body: JSON.stringify(olderThanDays ? { olderThanDays } : {}) });
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `${d.deleted} errors deleted.` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'flush-sessions', aliases: ['logout-user'], desc: 'Revoke all of a user\'s sessions (sign-out)', usage: 'flush-sessions <user>',
    run: async (args) => {
      const username = args.join(' ').trim();
      if (!username) return [{ type: 'error', content: 'Usage: flush-sessions <user>' }];
      try {
        const d = await adminFetch('/flush-sessions', { method: 'POST', body: JSON.stringify({ username }) });
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `${d.sessionsRevoked} sessions revoked for ${d.user}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'email-test', aliases: ['mailtest'], desc: 'Send a test email', usage: 'email-test [to]',
    run: async (args) => {
      const to = args[0];
      try {
        const d = await adminFetch('/email-test', { method: 'POST', body: JSON.stringify(to ? { to } : {}) });
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `📧 Test email sent to ${d.to}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'maintenance', aliases: ['maint'], desc: 'Toggle maintenance mode: maintenance [on|off]', usage: 'maintenance [on|off]',
    run: async (args) => {
      const arg = (args[0] || '').toLowerCase();
      try {
        let d;
        if (arg === 'on' || arg === 'off') d = await adminFetch('/maintenance', { method: 'POST', body: JSON.stringify({ enabled: arg === 'on' }) });
        else if (!arg) d = await adminFetch('/maintenance');
        else return [{ type: 'error', content: 'Usage: maintenance [on|off]' }];
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: d.enabled ? 'error' : 'success', content: `Maintenance mode: ${d.enabled ? 'ON 🔧' : 'off'}` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'export', aliases: [], desc: 'Dump JSON: export <users|companies>', usage: 'export <users|companies>',
    run: async (args) => {
      const type = (args[0] || 'users').toLowerCase();
      if (type !== 'users' && type !== 'companies') return [{ type: 'error', content: 'Usage: export <users|companies>' }];
      try {
        const d = await adminFetch(`/export?type=${type}`);
        if (d?.error) return [{ type: 'error', content: d.error }];
        const json = JSON.stringify(d.data, null, 2);
        return [
          { type: 'success', content: `${d.count} ${type} exported:` },
          { type: 'text', content: json.length > 4000 ? json.slice(0, 4000) + '\n… (truncated)' : json },
        ];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'sql', aliases: ['query'], desc: 'SQL runner READ ONLY (SELECT only)', usage: 'sql <SELECT …>',
    run: async (args) => {
      const query = args.join(' ').trim();
      if (!query) return [{ type: 'error', content: 'Usage: sql SELECT … (read only)' }];
      try {
        const d = await adminFetch('/sql', { method: 'POST', body: JSON.stringify({ query }) });
        if (d?.error) return [{ type: 'error', content: d.error }];
        const out: CmdOutput[] = [{ type: 'info', content: `── ${d.rowCount} row(s) · cols: ${(d.columns || []).join(', ')} ──` }];
        for (const row of d.rows.slice(0, 50)) out.push({ type: 'text', content: JSON.stringify(row) });
        if (d.rows.length > 50) out.push({ type: 'text', content: `… ${d.rows.length - 50} more` });
        return out;
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
  {
    name: 'flush-cache', aliases: ['cache'], desc: 'Clear persisted AI caches (regenerable)', usage: 'flush-cache',
    run: async () => {
      try {
        const d = await adminFetch('/flush-cache', { method: 'POST' });
        if (d?.error) return [{ type: 'error', content: d.error }];
        return [{ type: 'success', content: `🧹 ${d.cleared} cache entries deleted.` }];
      } catch (e: any) { return [{ type: 'error', content: `Failed: ${e.message}` }]; }
    },
  },
];

// ─── Resolve "all commands" as special input ─────────────────
function findCommand(input: string): { cmd: Command; args: string[] } | null {
  const trimmed = input.trim().toLowerCase();

  // Special: "all commands"
  if (trimmed === 'all commands') {
    const cmd = COMMANDS.find(c => c.aliases.includes('all commands'));
    if (cmd) return { cmd, args: [] };
  }

  // Special: "reset models"
  if (trimmed === 'reset models') {
    const cmd = COMMANDS.find(c => c.name === 'reset');
    if (cmd) return { cmd, args: ['models'] };
  }

  // Special: "kill all"
  if (trimmed === 'kill all') {
    const cmd = COMMANDS.find(c => c.name === 'kill');
    if (cmd) return { cmd, args: ['all'] };
  }

  const parts = trimmed.split(/\s+/);
  const name = parts[0];
  const args = parts.slice(1);

  const cmd = COMMANDS.find(c => c.name === name || c.aliases.includes(name));
  if (cmd) return { cmd, args };

  return null;
}

// ─── Secure API Key Form ─────────────────────────────────────
interface SecretStatus { name: string; isSet: boolean; last4: string | null; source: string; }
interface ProviderStatus { provider: string; isSet: boolean; last4: string | null; baseUrl: string | null; enabled: boolean; status: string; statusMessage: string | null; }

// Libellés lisibles + descriptions par clé.
const SECRET_LABELS: Record<string, { label: string; hint: string; placeholder: string }> = {
  RESEND_API_KEY:      { label: 'Resend — API Key', hint: 'Transactional email sending', placeholder: 're_xxxxxxxx' },
  RESEND_FROM:         { label: 'Resend — Sender', hint: 'Default "from" address', placeholder: 'Velbaz <no-reply@ton-domaine.com>' },
  HF_CREDENTIALS:      { label: 'Higgsfield — Credentials', hint: 'Combined credentials (if used)', placeholder: 'key:secret' },
  HF_API_KEY:          { label: 'Higgsfield — API Key', hint: 'Image/video generation', placeholder: 'hf_xxxxxxxx' },
  HF_API_SECRET:       { label: 'Higgsfield — API Secret', hint: 'Secret associated with the HF key', placeholder: '••••••••' },
  GITHUB_TOKEN:        { label: 'GitHub — Token', hint: 'Export projects to GitHub', placeholder: 'ghp_xxxxxxxx' },
  GITHUB_OWNER:        { label: 'GitHub — Owner', hint: 'Target account/organization', placeholder: 'mon-org' },
  EMAIL_WEBHOOK_SECRET:{ label: 'Email Webhook — Secret', hint: 'Incoming webhook verification', placeholder: '••••••••' },
};
const PROVIDER_LABELS: Record<string, { label: string; hint: string; placeholder: string }> = {
  openai:    { label: 'OpenAI', hint: 'GPT-4o, o-series…', placeholder: 'sk-xxxxxxxx' },
  anthropic: { label: 'Anthropic', hint: 'Claude 3.5 / 4…', placeholder: 'sk-ant-xxxxxxxx' },
  google:    { label: 'Google', hint: 'Gemini 2.0 / 2.5…', placeholder: 'AIza-xxxxxxxx' },
  custom:    { label: 'Custom (OpenAI-compatible)', hint: 'OpenRouter, Groq, Together… (baseURL required)', placeholder: 'sk-or-xxxxxxxx' },
};

function ApiKeyForm({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [secretVals, setSecretVals] = useState<Record<string, string>>({});
  const [providerVals, setProviderVals] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminFetch('/secrets');
      setSecrets(data.secrets || []);
      setProviders(data.providers || []);
      const bu: Record<string, string> = {};
      (data.providers || []).forEach((p: ProviderStatus) => { if (p.baseUrl) bu[p.provider] = p.baseUrl; });
      setBaseUrls(bu);
    } catch (e: any) {
      setMsg({ type: 'err', text: `Load failed: ${e.message}` });
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const confirm = async () => {
    setSaving(true);
    setMsg(null);
    let ok = 0; const errs: string[] = [];
    // Providers IA
    for (const p of providers) {
      const key = (providerVals[p.provider] || '').trim();
      const bu = (baseUrls[p.provider] || '').trim();
      if (!key) continue;
      try {
        const res = await adminFetch('/ai-providers/set', { method: 'POST', body: JSON.stringify({ provider: p.provider, apiKey: key, baseUrl: bu }) });
        if (res.error) errs.push(`${p.provider}: ${res.error}`); else ok++;
      } catch (e: any) { errs.push(`${p.provider}: ${e.message}`); }
    }
    // Secrets génériques
    for (const s of secrets) {
      const val = (secretVals[s.name] || '').trim();
      if (!val) continue;
      try {
        const res = await adminFetch('/secrets/set', { method: 'POST', body: JSON.stringify({ name: s.name, value: val }) });
        if (res.error) errs.push(`${s.name}: ${res.error}`); else ok++;
      } catch (e: any) { errs.push(`${s.name}: ${e.message}`); }
    }
    setSaving(false);
    setSecretVals({}); setProviderVals({});
    await load();
    if (errs.length) setMsg({ type: 'err', text: `${ok} saved. Errors: ${errs.join(' · ')}` });
    else if (ok) setMsg({ type: 'ok', text: `✅ ${ok} key(s) saved and activated immediately.` });
    else setMsg({ type: 'err', text: 'No value entered.' });
  };

  const testProvider = async (provider: string) => {
    setMsg({ type: 'ok', text: `Testing ${provider}…` });
    try {
      const res = await adminFetch('/ai-providers/test', { method: 'POST', body: JSON.stringify({ provider }) });
      if (res.error) setMsg({ type: 'err', text: `${provider}: ${res.error}` });
      else setMsg({ type: 'ok', text: `${provider}: ${res.ok ? '✅ valid key' : '❌ failed'}${res.message ? ' — ' + res.message : ''}` });
      await load();
    } catch (e: any) { setMsg({ type: 'err', text: `${provider}: ${e.message}` }); }
  };

  const delProvider = async (provider: string) => {
    try { await adminFetch('/ai-providers/delete', { method: 'POST', body: JSON.stringify({ provider }) }); await load(); setMsg({ type: 'ok', text: `${provider} deleted — falling back to the Gateway.` }); }
    catch (e: any) { setMsg({ type: 'err', text: e.message }); }
  };
  const delSecret = async (name: string) => {
    try { await adminFetch('/secrets/delete', { method: 'POST', body: JSON.stringify({ name }) }); await load(); setMsg({ type: 'ok', text: `${name} deleted.` }); }
    catch (e: any) { setMsg({ type: 'err', text: e.message }); }
  };

  const badge = (set: boolean, last4: string | null, status?: string) => {
    let color = set ? '#52c41a' : '#555';
    let text = set ? `•••• ${last4 || '····'}` : 'not set';
    if (status === 'valid') { color = '#52c41a'; text = `✓ actif ····${last4 || ''}`; }
    else if (status === 'invalid') { color = '#ff4d4f'; text = `✗ invalide ····${last4 || ''}`; }
    return <span style={{ fontSize: 10, color, border: `1px solid ${color}44`, borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace' }}>{text}</span>;
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0d0d14', border: '1px solid #222', borderRadius: 6,
    padding: '7px 10px', color: '#ddd', fontFamily: 'monospace', fontSize: 12, outline: 'none',
  };
  const labelRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 };

  return (
    <div onClick={(e) => { e.stopPropagation(); }} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        width: 'min(680px, 96vw)', maxHeight: '90vh', overflow: 'auto',
        background: '#0a0a10', border: '1px solid #1a1a2e', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', padding: 22,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, color: '#b37feb', fontSize: 16, fontFamily: 'monospace' }}>🔐 API Keys — Secure Panel</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #333', color: '#888', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <p style={{ color: '#666', fontSize: 11, margin: '0 0 16px', fontFamily: 'monospace' }}>
          Encrypted (AES-256-GCM). Cannot be read back once saved. Leave blank to keep unchanged.
        </p>

        {loading ? (
          <div style={{ color: '#888', fontFamily: 'monospace', padding: 20 }}>Loading…</div>
        ) : (
          <>
            <div style={{ color: '#8c8c8c', fontSize: 11, fontFamily: 'monospace', margin: '0 0 8px', letterSpacing: 1 }}>── AI PROVIDERS ──</div>
            {providers.map((p) => {
              const meta = PROVIDER_LABELS[p.provider] || { label: p.provider, hint: '', placeholder: 'API key' };
              return (
                <div key={p.provider} style={{ marginBottom: 14, padding: 12, background: '#0d0d14', border: '1px solid #16162a', borderRadius: 8 }}>
                  <div style={labelRow}>
                    <span style={{ color: '#ddd', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>{meta.label}</span>
                    {badge(p.isSet, p.last4, p.status)}
                  </div>
                  <div style={{ color: '#666', fontSize: 10, marginBottom: 6, fontFamily: 'monospace' }}>{meta.hint}</div>
                  <input type="password" autoComplete="new-password" placeholder={p.isSet ? '•••••••• (leave blank to keep)' : meta.placeholder}
                    value={providerVals[p.provider] || ''} onChange={(e) => setProviderVals(v => ({ ...v, [p.provider]: e.target.value }))} style={inputStyle} />
                  {p.provider === 'custom' && (
                    <input type="text" placeholder="baseURL (e.g. https://openrouter.ai/api/v1)"
                      value={baseUrls[p.provider] || ''} onChange={(e) => setBaseUrls(v => ({ ...v, [p.provider]: e.target.value }))} style={{ ...inputStyle, marginTop: 6 }} />
                  )}
                  {p.isSet && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button onClick={() => testProvider(p.provider)} style={{ background: '#111', border: '1px solid #333', color: '#40a9ff', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>Test</button>
                      <button onClick={() => delProvider(p.provider)} style={{ background: '#111', border: '1px solid #333', color: '#ff7875', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ color: '#8c8c8c', fontSize: 11, fontFamily: 'monospace', margin: '18px 0 8px', letterSpacing: 1 }}>── SECRETS & INTEGRATIONS ──</div>
            {secrets.map((s) => {
              const meta = SECRET_LABELS[s.name] || { label: s.name, hint: '', placeholder: 'value' };
              return (
                <div key={s.name} style={{ marginBottom: 14, padding: 12, background: '#0d0d14', border: '1px solid #16162a', borderRadius: 8 }}>
                  <div style={labelRow}>
                    <span style={{ color: '#ddd', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>{meta.label}</span>
                    {badge(s.isSet, s.last4)}
                  </div>
                  <div style={{ color: '#666', fontSize: 10, marginBottom: 6, fontFamily: 'monospace' }}>{meta.hint}{s.source === 'env' ? ' · (from .env)' : ''}</div>
                  <input type="password" autoComplete="new-password" placeholder={s.isSet ? '•••••••• (leave blank to keep)' : meta.placeholder}
                    value={secretVals[s.name] || ''} onChange={(e) => setSecretVals(v => ({ ...v, [s.name]: e.target.value }))} style={inputStyle} />
                  {s.isSet && s.source === 'db' && (
                    <button onClick={() => delSecret(s.name)} style={{ background: '#111', border: '1px solid #333', color: '#ff7875', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace', marginTop: 8 }}>Delete</button>
                  )}
                </div>
              );
            })}

            {msg && (
              <div style={{ margin: '12px 0', padding: '8px 12px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace',
                color: msg.type === 'ok' ? '#52c41a' : '#ff4d4f', background: msg.type === 'ok' ? '#0e1f0e' : '#1f0e0e', border: `1px solid ${msg.type === 'ok' ? '#1e3a1e' : '#3a1e1e'}` }}>
                {msg.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8, position: 'sticky', bottom: 0, background: '#0a0a10', paddingTop: 12 }}>
              <button onClick={confirm} disabled={saving} style={{ flex: 1, background: saving ? '#333' : '#52c41a', border: 'none', color: saving ? '#888' : '#000', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'monospace' }}>
                {saving ? 'Saving…' : '✓ Confirm'}
              </button>
              <button onClick={onClose} style={{ background: '#111', border: '1px solid #333', color: '#888', borderRadius: 8, padding: '10px 20px', fontSize: 13, cursor: 'pointer', fontFamily: 'monospace' }}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Terminal Component ──────────────────────────────────────
function Terminal({ logs, setTab }: { logs: DebugEntry[]; setTab: (t: Tab) => void }) {
  const [history, setHistory] = useState<CmdOutput[]>([
    { type: 'info', content: '╔══════════════════════════════════════════════╗' },
    { type: 'info', content: '║          VELBAZ ADMIN TERMINAL               ║' },
    { type: 'info', content: '║  Type "help" or "commands" to get started    ║' },
    { type: 'info', content: '╚══════════════════════════════════════════════╝' },
    { type: 'text', content: '' },
  ]);
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [showCommsConsole, setShowCommsConsole] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef<Job[]>([]);
  const modelsRef = useRef<ModelHealth[]>([]);

  // Compute matching commands from input
  const suggestions = (() => {
    const partial = input.trim().toLowerCase();
    if (!partial || running) return [];
    const matches: { name: string; desc: string }[] = [];
    for (const cmd of COMMANDS) {
      if (cmd.name.startsWith(partial)) {
        matches.push({ name: cmd.name, desc: cmd.desc });
      }
    }
    // Don't show if exact match only
    if (matches.length === 1 && matches[0].name === partial) return [];
    return matches.slice(0, 8);
  })();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [running]);

  const ctx: CommandContext = {
    jobs: jobsRef.current,
    models: modelsRef.current,
    logs,
    setTab,
    refreshJobs: async () => {
      const data = await adminFetch('/stats');
      jobsRef.current.length = 0;
      (data.jobs || []).forEach((j: Job) => jobsRef.current.push(j));
    },
    refreshModels: async () => {
      const data = await adminFetch('/stats');
      modelsRef.current.length = 0;
      (data.models || []).forEach((m: ModelHealth) => modelsRef.current.push(m));
    },
    clearLogs: () => {},
    openApiKeyForm: () => setShowApiKeyForm(true),
    openCommsConsole: () => setShowCommsConsole(true),
  };

  const execCommand = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    setCmdHistory(prev => [...prev, trimmed]);
    setHistoryIdx(-1);

    // Add prompt line
    setHistory(prev => [...prev, { type: 'text', content: `$ ${trimmed}` }]);

    // ── Porte secrète : la commande "beta" (seule) ouvre le panel admin du site ──
    // bêta dans un NOUVEL ONGLET. Le lien est codé en dur et n'est JAMAIS affiché
    // à l'écran. (Toute autre commande "beta …" avec un sous-argument garde son
    // comportement normal : beta gen / list / stats / mode …)
    if (trimmed.toLowerCase() === 'beta') {
      try {
        window.open(
          'https://velbazbe-38iak1a-preview-4200.runable.site/panel-a7x9k2m4?key=panel-a7x9k2m4',
          '_blank',
          'noopener,noreferrer',
        );
        setHistory(prev => [...prev, { type: 'success', content: '→ Opening the beta panel in a new tab…' }, { type: 'text', content: '' }]);
      } catch {
        setHistory(prev => [...prev, { type: 'error', content: 'Opening blocked by the browser. Allow pop-ups then try again.' }, { type: 'text', content: '' }]);
      }
      return;
    }

    const found = findCommand(trimmed);
    if (!found) {
      setHistory(prev => [...prev, { type: 'error', content: 'Commande inconnue.' }]);
      return;
    }

    setRunning(true);
    try {
      const results = await found.cmd.run(found.args, ctx);

      // Handle clear
      if (results.length === 1 && results[0].content === '__CLEAR__') {
        setHistory([]);
        setRunning(false);
        return;
      }

      setHistory(prev => [...prev, ...results, { type: 'text', content: '' }]);
    } catch (e: any) {
      setHistory(prev => [...prev, { type: 'error', content: `Command failed: ${e.message}` }]);
    }
    setRunning(false);
  };

  // Reset suggestion selection when input changes
  useEffect(() => {
    setSelectedSuggestion(0);
  }, [input]);

  const pickSuggestion = (name: string) => {
    setInput(name + ' ');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // If suggestions are visible, arrow keys navigate them
    if (suggestions.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault();
        pickSuggestion(suggestions[selectedSuggestion].name);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedSuggestion(prev => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedSuggestion(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !running) {
        // If user typed partial and hits enter, pick suggestion if partial doesn't match an exact command
        const exact = findCommand(input);
        if (exact) {
          execCommand(input);
          setInput('');
        } else {
          pickSuggestion(suggestions[selectedSuggestion].name);
        }
        return;
      }
    } else if (e.key === 'Enter' && !running) {
      execCommand(input);
      setInput('');
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length === 0 && cmdHistory.length > 0) {
        const idx = historyIdx === -1 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(idx);
        setInput(cmdHistory[idx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length === 0 && historyIdx >= 0) {
        const idx = historyIdx + 1;
        if (idx >= cmdHistory.length) {
          setHistoryIdx(-1);
          setInput('');
        } else {
          setHistoryIdx(idx);
          setInput(cmdHistory[idx]);
        }
      }
    }
  };

  const outputColor = (type: CmdOutput['type']) => {
    switch (type) {
      case 'error': return '#ff4d4f';
      case 'success': return '#52c41a';
      case 'info': return '#b37feb';
      case 'table': return '#8c8c8c';
      default: return '#999';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onClick={() => inputRef.current?.focus()}>
      {showApiKeyForm && <ApiKeyForm onClose={() => setShowApiKeyForm(false)} />}
      {showCommsConsole && <CommsConsole onClose={() => setShowCommsConsole(false)} />}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {history.map((line, i) => {
          const isUrl = /^https?:\/\/\S+$/.test(line.content.trim());
          return (
          <div key={i} style={{
            padding: '1px 8px',
            color: outputColor(line.type),
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: isUrl ? 'pre-wrap' : 'pre',
            wordBreak: isUrl ? 'break-all' : undefined,
            letterSpacing: 0.3,
          }}>
            {isUrl ? (
              <a href={line.content.trim()} target="_blank" rel="noopener noreferrer"
                 style={{ color: '#40a9ff', textDecoration: 'underline' }}>
                {line.content.trim()}
              </a>
            ) : line.content}
          </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Autocomplete suggestions */}
      {suggestions.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: '5px 8px',
          borderTop: '1px solid #1a1a2e',
          background: '#0d0d14',
          flexShrink: 0,
        }}>
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              onClick={() => pickSuggestion(s.name)}
              onMouseEnter={() => setSelectedSuggestion(i)}
              style={{
                background: i === selectedSuggestion ? '#1a1a3e' : '#111118',
                border: i === selectedSuggestion ? '1px solid #52c41a' : '1px solid #222',
                borderRadius: 4,
                padding: '3px 10px',
                color: i === selectedSuggestion ? '#52c41a' : '#888',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 11,
                cursor: 'pointer',
                transition: 'all 0.1s',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: '#555', fontSize: 10 }}>{s.desc.length > 30 ? s.desc.slice(0, 30) + '…' : s.desc}</span>
            </button>
          ))}
          <span style={{ color: '#444', fontSize: 10, alignSelf: 'center', marginLeft: 4 }}>
            ← → select · Tab fill · Enter run
          </span>
        </div>
      )}

      {/* Input prompt */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 8px',
        borderTop: '1px solid #222',
        background: '#0a0a0f',
        flexShrink: 0,
      }}>
        <span style={{ color: '#52c41a', marginRight: 6, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>❯</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          placeholder={running ? 'Running...' : 'Type a command...'}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#ddd',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            outline: 'none',
            caretColor: '#52c41a',
            letterSpacing: 0.3,
          }}
          autoFocus
        />
        {running && <span style={{ color: '#666', fontSize: 10, animation: 'pulse 1s infinite' }}>●</span>}
      </div>
    </div>
  );
}

// ─── Main AdminPanel ─────────────────────────────────────────
export function AdminPanel({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [tab, setTab] = useState<Tab>('terminal');
  const [logs, setLogs] = useState<DebugEntry[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [models, setModels] = useState<ModelHealth[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [errors, setErrors] = useState<any>(null); // { dbErrors, memErrors, failedJobs }
  const [filter, setFilter] = useState('');
  const [userMenuId, setUserMenuId] = useState<string | null>(null); // which user's 3-dot is open
  const [viewingUserErrors, setViewingUserErrors] = useState<{ user: any; errors: UserError[]; failedJobs: any[]; companies: any[] } | null>(null);
  const [loadingUserErrors, setLoadingUserErrors] = useState(false);
  const [viewingUserVars, setViewingUserVars] = useState<{ user: any; variables: any; tokenHistory: any[] } | null>(null);
  const [editingTokens, setEditingTokens] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);
  const [hfStatus, setHfStatus] = useState<{ connected: boolean; accountEmail: string | null } | null>(null);
  const [betaCodes, setBetaCodes] = useState<BetaCode[]>([]);
  const [betaEdits, setBetaEdits] = useState<Record<string, { maxUses: string; uses: string }>>({});
  const [betaSavingId, setBetaSavingId] = useState<string | null>(null);
  const [betaMsg, setBetaMsg] = useState<string | null>(null);
  const [betaGenCount, setBetaGenCount] = useState('20');
  const [betaGenerating, setBetaGenerating] = useState(false);
  const [betaLastBatch, setBetaLastBatch] = useState<string[] | null>(null);
  const [betaFilter, setBetaFilter] = useState('');

  // Landscape oriented: wider than tall
  const [pos, setPos] = useState({ x: Math.max(20, window.innerWidth - 820), y: Math.max(20, window.innerHeight - 470) });
  const [size, setSize] = useState({ w: 780, h: 420 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  if (userEmail !== ADMIN_EMAIL) return null;

  // SSE for real-time logs
  useEffect(() => {
    if (!open || minimized) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    const token = getToken();
    const es = new EventSource(`/api/admin/debug/stream?token=${token}`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const entry: DebugEntry = JSON.parse(e.data);
        setLogs(prev => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch {}
    };
    es.onerror = () => {
      es.close();
      setTimeout(() => {
        if (open && !minimized) {
          sseRef.current?.close();
          const token = getToken();
          const newEs = new EventSource(`/api/admin/debug/stream?token=${token}`);
          sseRef.current = newEs;
        }
      }, 3000);
    };

    adminFetch('/debug').then(r => {
      if (r.logs) setLogs(r.logs);
    });

    return () => { es.close(); sseRef.current = null; };
  }, [open, minimized]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Always fetch error count when panel opens (for tab badge)
  useEffect(() => {
    if (!open || minimized) return;
    adminFetch('/errors?limit=200').then(r => {
      if (r && !r.error) setErrors(r);
    }).catch(() => {});
  }, [open, minimized]);

  // Higgsfield MCP connection status — poll while panel is open
  useEffect(() => {
    if (!open || minimized) return;
    const load = () => adminFetch('/higgsfield/status').then(r => {
      if (r && !r.error) setHfStatus({ connected: !!r.connected, accountEmail: r.accountEmail || null });
    }).catch(() => {});
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [open, minimized]);

  useEffect(() => {
    if (!open || minimized) return;
    if (tab === 'jobs') {
      setLoading(true);
      adminFetch('/stats').then(r => { setJobs(r.jobs || []); setLoading(false); });
    } else if (tab === 'models') {
      setLoading(true);
      adminFetch('/stats').then(r => { setModels(r.models || []); setLoading(false); });
    } else if (tab === 'stats') {
      setLoading(true);
      adminFetch('/stats').then(r => { setStats(r); setLoading(false); });
    } else if (tab === 'users') {
      setLoading(true);
      adminFetch('/users').then(r => { setUsers(r.users || []); setLoading(false); });
    } else if (tab === 'errors') {
      setLoading(true);
      adminFetch('/errors?limit=200').then(r => {
        if (r && !r.error) setErrors(r);
        else console.error('[AdminPanel] errors fetch failed:', r);
        setLoading(false);
      }).catch((e) => { console.error('[AdminPanel] errors fetch error:', e); setLoading(false); });
    } else if (tab === 'beta') {
      loadBetaCodes();
    }
  }, [tab, open, minimized]);

  const loadBetaCodes = () => {
    setLoading(true);
    setBetaMsg(null);
    adminFetch('/beta/codes').then(r => {
      const list: BetaCode[] = (r?.codes || []);
      setBetaCodes(list);
      setBetaEdits(Object.fromEntries(list.map(c => [c.id, {
        maxUses: c.maxUses == null ? '' : String(c.maxUses),
        uses: String(c.uses ?? 0),
      }])));
      setLoading(false);
    }).catch(() => { setLoading(false); setBetaMsg('Load error'); });
  };

  const saveBetaCode = async (id: string) => {
    const edit = betaEdits[id];
    if (!edit) return;
    setBetaSavingId(id);
    setBetaMsg(null);
    const patch: { maxUses: number | null; uses: number } = {
      maxUses: edit.maxUses.trim() === '' ? null : Math.max(1, parseInt(edit.maxUses, 10) || 1),
      uses: Math.max(0, parseInt(edit.uses, 10) || 0),
    };
    const r = await adminFetch(`/beta/codes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setBetaSavingId(null);
    if (r?.ok) { setBetaMsg('Saved ✓'); loadBetaCodes(); }
    else setBetaMsg(r?.error || 'Failure de l\'enregistrement');
  };

  const generateBetaCodes = async () => {
    const n = Math.min(500, Math.max(1, parseInt(betaGenCount, 10) || 0));
    if (!n) { setBetaMsg('Invalid number (1-500)'); return; }
    setBetaGenerating(true);
    setBetaMsg(null);
    setBetaLastBatch(null);
    const r = await adminFetch('/beta/generate', { method: 'POST', body: JSON.stringify({ count: n }) });
    setBetaGenerating(false);
    if (r?.ok) {
      setBetaLastBatch(r.codes || []);
      setBetaMsg(`${r.count} code(s) generated ✓`);
      loadBetaCodes();
    } else setBetaMsg(r?.error || 'Generation failed');
  };

  const toggleBetaActive = async (id: string, active: boolean) => {
    setBetaSavingId(id);
    const r = await adminFetch(`/beta/codes/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    setBetaSavingId(null);
    if (r?.ok) loadBetaCodes();
    else setBetaMsg(r?.error || 'Failure');
  };

  const killJob = (id: string) => adminFetch(`/jobs/${id}/kill`, { method: 'POST' }).then(() => {
    adminFetch('/stats').then(r => setJobs(r.jobs || []));
  });
  const killAllJobs = () => adminFetch('/jobs/kill-all', { method: 'POST' }).then(() => {
    adminFetch('/stats').then(r => setJobs(r.jobs || []));
  });
  const clearJobs = () => adminFetch('/jobs/clear', { method: 'POST' }).then(() => {
    adminFetch('/stats').then(r => setJobs(r.jobs || []));
  });
  const resetModels = () => adminFetch('/models/reset', { method: 'POST' }).then(() => {
    adminFetch('/stats').then(r => setModels(r.models || []));
  });

  // Drag
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.origX + (ev.clientX - dragRef.current.startX))),
        y: Math.max(0, Math.min(window.innerHeight - 50, dragRef.current.origY + (ev.clientY - dragRef.current.startY))),
      });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  // Resize
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({
        w: Math.max(500, resizeRef.current.origW + (ev.clientX - resizeRef.current.startX)),
        h: Math.max(280, resizeRef.current.origH + (ev.clientY - resizeRef.current.startY)),
      });
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size]);

  const filteredLogs = logs.filter(l => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false;
    if (filter && !l.message.toLowerCase().includes(filter.toLowerCase()) && !l.category.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formatAge = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  // ─── Ouverture via la touche F8 (plus de bouton visible à l'écran) ──────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Trigger : rien à l'écran tant que le panneau n'est pas ouvert ──────
  if (!open) {
    return null;
  }

  // ─── Minimized bar ───────────────────────────────
  if (minimized) {
    return (
      <div
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 99999,
          background: '#0d0d14',
          border: '1px solid #1a1a28',
          borderRadius: 10,
          padding: '5px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'move',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#666',
        }}
        onMouseDown={onDragStart}
      >
        <span style={{ color: '#555' }}>⚙</span>
        <span style={{ color: '#444' }}>admin</span>
        <span
          style={{ color: logs.filter(l => l.level === 'error').length > 0 ? '#ff4d4f' : '#333', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); setMinimized(false); setTab('errors'); }}
          title="View errors"
        >
          {logs.filter(l => l.level === 'error').length}err
        </span>
        <button onClick={() => setMinimized(false)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 12 }}>□</button>
        <button onClick={() => { setOpen(false); setMinimized(false); }} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 12 }}>✕</button>
      </div>
    );
  }

  // ─── Tab style ───────────────────────────────────
  const tabStyle = (t: Tab): React.CSSProperties => ({
    background: tab === t ? '#1a1a28' : 'transparent',
    border: tab === t ? '1px solid #252535' : '1px solid transparent',
    color: tab === t ? '#ccc' : '#444',
    padding: '4px 12px',
    cursor: 'pointer',
    fontSize: 11,
    borderRadius: 6,
    fontFamily: "'JetBrains Mono', monospace",
    transition: 'all 0.1s',
    fontWeight: tab === t ? 600 : 400,
  });

  // ─── Full panel ──────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 99999,
        background: '#0d0d14',
        border: '1px solid #1a1a28',
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.02)',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        color: '#888',
        overflow: 'hidden',
      }}
    >
      {/* ─── Title bar ─── */}
      <div
        onMouseDown={onDragStart}
        style={{
          background: '#0a0a12',
          padding: '7px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'move',
          borderBottom: '1px solid #151520',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* macOS-style dots */}
          <div style={{ display: 'flex', gap: 5 }}>
            <div
              onClick={() => setOpen(false)}
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.1)' }}
              title="Close"
            />
            <div
              onClick={() => setMinimized(true)}
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.1)' }}
              title="Minimize"
            />
            <div
              onClick={() => setSize(prev => prev.w > 900 ? { w: 780, h: 420 } : { w: 1000, h: 560 })}
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.1)' }}
              title="Resize"
            />
          </div>
          <span style={{ color: '#333', fontSize: 11, fontWeight: 500, marginLeft: 4 }}>velbaz admin</span>
        </div>
        {/* Higgsfield connection badge */}
        <div
          title={hfStatus?.connected
            ? `Higgsfield connected${hfStatus.accountEmail ? ' — ' + hfStatus.accountEmail : ''}`
            : 'Higgsfield not connected — type "higgsfield connect"'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 9px', borderRadius: 20,
            background: hfStatus == null ? 'rgba(120,120,120,0.12)' : hfStatus.connected ? 'rgba(82,196,26,0.14)' : 'rgba(255,77,79,0.14)',
            border: `1px solid ${hfStatus == null ? '#333' : hfStatus.connected ? 'rgba(82,196,26,0.5)' : 'rgba(255,77,79,0.5)'}`,
            fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
            color: hfStatus == null ? '#888' : hfStatus.connected ? '#52c41a' : '#ff6b6b',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: hfStatus == null ? '#888' : hfStatus.connected ? '#52c41a' : '#ff4d4f',
            boxShadow: hfStatus?.connected ? '0 0 6px #52c41a' : 'none',
          }} />
          Higgsfield {hfStatus == null ? '…' : hfStatus.connected ? 'connected' : 'disconnected'}
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div style={{
        display: 'flex',
        gap: 3,
        padding: '6px 10px',
        background: '#0b0b13',
        borderBottom: '1px solid #151520',
        flexShrink: 0,
      }}>
        {([
          { key: 'terminal', label: '> Terminal' },
          { key: 'logs', label: 'Logs' },
          { key: 'jobs', label: 'Jobs' },
          { key: 'models', label: 'Models' },
          { key: 'stats', label: 'Stats' },
          { key: 'credits', label: 'Credits IA' },
          { key: 'beta', label: 'Beta' },
          { key: 'users', label: 'Users' },
          { key: 'errors', label: (() => {
            const apiTotal = errors?.total || 0;
            const liveCount = logs.filter(l => l.level === 'error').length;
            const total = Math.max(apiTotal, liveCount);
            return total > 0 ? `Errors (${total})` : 'Errors';
          })() },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} style={tabStyle(t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Content ─── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* TERMINAL */}
        {tab === 'terminal' && (
          <Terminal logs={logs} setTab={setTab} />
        )}

        {/* LOGS */}
        {tab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexShrink: 0, alignItems: 'center' }}>
              <input
                placeholder="Filter logs..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
                style={{
                  flex: 1, background: '#111119', border: '1px solid #1f1f2e', borderRadius: 6,
                  color: '#888', padding: '4px 10px', fontSize: 11, fontFamily: 'inherit', outline: 'none',
                }}
              />
              <select
                value={levelFilter}
                onChange={e => setLevelFilter(e.target.value)}
                style={{
                  background: '#111119', border: '1px solid #1f1f2e', borderRadius: 6,
                  color: '#888', padding: '4px 8px', fontSize: 11, fontFamily: 'inherit', outline: 'none',
                }}
              >
                <option value="all">All</option>
                <option value="error">Errors</option>
                <option value="warn">Warnings</option>
                <option value="ai">AI</option>
                <option value="job">Jobs</option>
                <option value="info">Info</option>
              </select>
              <label style={{ fontSize: 10, color: '#444', display: 'flex', alignItems: 'center', gap: 3 }}>
                <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
                Auto
              </label>
              <button onClick={() => setLogs([])} style={{ background: '#151520', border: '1px solid #1f1f2e', color: '#555', padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 10 }}>Clear</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {filteredLogs.length === 0 && <div style={{ color: '#333', textAlign: 'center', marginTop: 50 }}>Waiting for logs...</div>}
              {filteredLogs.map((l, i) => (
                <div key={l.id || i} style={{
                  padding: '2px 8px',
                  borderLeft: `2px solid ${LEVEL_COLORS[l.level] || '#333'}`,
                  background: LEVEL_BG[l.level] || 'transparent',
                  marginBottom: 1,
                  lineHeight: 1.5,
                  wordBreak: 'break-all',
                }}>
                  <span style={{ color: '#333', marginRight: 6 }}>{formatTime(l.ts)}</span>
                  <span style={{ color: LEVEL_COLORS[l.level], fontWeight: 600, marginRight: 6, textTransform: 'uppercase', fontSize: 10 }}>{l.level}</span>
                  {l.category && <span style={{ color: '#444', marginRight: 6 }}>[{l.category}]</span>}
                  <span style={{ color: l.level === 'error' ? '#ff6b6b' : '#777' }}>{l.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* JOBS */}
        {tab === 'jobs' && (
          <div style={{ padding: 8, overflow: 'auto' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={killAllJobs} style={{ background: '#1a0a0a', border: '1px solid #3a1515', color: '#ff4d4f', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Kill All</button>
              <button onClick={clearJobs} style={{ background: '#111119', border: '1px solid #1f1f2e', color: '#666', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Clear Done</button>
              <button onClick={() => adminFetch('/stats').then(r => setJobs(r.jobs || []))} style={{ background: '#111119', border: '1px solid #1f1f2e', color: '#666', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Refresh</button>
            </div>
            {loading && <div style={{ color: '#444' }}>Loading...</div>}
            {!loading && jobs.length === 0 && <div style={{ color: '#333', textAlign: 'center', marginTop: 40 }}>No active jobs</div>}
            {jobs.map(j => (
              <div key={j.id} style={{ padding: '6px 10px', background: '#111119', borderRadius: 8, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1a1a28' }}>
                <div>
                  <span style={{ color: j.status === 'running' ? '#52c41a' : j.status === 'failed' ? '#ff4d4f' : '#faad14', fontWeight: 600, fontSize: 10, marginRight: 6, textTransform: 'uppercase' }}>{j.status}</span>
                  <span style={{ color: '#1890ff', marginRight: 6 }}>{j.type}</span>
                  <span style={{ color: '#444', fontSize: 10 }}>{j.id.slice(0, 8)} · {formatAge(j.startedAt)}</span>
                  {j.error && <div style={{ color: '#ff6b6b', fontSize: 10, marginTop: 2 }}>{j.error}</div>}
                </div>
                {j.status === 'running' && (
                  <button onClick={() => killJob(j.id)} style={{ background: '#1a0a0a', border: '1px solid #3a1515', color: '#ff4d4f', padding: '2px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 10 }}>Kill</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* MODELS */}
        {tab === 'models' && (
          <div style={{ padding: 8, overflow: 'auto' }}>
            <div style={{ marginBottom: 8 }}>
              <button onClick={resetModels} style={{ background: '#0f0a1a', border: '1px solid #251a3a', color: '#b37feb', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Reset All Health</button>
            </div>
            {loading && <div style={{ color: '#444' }}>Loading...</div>}
            {models.map(m => (
              <div key={m.model} style={{ padding: '6px 10px', background: '#111119', borderRadius: 8, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1a1a28' }}>
                <div>
                  <span style={{ color: m.blocked ? '#ff4d4f' : '#52c41a', fontWeight: 600, marginRight: 8, fontSize: 10 }}>{m.blocked ? '✖ BLOCKED' : '● OK'}</span>
                  <span style={{ color: '#999' }}>{m.model}</span>
                  <span style={{ color: '#444', marginLeft: 8, fontSize: 10 }}>fails: {m.failures}</span>
                  {m.blocked && m.blockedUntil && <span style={{ color: '#ff4d4f', marginLeft: 8, fontSize: 10 }}>until {new Date(m.blockedUntil).toLocaleTimeString()}</span>}
                </div>
                {m.lastUsed && <span style={{ color: '#333', fontSize: 10 }}>{formatAge(m.lastUsed)}</span>}
              </div>
            ))}
            {!loading && models.length === 0 && <div style={{ color: '#333', textAlign: 'center', marginTop: 40 }}>No model data</div>}
          </div>
        )}

        {/* STATS */}
        {tab === 'stats' && (
          <div style={{ padding: 8, overflow: 'auto' }}>
            {loading && <div style={{ color: '#444' }}>Loading...</div>}
            {stats && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  {[
                    { label: 'Active Jobs', value: stats.activeJobs, color: '#1890ff' },
                    { label: 'Logs', value: stats.debugLogCount, color: '#b37feb' },
                    { label: 'Uptime', value: stats.uptime ? `${Math.floor(stats.uptime / 60)}m` : '-', color: '#52c41a' },
                    { label: 'Heap MB', value: stats.memory ? Math.round(stats.memory.heapUsed / 1024 / 1024) : '-', color: '#faad14' },
                  ].map(s => (
                    <div key={s.label} style={{ background: '#111119', borderRadius: 10, padding: '14px 12px', textAlign: 'center', border: '1px solid #1a1a28' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ color: '#333', fontSize: 10, marginBottom: 4 }}>RAW</div>
                <pre style={{ background: '#0a0a12', padding: 8, borderRadius: 8, fontSize: 10, color: '#555', overflow: 'auto', maxHeight: 180, border: '1px solid #151520' }}>
                  {JSON.stringify(stats, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}

        {/* CREDITS IA — suivi de la consommation IA (voir AiCreditsPanel.tsx) */}
        {tab === 'credits' && <AiCreditsPanel />}

        {/* BETA */}
        {tab === 'beta' && (
          <div style={{ padding: 8, overflow: 'auto' }}>
            {loading && <div style={{ color: '#444' }}>Loading...</div>}
            {!loading && (() => {
              const normal = betaCodes.filter(c => !c.isAdmin);
              const usedCount = normal.filter(c => (c.uses || 0) > 0 || c.usedAt).length;
              const connectedCount = normal.filter(c => c.account?.connected).length;
              const q = betaFilter.trim().toLowerCase();
              const filtered = betaCodes.filter(c => {
                if (!q) return true;
                return (
                  c.code.toLowerCase().includes(q) ||
                  (c.account?.email || '').toLowerCase().includes(q) ||
                  (c.account?.name || '').toLowerCase().includes(q) ||
                  (c.usedIp || '').toLowerCase().includes(q) ||
                  (c.label || '').toLowerCase().includes(q)
                );
              });
              return (
                <>
                  {/* Résumé */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                    {[
                      { label: 'Codes generated', value: normal.length, color: '#b37feb' },
                      { label: 'Codes used', value: usedCount, color: '#1890ff' },
                      { label: 'Linked accounts', value: connectedCount, color: '#52c41a' },
                      { label: 'Remaining', value: Math.max(0, normal.filter(c => c.active && !(c.uses || 0) && !c.usedAt).length), color: '#faad14' },
                    ].map(s => (
                      <div key={s.label} style={{ background: '#111119', borderRadius: 10, padding: '14px 12px', textAlign: 'center', border: '1px solid #1a1a28' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Batch generation */}
                  <div style={{ background: '#111119', border: '1px solid #1a1a28', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#bbb', marginBottom: 8 }}>Generate unique codes (single use)</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 10, color: '#555' }}>Count (1-500)</span>
                        <input
                          type="number" min={1} max={500}
                          value={betaGenCount}
                          onChange={e => setBetaGenCount(e.target.value)}
                          style={{ width: 100, background: '#0a0a12', border: '1px solid #252535', borderRadius: 6, color: '#ddd', padding: '5px 8px', fontSize: 12, fontFamily: 'inherit' }}
                        />
                      </label>
                      <button
                        onClick={generateBetaCodes}
                        disabled={betaGenerating}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '7px 16px', borderRadius: 6, cursor: betaGenerating ? 'default' : 'pointer',
                          background: 'rgba(179,127,235,0.15)', border: '1px solid rgba(179,127,235,0.5)', color: '#c39bf0',
                        }}
                      >
                        {betaGenerating ? 'Generating…' : 'Generate'}
                      </button>
                    </div>
                    {betaLastBatch && betaLastBatch.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: '#555' }}>Last batch ({betaLastBatch.length})</span>
                          <button
                            onClick={() => { navigator.clipboard?.writeText(betaLastBatch.join('\n')); setBetaMsg('Copied ✓'); }}
                            style={{ fontSize: 10, color: '#40a9ff', background: 'transparent', border: '1px solid rgba(24,144,255,0.4)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}
                          >Copy all</button>
                        </div>
                        <div style={{ maxHeight: 120, overflow: 'auto', background: '#0a0a12', border: '1px solid #252535', borderRadius: 6, padding: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {betaLastBatch.map(c => (
                            <span key={c} onClick={() => { navigator.clipboard?.writeText(c); setBetaMsg('Copied ✓'); }} style={{ fontSize: 11, fontFamily: 'monospace', color: '#c39bf0', background: 'rgba(179,127,235,0.1)', border: '1px solid rgba(179,127,235,0.3)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {betaMsg && (
                    <div style={{ fontSize: 11, marginBottom: 8, color: betaMsg.includes('✓') ? '#52c41a' : '#ff6b6b' }}>{betaMsg}</div>
                  )}

                  {/* Filtre */}
                  <input
                    placeholder="Search: code, email, name, IP…"
                    value={betaFilter}
                    onChange={e => setBetaFilter(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#0a0a12', border: '1px solid #252535', borderRadius: 8, color: '#ddd', padding: '8px 12px', fontSize: 12, fontFamily: 'inherit', marginBottom: 10 }}
                  />

                  {/* Tableau des codes */}
                  <div style={{ overflowX: 'auto', border: '1px solid #1a1a28', borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 900 }}>
                      <thead>
                        <tr style={{ background: '#111119', color: '#666', textAlign: 'left' }}>
                          {['Code', 'Active', 'Used', 'IP', 'Device', 'Account', 'Name', 'Email', 'Credits available', 'Credits used'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid #1a1a28' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 && (
                          <tr><td colSpan={10} style={{ padding: 16, color: '#444', textAlign: 'center' }}>No codes.</td></tr>
                        )}
                        {filtered.map(code => {
                          const used = (code.uses || 0) > 0 || !!code.usedAt;
                          const acc = code.account;
                          return (
                            <tr key={code.id} style={{ borderBottom: '1px solid #14141f' }}>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                <span onClick={() => { navigator.clipboard?.writeText(code.code); setBetaMsg('Copied ✓'); }} style={{ fontFamily: 'monospace', fontWeight: 700, color: code.isAdmin ? '#faad14' : '#ddd', cursor: 'pointer' }}>{code.code}</span>
                                {code.isAdmin && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 5, background: 'rgba(250,173,20,0.15)', color: '#faad14' }}>MASTER</span>}
                              </td>
                              <td style={{ padding: '8px 10px' }}>
                                <button
                                  onClick={() => toggleBetaActive(code.id, !code.active)}
                                  disabled={betaSavingId === code.id}
                                  style={{
                                    fontSize: 10, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
                                    background: code.active ? 'rgba(82,196,26,0.14)' : 'rgba(255,77,79,0.14)',
                                    border: `1px solid ${code.active ? 'rgba(82,196,26,0.5)' : 'rgba(255,77,79,0.5)'}`,
                                    color: code.active ? '#52c41a' : '#ff6b6b',
                                  }}
                                >{code.active ? 'Active' : 'Inactive'}</button>
                              </td>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                {code.isAdmin ? <span style={{ color: '#555' }}>∞</span> : used
                                  ? <span style={{ color: '#52c41a' }}>Yes{code.usedAt ? ` · ${new Date(code.usedAt).toLocaleDateString('fr-FR')}` : ''}</span>
                                  : <span style={{ color: '#555' }}>No</span>}
                              </td>
                              <td style={{ padding: '8px 10px', color: '#888', whiteSpace: 'nowrap' }}>{code.usedIp || '—'}</td>
                              <td style={{ padding: '8px 10px', color: '#888', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${code.usedDeviceId || ''} ${code.usedUserAgent || ''}`.trim()}>{code.usedDeviceId ? code.usedDeviceId.slice(0, 10) + '…' : '—'}</td>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                {acc?.connected ? <span style={{ color: '#52c41a' }}>Yes</span> : <span style={{ color: '#555' }}>No</span>}
                              </td>
                              <td style={{ padding: '8px 10px', color: '#bbb', whiteSpace: 'nowrap' }}>{acc?.name || '—'}</td>
                              <td style={{ padding: '8px 10px', color: '#bbb', whiteSpace: 'nowrap' }}>{acc?.email || '—'}</td>
                              <td style={{ padding: '8px 10px', color: '#40a9ff', whiteSpace: 'nowrap' }}>{acc?.connected ? (acc.creditsAvailable ?? 0) : '—'}</td>
                              <td style={{ padding: '8px 10px', color: '#faad14', whiteSpace: 'nowrap' }}>{acc?.connected ? (acc.creditsUsed ?? 0) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={loadBetaCodes} style={{ marginTop: 10, fontSize: 10, color: '#555', background: 'transparent', border: '1px solid #252535', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>↻ Refresh</button>
                </>
              );
            })()}
          </div>
        )}
        {/* USERS */}
        {tab === 'users' && !viewingUserErrors && !viewingUserVars && (
          <div style={{ padding: 8, overflow: 'auto' }} onClick={() => userMenuId && setUserMenuId(null)}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={() => { setLoading(true); adminFetch('/users').then(r => { setUsers(r.users || []); setLoading(false); }); }} style={{ background: '#111119', border: '1px solid #1f1f2e', color: '#666', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Refresh</button>
              <span style={{ color: '#333', fontSize: 10, lineHeight: '28px' }}>{users.length} users</span>
            </div>
            {loading && <div style={{ color: '#444' }}>Loading...</div>}
            {!loading && users.length === 0 && <div style={{ color: '#333', textAlign: 'center', marginTop: 40 }}>No users</div>}
            {users.map((u, i) => (
              <div key={i} style={{ padding: '6px 10px', background: '#111119', borderRadius: 8, marginBottom: 4, border: '1px solid #1a1a28', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: '#999' }}>{u.name || 'Unnamed'}</span>
                    <span style={{ color: '#444', fontSize: 10, marginLeft: 8 }}>{u.email}</span>
                    {u.createdAt && <span style={{ color: '#333', fontSize: 10, marginLeft: 8 }}>joined {new Date(u.createdAt).toLocaleDateString()}</span>}
                    {u.plan && u.plan !== 'free' && <span style={{ color: '#b37feb', fontSize: 9, marginLeft: 6, background: '#1a0f2e', padding: '1px 6px', borderRadius: 4 }}>{u.plan}</span>}
                    <span style={{ color: '#52c41a', fontSize: 9, marginLeft: 6, background: '#0a1a0a', padding: '1px 6px', borderRadius: 4 }}>{u.tokens ?? 0} tokens</span>
                  </div>
                  {/* 3-dot menu */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setUserMenuId(userMenuId === u.id ? null : u.id); }}
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1, borderRadius: 4 }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1a1a28')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >⋯</button>
                    {userMenuId === u.id && (
                      <div style={{
                        position: 'absolute', right: 0, top: '100%', zIndex: 100,
                        background: '#111119', border: '1px solid #252535', borderRadius: 8,
                        padding: 4, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                      }}>
                        <button
                          onClick={() => {
                            setUserMenuId(null);
                            setLoadingUserErrors(true);
                            adminFetch(`/users/${u.id}/errors`).then(r => {
                              setViewingUserErrors({ user: u, errors: r.errors || [], failedJobs: r.failedJobs || [], companies: r.companies || [] });
                              setLoadingUserErrors(false);
                            }).catch(() => setLoadingUserErrors(false));
                          }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: '6px 10px', fontSize: 11, borderRadius: 6, fontFamily: 'inherit' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,77,79,0.08)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >View Errors</button>
                        <button
                          onClick={() => {
                            setUserMenuId(null);
                            adminFetch(`/users/${u.id}`).then(r => {
                              const info = r.user;
                              const comps = r.companies || [];
                              setViewingUserErrors({ user: u, errors: [], failedJobs: [], companies: comps });
                            });
                          }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '6px 10px', fontSize: 11, borderRadius: 6, fontFamily: 'inherit' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#1a1a28')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >View Companies</button>
                        <button
                          onClick={() => {
                            setUserMenuId(null);
                            adminFetch(`/users/${u.id}/variables`).then(r => {
                              setViewingUserVars({ user: u, variables: r.variables || {}, tokenHistory: r.tokenHistory || [] });
                              setEditingTokens(String(r.variables?.tokens ?? 0));
                            });
                          }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#52c41a', cursor: 'pointer', padding: '6px 10px', fontSize: 11, borderRadius: 6, fontFamily: 'inherit' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(82,196,26,0.08)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >Variables</button>
                        <button
                          // [2026-09-15] Copiait l'ID sans rien dire : on confirme par un toast.
                          onClick={() => { setUserMenuId(null); navigator.clipboard.writeText(u.id).then(() => toastSuccess('User ID copied')); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '6px 10px', fontSize: 11, borderRadius: 6, fontFamily: 'inherit' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#1a1a28')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >Copy User ID</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* USER ERRORS DETAIL VIEW */}
        {tab === 'users' && viewingUserErrors && (
          <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setViewingUserErrors(null)}
                style={{ background: '#111119', border: '1px solid #1f1f2e', color: '#888', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
              >← Back</button>
              <span style={{ color: '#999', fontSize: 12 }}>{viewingUserErrors.user.name || 'Unnamed'}</span>
              <span style={{ color: '#444', fontSize: 10 }}>{viewingUserErrors.user.email}</span>
            </div>

            {/* Companies list */}
            {viewingUserErrors.companies.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: '#444', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Companies ({viewingUserErrors.companies.length})</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {viewingUserErrors.companies.map((c: any) => (
                    <span key={c.id} style={{ background: '#111119', border: '1px solid #1a1a28', color: '#888', padding: '3px 8px', borderRadius: 6, fontSize: 10 }}>{c.name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Error count header */}
            <div style={{ color: '#ff4d4f', fontSize: 11, marginBottom: 6, fontWeight: 600 }}>
              {viewingUserErrors.errors.length + viewingUserErrors.failedJobs.length} errors found
            </div>

            {loadingUserErrors && <div style={{ color: '#444' }}>Loading...</div>}

            {/* Failed jobs */}
            {viewingUserErrors.failedJobs.map((j: any, i: number) => (
              <div key={`fj-${i}`} style={{ padding: '6px 10px', background: 'rgba(255,77,79,0.06)', borderLeft: '2px solid #ff4d4f', borderRadius: 6, marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#ff6b6b', fontSize: 10, fontWeight: 600 }}>JOB FAILED — {j.jobType}</span>
                  <span style={{ color: '#333', fontSize: 10 }}>{j.ts ? new Date(j.ts).toLocaleString() : ''}</span>
                </div>
                <div style={{ color: '#884444', fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>{j.message}</div>
              </div>
            ))}

            {/* Agent activity errors */}
            {viewingUserErrors.errors.map((e: any, i: number) => (
              <div key={`ae-${i}`} style={{ padding: '6px 10px', background: 'rgba(255,77,79,0.04)', borderLeft: '2px solid #662222', borderRadius: 6, marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    {e.companyName && <span style={{ color: '#1890ff', fontSize: 10, marginRight: 6 }}>{e.companyName}</span>}
                    {e.agentRole && <span style={{ color: '#b37feb', fontSize: 9, background: '#1a0f2e', padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>{e.agentRole}</span>}
                  </div>
                  <span style={{ color: '#333', fontSize: 10 }}>{e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}</span>
                </div>
                <div style={{ color: '#884444', fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>{e.message}</div>
              </div>
            ))}

            {viewingUserErrors.errors.length === 0 && viewingUserErrors.failedJobs.length === 0 && !loadingUserErrors && (
              <div style={{ color: '#333', textAlign: 'center', marginTop: 30, fontSize: 11 }}>No errors found for this user.</div>
            )}
          </div>
        )}

        {/* USER VARIABLES DETAIL VIEW */}
        {tab === 'users' && viewingUserVars && !viewingUserErrors && (
          <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setViewingUserVars(null)}
                style={{ background: '#111119', border: '1px solid #1f1f2e', color: '#888', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
              >← Back</button>
              <span style={{ color: '#52c41a', fontSize: 12, fontWeight: 600 }}>Variables</span>
              <span style={{ color: '#999', fontSize: 11 }}>{viewingUserVars.user.name}</span>
              <span style={{ color: '#444', fontSize: 10 }}>{viewingUserVars.user.email}</span>
            </div>

            {/* Variables Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              {Object.entries(viewingUserVars.variables).map(([key, value]) => {
                if (key === 'tokens') return null;
                return (
                  <div key={key} style={{ background: '#111119', borderRadius: 8, padding: '8px 12px', border: '1px solid #1a1a28' }}>
                    <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{key}</div>
                    <div style={{ fontSize: 12, color: '#999', wordBreak: 'break-all' }}>
                      {key === 'createdAt' && value ? new Date(value as any).toLocaleString() : String(value ?? '-')}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Editable Token Count */}
            <div style={{ background: '#0a1a0a', borderRadius: 10, padding: 14, border: '1px solid #1a2a1a', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#52c41a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Token Balance</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  value={editingTokens}
                  onChange={e => setEditingTokens(e.target.value)}
                  type="number"
                  min="0"
                  style={{
                    width: 100, background: '#111119', border: '1px solid #1f2f1f', borderRadius: 6,
                    color: '#52c41a', padding: '6px 10px', fontSize: 16, fontWeight: 700, fontFamily: 'monospace', outline: 'none', textAlign: 'center',
                  }}
                />
                <button
                  onClick={async () => {
                    const newTokens = parseInt(editingTokens);
                    if (isNaN(newTokens) || newTokens < 0) return;
                    await adminFetch('/tokens/set', { method: 'POST', body: JSON.stringify({ userId: viewingUserVars!.user.id, tokens: newTokens }) });
                    setViewingUserVars(prev => prev ? { ...prev, variables: { ...prev.variables, tokens: newTokens } } : null);
                    // Refresh user list
                    adminFetch('/users').then(r => setUsers(r.users || []));
                  }}
                  style={{ background: '#1a2a1a', border: '1px solid #2a3a2a', color: '#52c41a', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 600 }}
                >Save</button>
              </div>
            </div>

            {/* Token History */}
            <div style={{ fontSize: 10, color: '#444', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Token History (last 20)
            </div>
            {viewingUserVars.tokenHistory.length === 0 && (
              <div style={{ color: '#333', textAlign: 'center', marginTop: 20, fontSize: 11 }}>No token transactions yet.</div>
            )}
            {viewingUserVars.tokenHistory.map((tx: any) => (
              <div key={tx.id} style={{
                padding: '5px 10px', marginBottom: 3, borderRadius: 6,
                background: tx.amount > 0 ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)',
                borderLeft: `2px solid ${tx.amount > 0 ? '#52c41a' : '#ff4d4f'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: tx.amount > 0 ? '#52c41a' : '#ff4d4f', fontSize: 11, fontWeight: 600 }}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount}
                    </span>
                    <span style={{ color: '#555', fontSize: 10, marginLeft: 6 }}>{tx.type}</span>
                    {tx.action && <span style={{ color: '#444', fontSize: 9, marginLeft: 6 }}>({tx.action})</span>}
                  </div>
                  <div>
                    <span style={{ color: '#555', fontSize: 10, marginRight: 8 }}>bal: {tx.balance}</span>
                    <span style={{ color: '#333', fontSize: 10 }}>{tx.createdAt ? new Date(tx.createdAt * 1000).toLocaleString() : ''}</span>
                  </div>
                </div>
                {tx.note && <div style={{ color: '#444', fontSize: 10, marginTop: 1 }}>{tx.note}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ERRORS — unified sorted list */}
        {tab === 'errors' && (
          <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
              <button onClick={() => {
                setLoading(true);
                adminFetch('/errors?limit=200').then(r => {
                  if (r && !r.error) setErrors(r);
                  setLoading(false);
                }).catch(() => setLoading(false));
              }} style={{ background: '#111119', border: '1px solid #1f1f2e', color: '#666', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Refresh</button>
              <span style={{ color: '#888', fontSize: 10, fontWeight: 600 }}>
                {Math.max(errors?.total || 0, logs.filter(l => l.level === 'error').length)} total errors
              </span>
            </div>
            {loading && <div style={{ color: '#666' }}>Loading errors...</div>}
            {!loading && (!errors || errors.total === 0) && logs.filter(l => l.level === 'error' || l.level === 'warn').length === 0 && <div style={{ color: '#555', textAlign: 'center', marginTop: 40 }}>No errors. All clear.</div>}

            {!loading && (() => {
              // Merge ALL error sources: API data + live logs
              const allErrors: any[] = [];
              const colorMap: Record<string, { border: string; bg: string; label: string; labelColor: string; msgColor: string }> = {
                persistent: { border: '#ff7a45', bg: 'rgba(255,122,69,0.06)', label: 'DB ERROR', labelColor: '#ff7a45', msgColor: '#dd6644' },
                execution: { border: '#13c2c2', bg: 'rgba(19,194,194,0.04)', label: 'EXEC FAILED', labelColor: '#13c2c2', msgColor: '#889999' },
                runtime: { border: '#ff4d4f', bg: 'rgba(255,77,79,0.06)', label: 'RUNTIME', labelColor: '#ff4d4f', msgColor: '#ff6b6b' },
                warn: { border: '#faad14', bg: 'rgba(250,173,20,0.04)', label: 'WARNING', labelColor: '#faad14', msgColor: '#c4a140' },
                job: { border: '#1890ff', bg: 'rgba(24,144,255,0.04)', label: 'JOB FAILED', labelColor: '#1890ff', msgColor: '#6699cc' },
                agent: { border: '#b37feb', bg: 'rgba(179,127,235,0.04)', label: 'AGENT', labelColor: '#b37feb', msgColor: '#9977bb' },
                live: { border: '#ff4d4f', bg: 'rgba(255,77,79,0.06)', label: 'LIVE', labelColor: '#ff4d4f', msgColor: '#ff6b6b' },
              };

              // From API (if available)
              if (errors) {
                (errors.persistentErrors || []).forEach((e: any) => allErrors.push({
                  ...e, _type: 'persistent', _ts: e.ts || 0,
                }));
                (errors.failedExecs || []).forEach((e: any) => allErrors.push({
                  ...e, _type: 'execution', _ts: e.ts || 0, message: e.message || e.error || `Execution ${e.type} failed`,
                }));
                (errors.memErrors || []).forEach((e: any) => allErrors.push({
                  ...e, _type: e.level === 'warn' ? 'warn' : 'runtime', _ts: e.ts || 0,
                }));
                (errors.failedJobs || []).forEach((j: any) => allErrors.push({
                  ...j, _type: 'job', _ts: j.ts || 0, message: j.message || `Job ${j.jobType} failed`,
                }));
                (errors.dbErrors || []).forEach((e: any) => allErrors.push({
                  ...e, _type: 'agent', _ts: e.ts || 0,
                }));
              }

              // Also include live SSE log errors (the ones shown in minimized bar as "Xerr")
              const liveErrors = logs.filter(l => l.level === 'error' || l.level === 'warn');
              // Deduplicate: only add if message not already present from API memErrors
              const existingMessages = new Set(allErrors.map(e => e.message));
              liveErrors.forEach(l => {
                if (!existingMessages.has(l.message)) {
                  allErrors.push({
                    id: `live-${l.ts}-${Math.random().toString(36).slice(2, 6)}`,
                    _type: l.level === 'warn' ? 'warn' : 'live',
                    _ts: l.ts || 0,
                    level: l.level,
                    message: l.message,
                    source: 'live-stream',
                  });
                }
              });

              // Sort by timestamp descending (most recent first)
              allErrors.sort((a, b) => (b._ts || 0) - (a._ts || 0));

              if (allErrors.length === 0) {
                return null; // "No errors" already shown above
              }

              return allErrors.map((e: any, i: number) => {
                const style = colorMap[e._type] || colorMap.runtime;
                return (
                  <div key={e.id || `err-${i}`} style={{
                    padding: '6px 10px', marginBottom: 4, borderRadius: 6,
                    background: style.bg,
                    borderLeft: `2px solid ${style.border}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ color: style.labelColor, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{style.label}</span>
                        {e.source && e._type === 'persistent' && <span style={{ color: '#888', fontSize: 9 }}>({e.source})</span>}
                        {e.companyName && <span style={{ color: '#1890ff', fontSize: 9 }}>{e.companyName}</span>}
                        {e.agentRole && <span style={{ color: '#b37feb', fontSize: 9, background: '#1a0f2e', padding: '1px 5px', borderRadius: 3 }}>{e.agentRole}</span>}
                        {e.jobType && <span style={{ color: '#13c2c2', fontSize: 9 }}>{e.jobType}</span>}
                        {e.type && e._type === 'execution' && <span style={{ color: '#13c2c2', fontSize: 9 }}>{e.type}</span>}
                        {e.companyId && !e.companyName && <span style={{ color: '#555', fontSize: 8 }}>co:{String(e.companyId).slice(0, 8)}</span>}
                      </div>
                      <span style={{ color: '#555', fontSize: 9, flexShrink: 0 }}>{e._ts ? new Date(e._ts).toLocaleString() : ''}</span>
                    </div>
                    <div style={{ color: style.msgColor, fontSize: 11, marginTop: 2, wordBreak: 'break-all', lineHeight: 1.4 }}>{e.message || '(no message)'}</div>
                    {e.stack && (
                      <details style={{ marginTop: 2 }}>
                        <summary style={{ color: '#555', fontSize: 9, cursor: 'pointer' }}>Stack trace</summary>
                        <pre style={{ color: '#666', fontSize: 9, whiteSpace: 'pre-wrap', margin: '2px 0 0', lineHeight: 1.3 }}>{e.stack}</pre>
                      </details>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      {/* ─── Resize handle ─── */}
      <div
        onMouseDown={onResizeStart}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 18,
          height: 18,
          cursor: 'se-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#222',
          fontSize: 10,
          borderRadius: '0 0 14px 0',
        }}
      >
        ◢
      </div>
    </div>
  );
}
