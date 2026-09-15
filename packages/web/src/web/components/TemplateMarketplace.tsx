import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface Template {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  industry: string;
  designSystem: string;
  pages: string;
  features: string;
  popularity: number;
  isPremium: number;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  all:             { label: 'All',          icon: '🎯' },
  restaurant:      { label: 'Restaurant',    icon: '🍽️' },
  saas:            { label: 'SaaS',          icon: '💻' },
  ecommerce:       { label: 'E-commerce',    icon: '🛒' },
  portfolio:       { label: 'Portfolio',      icon: '🎨' },
  agency:          { label: 'Agency',        icon: '🏢' },
  blog:            { label: 'Blog',          icon: '📝' },
  startup:         { label: 'Startup',       icon: '🚀' },
  'local-business':{ label: 'Local Business',icon: '📍' },
  fitness:         { label: 'Fitness',       icon: '💪' },
  'real-estate':   { label: 'Real Estate',    icon: '🏠' },
};

function TemplateCard({ template, onSelect, loading }: { template: Template; onSelect: (slug: string) => void; loading: boolean }) {
  const ds = JSON.parse(template.designSystem);
  const pages = JSON.parse(template.pages);
  const features = template.features ? JSON.parse(template.features) : [];
  const catInfo = CATEGORY_LABELS[template.category] || { label: template.category, icon: '📦' };

  return (
    <div
      className="group rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-1"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
    >
      {/* Preview Header — themed gradient with overlay for depth */}
      <div
        className="relative h-36 flex items-end p-4"
        style={{
          background: ds.backgroundColor,
        }}
      >
        {/* Gradient accent wash */}
        <div className="absolute inset-0" style={{
          background: `linear-gradient(135deg, ${ds.primaryColor}40 0%, ${ds.accentColor || ds.primaryColor}30 60%, ${ds.backgroundColor} 100%)`,
        }} />
        {/* Mini page mockup */}
        <div
          className="absolute top-3 right-3 w-20 h-28 rounded-md shadow-lg overflow-hidden"
          style={{ background: ds.backgroundColor, border: `1px solid ${ds.borderColor}` }}
        >
          <div className="h-3" style={{ background: ds.primaryColor, opacity: 0.8 }} />
          <div className="p-1.5 space-y-1">
            <div className="h-1.5 rounded-full" style={{ background: ds.textColor, width: '70%', opacity: 0.3 }} />
            <div className="h-1" style={{ background: ds.mutedTextColor, width: '90%', opacity: 0.2 }} />
            <div className="h-1" style={{ background: ds.mutedTextColor, width: '60%', opacity: 0.2 }} />
            <div className="h-6 rounded-sm mt-1" style={{ background: ds.primaryColor, opacity: 0.15 }} />
            <div className="flex gap-0.5 mt-1">
              <div className="h-4 flex-1 rounded-sm" style={{ background: ds.accentColor || ds.primaryColor, opacity: 0.2 }} />
              <div className="h-4 flex-1 rounded-sm" style={{ background: ds.accentColor || ds.primaryColor, opacity: 0.2 }} />
            </div>
          </div>
        </div>
        {/* Template name overlay */}
        <div className="relative z-10">
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: `${ds.primaryColor}25`, color: ds.textColor, border: `1px solid ${ds.borderColor}` }}>
            {catInfo.icon} {catInfo.label}
          </span>
          <h3 className="text-lg font-bold mt-1" style={{ color: ds.textColor, fontFamily: ds.headingFont }}>
            {template.name}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <p className="text-[12px] leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
          {template.description}
        </p>

        {/* Pages count + features */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>
            {pages.length} pages
          </span>
          {features.slice(0, 3).map((f: string, i: number) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}>
              {f}
            </span>
          ))}
          {features.length > 3 && (
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>+{features.length - 3}</span>
          )}
        </div>

        {/* Color palette preview */}
        <div className="flex items-center gap-1 mb-3">
          {[ds.primaryColor, ds.accentColor, ds.backgroundColor, ds.surfaceColor, ds.textColor].filter(Boolean).map((color: string, i: number) => (
            <div
              key={i}
              className="w-5 h-5 rounded-full"
              style={{ background: color, border: '1px solid var(--border-default)' }}
              title={color}
            />
          ))}
          <span className="text-[10px] ml-1" style={{ color: 'var(--text-dim)' }}>
            {ds.style}
          </span>
        </div>

        {/* Font info + AI refinement hint */}
        <div className="text-[10px] mb-2" style={{ color: 'var(--text-dim)' }}>
          <span style={{ fontFamily: ds.headingFont }}>{ds.headingFont?.replace(/'/g, '')}</span> + <span style={{ fontFamily: ds.fontFamily }}>{ds.fontFamily?.replace(/'/g, '')}</span>
        </div>
        <div className="text-[10px] mb-3 flex items-center gap-1" style={{ color: 'var(--text-dim)', opacity: 0.7 }}>
          <span>✨</span> Design tailored to your business by AI
        </div>

        {/* CTA */}
        <button
          onClick={() => onSelect(template.slug)}
          disabled={loading}
          className="w-full text-[12px] font-medium py-2 rounded-lg transition-all disabled:opacity-40"
          style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
        >
          {loading ? 'Building...' : 'Use this template →'}
        </button>
      </div>
    </div>
  );
}

export default function TemplateMarketplace({ companyId, onBuildStarted }: { companyId: string; onBuildStarted: (jobId: string) => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    setLoading(true);
    const res = await api.templates.list().catch(() => ({ templates: [] }));
    if (res.templates && res.templates.length > 0) {
      setTemplates(res.templates);
      setSeeded(true);
    } else {
      // Auto-seed on first load
      await api.templates.seed().catch(() => {});
      const res2 = await api.templates.list().catch(() => ({ templates: [] }));
      setTemplates(res2.templates || []);
      setSeeded(true);
    }
    setLoading(false);
  }

  async function handleSelect(slug: string) {
    setBuilding(slug);
    try {
      const res = await api.templates.buildFromTemplate(companyId, slug);
      if (res.jobId) {
        onBuildStarted(res.jobId);
      }
    } catch (e) {
      console.error('Template build failed:', e);
    }
    // Don't clear building — parent will handle polling and UI update
  }

  const filtered = activeCategory === 'all'
    ? templates
    : templates.filter(t => t.category === activeCategory);

  const categories = ['all', ...Array.from(new Set(templates.map(t => t.category)))];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--teal)' }} />
          <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>Loading templates...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          🎨 Template Marketplace
        </h2>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Choose a professional template. AI will adapt the design and content to your business.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
        {categories.map(cat => {
          const info = CATEGORY_LABELS[cat] || { label: cat, icon: '📦' };
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="text-[11px] px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              style={{
                background: activeCategory === cat ? 'var(--surface-5)' : 'var(--surface-2)',
                color: activeCategory === cat ? 'var(--text-primary)' : 'var(--text-dim)',
                border: activeCategory === cat ? '1px solid var(--border-strong)' : '1px solid transparent',
              }}
            >
              {info.icon} {info.label}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>No templates in this category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onSelect={handleSelect}
              loading={building === t.slug}
            />
          ))}
        </div>
      )}
    </div>
  );
}
