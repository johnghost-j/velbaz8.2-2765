/**
 * CommunityDashboard — Full community & social AI management
 * Tabs: Overview, Feed, Posts, Marketplace, Analytics
 */

import { useState, useEffect, useCallback } from 'react';
import { SocialConnectPopup } from './SocialConnectPopup';

interface Connection { id: string; platform: string; platformUsername: string; isActive: number; }
interface Post { id: string; platform: string; content: string; contentType: string; status: string; finalScore: number; platformPostUrl?: string; publishedAt?: string; createdAt: string; }
interface FeedItem { type: string; timestamp: any; data: any; }
interface Analytics { connectedPlatforms: string[]; totalPosts: number; publishedPosts: number; totalImpressions: number; totalEngagements: number; avgScore: number; byPlatform: Record<string, any>; sentimentBreakdown: { positive: number; neutral: number; negative: number }; totalInteractions: number; }
interface Listing { id: string; title: string; description: string; category: string; price: number; currency: string; status: string; views: number; sales: number; createdAt: string; }

const PLATFORM_COLORS: Record<string, string> = { twitter: '#000', discord: '#5865F2', reddit: '#FF4500', instagram: '#E4405F' };
const PLATFORM_NAMES: Record<string, string> = { twitter: 'Twitter/X', discord: 'Discord', reddit: 'Reddit', instagram: 'Instagram' };
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'rgba(156,163,175,0.15)', text: '#9ca3af' },
  approved: { bg: 'rgba(16,185,129,0.15)', text: '#10b981' },
  rejected: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
  published: { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6' },
  scheduled: { bg: 'rgba(168,85,247,0.15)', text: '#a855f7' },
  failed: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
};

