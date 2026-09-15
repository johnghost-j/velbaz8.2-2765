import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { CommunityDashboard } from '../components/CommunityDashboard';
import { useSidebar } from '../lib/sidebar';
import { Link } from 'wouter';

export default function CommunityPage() {
  const { user } = useAuth();
  const { projects } = useSidebar();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].id);
    }
  }, [projects, selectedProject]);

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center p-10 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
          <p className="text-sm mb-3" style={{ color: 'var(--text-dim)' }}>Sign in to access Community</p>
          <Link href="/login">
            <button className="px-4 py-2 rounded-lg text-[12px] font-medium" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>Sign In</button>
          </Link>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center p-10 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}>
          <p className="text-sm mb-2" style={{ color: 'var(--text-dim)' }}>No projects yet</p>
          <p className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>Create a project first, then manage its community here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      {/* Header with project selector */}
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-secondary)' }}>Community Hub</h1>
        <select
          value={selectedProject || ''}
          onChange={e => setSelectedProject(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium outline-none"
          style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {selectedProject && <CommunityDashboard companyId={selectedProject} />}
    </div>
  );
}
