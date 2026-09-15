import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { AnimatedCounter } from '../components/AnimatedCounter';

function timeAgo(date: Date | string) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Cache mémoire partagé entre les visites du dashboard : au retour sur la page,
// les données déjà connues s'affichent instantanément et le rafraîchissement se
// fait en arrière-plan (plus d'écran de chargement plein écran à chaque fois).
const cache: { companies: any[] | null; tasks: any[] | null } = { companies: null, tasks: null };

function SkeletonRow({ h = 64 }: { h?: number }) {
  return (
    <div
      className="rounded-xl animate-pulse"
      style={{ height: h, background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
    />
  );
}

export default function Dashboard() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [companies, setCompanies] = useState<any[]>(cache.companies || []);
  const [tasks, setTasks] = useState<any[]>(cache.tasks || []);
  // On ne bloque plus la page entière : seules les sections encore vides
  // affichent un squelette pendant que les requêtes tournent.
  const [loadingCompanies, setLoadingCompanies] = useState(cache.companies === null);
  const [loadingTasks, setLoadingTasks] = useState(cache.tasks === null);

  useEffect(() => { if (!loading && !user) navigate('/login'); }, [user, loading]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    // Deux requêtes indépendantes : la liste des projets s'affiche dès qu'elle
    // arrive, sans attendre l'activité récente (avant : Promise.all bloquant).
    api.companies.list()
      .then((c: any) => {
        if (!alive) return;
        const list = c?.companies || [];
        cache.companies = list;
        setCompanies(list);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingCompanies(false); });

    api.tasks.recent()
      .then((t: any) => {
        if (!alive) return;
        const list = t?.tasks || [];
        cache.tasks = list;
        setTasks(list);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingTasks(false); });

    return () => { alive = false; };
  }, [user?.id]);

  if (loading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-0)' }}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
          <span className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading...</span>
        </div>
      </div>
    );
  }

  const totalArr = companies.reduce((sum, c) => sum + (c.arr || 0), 0);
  const totalMrr = companies.reduce((sum, c) => sum + (c.mrr || 0), 0);
  const totalRevenue = companies.reduce((sum, c) => sum + (c.totalRevenue || 0), 0);
  const activeCos = companies.filter(c => c.status === 'active').length;

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-0)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Welcome back, {user?.name?.split(' ')[0]}.</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>Your projects at a glance.</p>
          </div>
          <Link href="/"><button className="text-[13px] font-medium px-4 py-2 rounded-lg transition-colors" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>+ New</button></Link>
        </div>

        {/* [2026-09-04] Les compteurs partaient de 0 puis sautaient aux vraies
            valeurs : on affiche un chargement tant que les projets ne sont pas
            arrivés, pour ne jamais montrer de chiffres faux. */}
        {loadingCompanies && companies.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <SkeletonRow h={84} /><SkeletonRow h={84} /><SkeletonRow h={84} /><SkeletonRow h={84} />
          </div>
        ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Total ARR', num: Math.round(totalArr), prefix: '$', color: 'var(--teal)' },
            { label: 'MRR', num: Math.round(totalMrr), prefix: '$', color: '#8B5CF6' },
            { label: 'Projects', num: companies.length, prefix: '', sub: `${activeCos} active`, color: 'var(--text-primary)' },
            { label: 'Revenue', num: Math.round(totalRevenue), prefix: '$', color: '#F59E0B' },
          ].map(s => (
            <div key={s.label} className="p-4 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
              <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>{s.label}</div>
              <div className="text-xl font-semibold" style={{ color: (s as any).color || 'var(--text-primary)' }}><AnimatedCounter value={s.num} prefix={s.prefix} fontSize={20} /></div>
              {s.sub && <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-ghost)' }}>{s.sub}</div>}
            </div>
          ))}
        </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Your Projects</h2>
              <Link href="/"><span className="text-[12px] font-medium cursor-pointer" style={{ color: 'var(--teal)' }}>+ New</span></Link>
            </div>

            {/* [2026-09-04] Correctif : tant que la liste n'est pas revenue, on
                affiche un CHARGEMENT. Avant, `loadingCompanies` existait mais
                n'était jamais lu : la page montrait « No projects yet » puis les
                projets surgissaient après coup. */}
            {loadingCompanies && companies.length === 0 ? (
              <div className="space-y-2">
                <SkeletonRow /><SkeletonRow /><SkeletonRow />
              </div>
            ) : companies.length === 0 ? (
              <div className="p-10 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
                <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>No projects yet.</h3>
                <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>Launch your first project in 60 seconds.</p>
                <Link href="/"><button className="text-[13px] font-medium px-5 py-2.5 rounded-lg" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>Launch Now</button></Link>
              </div>
            ) : (
              <div className="space-y-2">
                {companies.map(c => (
                  <Link key={c.id} href={`/company/${c.id}`}>
                    <div className="p-4 rounded-xl cursor-pointer transition-colors" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className={`status-dot ${c.status === 'active' ? 'live' : 'idle'}`} />
                          <span className="font-medium text-[14px]" style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ color: 'var(--text-faint)', border: '1px solid var(--border-default)' }}>{c.industry || 'Tech'}</span>
                          {c.shared && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ color: 'var(--purple, #6366F1)', border: '1px solid var(--purple, #6366F1)' }} title="Project shared with you">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                              Shared
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-mono font-medium" style={{ color: c.arr > 0 ? 'var(--teal)' : 'var(--text-dim)' }}>
                          {c.arr > 0 ? <AnimatedCounter value={Math.round(c.arr)} prefix="$" suffix=" ARR" fontSize={12} /> : 'Building...'}
                        </span>
                      </div>

                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Recent Activity</h2>
              {/* [2026-09-04] Même correctif que pour les projets : chargement
                  visible au lieu de « No activity yet » trompeur. */}
              {loadingTasks && tasks.length === 0 ? (
                <div className="space-y-1.5">
                  <SkeletonRow h={44} /><SkeletonRow h={44} /><SkeletonRow h={44} />
                </div>
              ) : tasks.length === 0 ? (
                <div className="p-4 rounded-xl text-sm" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)', color: 'var(--text-dim)' }}>
                  No activity yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {tasks.slice(0, 6).map(task => (
                    <div key={task.id} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>{timeAgo(task.createdAt)}</span>
                      </div>
                      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{task.title}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