export function CommunityDashboard({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<'overview' | 'feed' | 'posts' | 'marketplace' | 'analytics'>('overview');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genPlatform, setGenPlatform] = useState('');
  const [genPrompt, setGenPrompt] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showConnectPopup, setShowConnectPopup] = useState(false);
  const [showAddListing, setShowAddListing] = useState(false);
  const [newListing, setNewListing] = useState({ title: '', description: '', category: 'product', price: 0 });

  const load = useCallback(async () => {
    const [connRes, postsRes, feedRes, analyticsRes, listingsRes] = await Promise.all([
      fetch(`/api/companies/${companyId}/social/connections`).then(r => r.json()),
      fetch(`/api/companies/${companyId}/social/posts`).then(r => r.json()),
      fetch(`/api/companies/${companyId}/social/feed`).then(r => r.json()),
      fetch(`/api/companies/${companyId}/social/analytics`).then(r => r.json()),
      fetch(`/api/companies/${companyId}/marketplace`).then(r => r.json()),
    ]);
    setConnections(connRes as Connection[]);
    setPosts(postsRes as Post[]);
    setFeed(feedRes as FeedItem[]);
    setAnalytics(analyticsRes as Analytics);
    setListings(listingsRes as Listing[]);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh feed every 10s
  useEffect(() => {
    const interval = setInterval(async () => {
      const feedRes = await fetch(`/api/companies/${companyId}/social/feed`).then(r => r.json());
      setFeed(feedRes as FeedItem[]);
    }, 10000);
    return () => clearInterval(interval);
  }, [companyId]);

  const generateContent = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/social/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: genPlatform || undefined, prompt: genPrompt || undefined }),
      });
      await res.json();
      await load();
      setShowGenerate(false);
      setGenPrompt('');
    } finally { setGenerating(false); }
  };

  const approvePost = async (postId: string) => {
    await fetch(`/api/companies/${companyId}/social/posts/${postId}/approve`, { method: 'POST' });
    await load();
  };

  const rejectPost = async (postId: string) => {
    await fetch(`/api/companies/${companyId}/social/posts/${postId}/reject`, { method: 'POST' });
    await load();
  };

  const publishPost = async (postId: string) => {
    await fetch(`/api/companies/${companyId}/social/posts/${postId}/publish`, { method: 'POST' });
    await load();
  };

  const connectPlatform = async (platform: string) => {
    const res = await fetch(`/api/companies/${companyId}/social/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // L'origine réelle du navigateur : le proxy réécrit Host/Origin côté serveur,
      // donc c'est le seul moyen fiable de faire revenir la popup OAuth ici.
      body: JSON.stringify({ platform, origin: window.location.origin }),
    });
    const data = await res.json() as { authUrl: string };
    window.open(data.authUrl, `oauth_${platform}`, 'width=600,height=700');
  };

  const createListing = async () => {
    await fetch(`/api/companies/${companyId}/marketplace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newListing),
    });
    await load();
    setShowAddListing(false);
    setNewListing({ title: '', description: '', category: 'product', price: 0 });
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'feed', label: 'Live Feed' },
    { id: 'posts', label: 'Posts' },
    { id: 'marketplace', label: 'Marketplace' },
    { id: 'analytics', label: 'Analytics' },
  ] as const;

  const activeConns = connections.filter(c => c.isActive);

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
            style={{
              background: tab === t.id ? 'var(--surface-4)' : 'transparent',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-ghost)',
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setShowConnectPopup(true)}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--surface-4)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
        >
          Connect Platforms
        </button>
        <button
          onClick={() => setShowGenerate(true)}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium ml-2"
          style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
        >
          + Generate Content
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── Overview Tab ── */}
        {tab === 'overview' && (
          <>
            {/* Connected Platforms */}
            <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Connected Platforms</h3>
              <div className="grid grid-cols-2 gap-2">
                {['twitter', 'discord', 'reddit', 'instagram'].map(p => {
                  const conn = activeConns.find(c => c.platform === p);
                  return (
                    <div key={p} className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface-3)' }}>
                      <div className="w-2 h-2 rounded-full" style={{ background: conn ? '#10b981' : 'var(--text-ghost)' }}/>
                      <span className="text-[12px] flex-1" style={{ color: conn ? 'var(--text-primary)' : 'var(--text-ghost)' }}>
                        {PLATFORM_NAMES[p]}
                      </span>
                      {conn ? (
                        <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>@{conn.platformUsername}</span>
                      ) : (
                        <button onClick={() => connectPlatform(p)} className="text-[10px] font-medium px-2 py-0.5 rounded"
                          style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
                          Connect
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stats */}
            {analytics && (
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Total Posts', value: analytics.totalPosts },
                  { label: 'Published', value: analytics.publishedPosts },
                  { label: 'Impressions', value: analytics.totalImpressions },
                  { label: 'Engagements', value: analytics.totalEngagements },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{s.value}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent posts */}
            <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Recent Posts</h3>
              {posts.length === 0 ? (
                <p className="text-[12px] text-center py-6" style={{ color: 'var(--text-ghost)' }}>No posts yet. Generate your first content!</p>
              ) : (
                <div className="space-y-2">
                  {posts.slice(0, 5).map(p => (
                    <PostCard key={p.id} post={p} onApprove={approvePost} onReject={rejectPost} onPublish={publishPost} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Live Feed Tab ── */}
        {tab === 'feed' && (
          <div className="space-y-2">
            {feed.length === 0 ? (
              <p className="text-[12px] text-center py-12" style={{ color: 'var(--text-ghost)' }}>No activity yet. Generate content to see the AI brains in action!</p>
            ) : feed.map((item, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold"
                  style={{
                    background: item.type === 'brain' ? 'rgba(168,85,247,0.15)' : item.type === 'post' ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)',
                    color: item.type === 'brain' ? '#a855f7' : item.type === 'post' ? '#3b82f6' : '#10b981',
                  }}>
                  {item.type === 'brain' ? '🧠' : item.type === 'post' ? '📝' : '💬'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                    {item.type === 'brain' && `Brain: ${item.data.brain} — Score: ${item.data.score}/10`}
                    {item.type === 'post' && `${item.data.platform} post — ${item.data.status}`}
                    {item.type === 'interaction' && `Interaction from @${item.data.authorUsername}`}
                  </div>
                  <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-ghost)' }}>
                    {item.type === 'brain' && `Duration: ${item.data.duration}ms`}
                    {item.type === 'post' && item.data.content?.slice(0, 100)}
                    {item.type === 'interaction' && item.data.content?.slice(0, 100)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Posts Tab ── */}
        {tab === 'posts' && (
          <div className="space-y-2">
            {posts.map(p => (
              <PostCard key={p.id} post={p} onApprove={approvePost} onReject={rejectPost} onPublish={publishPost} expanded />
            ))}
            {posts.length === 0 && (
              <p className="text-[12px] text-center py-12" style={{ color: 'var(--text-ghost)' }}>No posts generated yet.</p>
            )}
          </div>
        )}

        {/* ── Marketplace Tab ── */}
        {tab === 'marketplace' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Your Listings</h3>
              <button onClick={() => setShowAddListing(true)} className="text-[12px] font-medium px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>
                + New Listing
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {listings.map(l => (
                <div key={l.id} className="rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                  <h4 className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{l.title}</h4>
                  <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--text-ghost)' }}>{l.description}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[14px] font-bold" style={{ color: 'var(--teal)' }}>{l.currency} {l.price}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-4)', color: 'var(--text-ghost)' }}>
                      {l.views} views · {l.sales} sales
                    </span>
                  </div>
                </div>
              ))}
              {listings.length === 0 && (
                <p className="col-span-2 text-[12px] text-center py-12" style={{ color: 'var(--text-ghost)' }}>No listings yet.</p>
              )}
            </div>

            {/* Add listing form */}
            {showAddListing && (
              <div className="rounded-xl p-4 mt-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}>
                <h4 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>New Listing</h4>
                <div className="space-y-2">
                  <input value={newListing.title} onChange={e => setNewListing(p => ({ ...p, title: e.target.value }))}
                    placeholder="Title" className="w-full px-3 py-2 rounded-lg text-[12px]"
                    style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }} />
                  <textarea value={newListing.description} onChange={e => setNewListing(p => ({ ...p, description: e.target.value }))}
                    placeholder="Description" rows={3} className="w-full px-3 py-2 rounded-lg text-[12px] resize-none"
                    style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }} />
                  <div className="flex gap-2">
                    <select value={newListing.category} onChange={e => setNewListing(p => ({ ...p, category: e.target.value }))}
                      className="flex-1 px-3 py-2 rounded-lg text-[12px]"
                      style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}>
                      <option value="product">Product</option>
                      <option value="service">Service</option>
                      <option value="template">Template</option>
                      <option value="course">Course</option>
                      <option value="consulting">Consulting</option>
                    </select>
                    <input type="number" value={newListing.price} onChange={e => setNewListing(p => ({ ...p, price: Number(e.target.value) }))}
                      placeholder="Price (EUR)" className="w-32 px-3 py-2 rounded-lg text-[12px]"
                      style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }} />
                  </div>
                  <div className="flex gap-2 justify-end mt-2">
                    <button onClick={() => setShowAddListing(false)} className="text-[12px] px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-ghost)' }}>Cancel</button>
                    <button onClick={createListing} className="text-[12px] font-medium px-4 py-1.5 rounded-lg" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}>Create</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Analytics Tab ── */}
        {tab === 'analytics' && analytics && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Avg AI Score" value={`${analytics.avgScore}/10`} />
              <StatCard label="Total Interactions" value={analytics.totalInteractions} />
              <StatCard label="Platforms" value={analytics.connectedPlatforms.length} />
            </div>

            {/* Sentiment */}
            <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
              <h4 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Sentiment Analysis</h4>
              <div className="flex gap-4">
                {(['positive', 'neutral', 'negative'] as const).map(s => {
                  const count = analytics.sentimentBreakdown[s];
                  const total = analytics.sentimentBreakdown.positive + analytics.sentimentBreakdown.neutral + analytics.sentimentBreakdown.negative;
                  const pct = total > 0 ? Math.round(count / total * 100) : 0;
                  const colors = { positive: '#10b981', neutral: '#6b7280', negative: '#ef4444' };
                  return (
                    <div key={s} className="flex-1 text-center">
                      <div className="text-[20px] font-bold" style={{ color: colors[s] }}>{pct}%</div>
                      <div className="text-[10px] capitalize" style={{ color: 'var(--text-ghost)' }}>{s}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By Platform */}
            <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
              <h4 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>By Platform</h4>
              <div className="space-y-2">
                {Object.entries(analytics.byPlatform).map(([p, stats]) => (
                  <div key={p} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-3)' }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: PLATFORM_COLORS[p] || '#666' }}/>
                    <span className="text-[12px] font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{PLATFORM_NAMES[p] || p}</span>
                    <span className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>{stats.posts} posts</span>
                    <span className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>{stats.published} published</span>
                  </div>
                ))}
                {Object.keys(analytics.byPlatform).length === 0 && (
                  <p className="text-[12px] text-center py-4" style={{ color: 'var(--text-ghost)' }}>No data yet</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Generate Content Modal */}
      {showConnectPopup && (
        <SocialConnectPopup
          companyId={companyId}
          companyName=""
          open={showConnectPopup}
          onClose={() => { setShowConnectPopup(false); load(); }}
          onComplete={() => { setShowConnectPopup(false); load(); }}
        />
      )}

      {showGenerate && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget && !generating) setShowGenerate(false); }}>
          <div className="rounded-2xl p-6 w-full max-w-md shadow-2xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
            <h3 className="text-[15px] font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              🧠 Generate Content — 6 AI Brains
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--text-ghost)' }}>Platform (optional)</label>
                <select value={genPlatform} onChange={e => setGenPlatform(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-[12px]"
                  style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}>
                  <option value="">Auto (AI decides)</option>
                  <option value="twitter">Twitter/X</option>
                  <option value="discord">Discord</option>
                  <option value="reddit">Reddit</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--text-ghost)' }}>Custom prompt (optional)</label>
                <textarea value={genPrompt} onChange={e => setGenPrompt(e.target.value)}
                  placeholder="E.g., Write a tweet about our new feature launch..."
                  rows={3} className="w-full px-3 py-2 rounded-lg text-[12px] resize-none"
                  style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }} />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowGenerate(false)} disabled={generating}
                className="text-[12px] px-4 py-2 rounded-lg" style={{ color: 'var(--text-ghost)' }}>Cancel</button>
              <button onClick={generateContent} disabled={generating}
                className="text-[12px] font-medium px-5 py-2 rounded-lg flex items-center gap-2"
                style={{ background: generating ? 'var(--surface-4)' : 'var(--btn-primary-bg)', color: generating ? 'var(--text-ghost)' : 'var(--btn-primary-fg)' }}>
                {generating && <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }}/>}
                {generating ? 'Brains working...' : 'Generate'}
              </button>
            </div>
            {generating && (
              <div className="mt-4 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
                Pipeline: Strategist → Writer → Tone Check → Fact Check → Anti-Spam → Final Approval
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onApprove, onReject, onPublish, expanded }: { post: Post; onApprove: (id: string) => void; onReject: (id: string) => void; onPublish: (id: string) => void; expanded?: boolean }) {
  const sc = STATUS_COLORS[post.status] || STATUS_COLORS.draft;
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface-3)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full" style={{ background: PLATFORM_COLORS[post.platform] || '#666' }}/>
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{PLATFORM_NAMES[post.platform] || post.platform}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.text }}>{post.status}</span>
        {post.finalScore > 0 && <span className="text-[10px] ml-auto" style={{ color: 'var(--text-ghost)' }}>Score: {post.finalScore}/10</span>}
      </div>
      <p className={`text-[12px] leading-relaxed ${expanded ? '' : 'line-clamp-3'}`} style={{ color: 'var(--text-primary)' }}>
        {post.content}
      </p>
      {(post.status === 'draft' || post.status === 'approved') && (
        <div className="flex gap-1.5 mt-2">
          {post.status === 'draft' && (
            <>
              <button onClick={() => onApprove(post.id)} className="text-[10px] font-medium px-2.5 py-1 rounded-md" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>Approve</button>
              <button onClick={() => onReject(post.id)} className="text-[10px] font-medium px-2.5 py-1 rounded-md" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>Reject</button>
            </>
          )}
          {post.status === 'approved' && (
            <button onClick={() => onPublish(post.id)} className="text-[10px] font-medium px-2.5 py-1 rounded-md" style={{ background: 'var(--surface-4)', color: 'var(--text-primary)' }}>Publish Now</button>
          )}
        </div>
      )}
      {post.platformPostUrl && (
        <a href={post.platformPostUrl} target="_blank" rel="noopener" className="text-[10px] mt-1 inline-block" style={{ color: 'var(--teal)' }}>View post ↗</a>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
      <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{label}</div>
    </div>
  );
}
