// ─── Crunchbase Company Researcher Agent — Deep company intelligence ─────────

import type { AgentConfig, CompanyContext, AgentResult } from "./types";

export interface CrunchbaseOutput {
  companyOverview?: {
    name: string;
    founded?: string;
    hq?: string;
    employeeCount?: string;
    categories?: string[];
    description?: string;
    website?: string;
    status?: string; // active, acquired, IPO, closed
  };
  fundingHistory?: {
    totalFunding?: string;
    rounds?: Array<{
      date: string;
      type: string; // Seed, Series A, etc.
      amount: string;
      leadInvestors?: string[];
    }>;
    lastRoundDate?: string;
    runwaySignal?: string;
  };
  keyPeople?: Array<{
    name: string;
    title: string;
    tenure?: string;
    notable?: string;
  }>;
  recentNews?: Array<{
    date?: string;
    headline: string;
    source?: string;
    significance?: string;
  }>;
  competitiveLandscape?: Array<{
    name: string;
    comparison: string;
    differentiator?: string;
  }>;
  acquisitions?: Array<{
    target: string;
    date?: string;
    amount?: string;
    purpose?: string;
  }>;
  buyingTriggers?: Array<{
    trigger: string;
    evidence: string;
    urgency: 'high' | 'medium' | 'low';
  }>;
  confidenceNotes?: string;
  fullReport?: string;
}

export const crunchbaseAgent: AgentConfig = {
  role: 'crunchbase' as any,
  name: 'Crunchbase Company Researcher',
  model: 'openai/gpt-5.4-mini',
  maxTokens: 4000,

  systemPrompt: (ctx: CompanyContext) => `You are the Crunchbase Company Researcher, a deep company intelligence agent that produces actionable research reports on any company.

## YOUR MISSION
When given a company name, domain, or URL — produce a comprehensive intelligence report covering:
1. **Company Overview**: founding date, HQ, employee count, categories/industries, description, website, status
2. **Funding History**: each round's date, type, amount, lead investors, total funding to date, runway signals
3. **Key People**: founders, C-suite, board members — with titles and tenure
4. **Recent News & Signals**: press mentions, activity signals, pivots, launches
5. **Acquisitions**: made and received, with amounts and purpose
6. **Competitive Landscape**: main competitors with comparison points
7. **Buying Triggers**: analyze recent funding (flush with capital), leadership changes (new CTO/CRO often re-tools), acquisitions (integration needs), rapid hiring, expansion into new categories

## CONTEXT
${ctx.name ? `Company/Brand: ${ctx.name}` : ''}
${ctx.idea ? `Business idea context: ${ctx.idea}` : ''}
${ctx.industry ? `Industry: ${ctx.industry}` : ''}
${ctx.research?.competitors ? `Known competitors: ${ctx.research.competitors.map(c => c.name).join(', ')}` : ''}

## IMPORTANT RULES
- Use REAL data you know about companies. Be factual.
- Never invent funding amounts, people, or news. If you don't know → say "Not available"
- Include dollar amounts, dates, and investor names when known
- End every report with "Confidence Notes" flagging fields where data is uncertain or sparse
- Be professional, concise, sales-intelligence oriented
- Help the user prepare for outreach, due diligence, or competitive analysis
- Respond in the SAME LANGUAGE as the user's request

## OUTPUT FORMAT
Respond with structured JSON inside \`\`\`json ... \`\`\`:
{
  "companyOverview": {
    "name": "Company Name",
    "founded": "YYYY",
    "hq": "City, Country",
    "employeeCount": "~XXX",
    "categories": ["SaaS", "AI"],
    "description": "Brief description",
    "website": "https://...",
    "status": "active"
  },
  "fundingHistory": {
    "totalFunding": "$XXM",
    "rounds": [
      { "date": "YYYY-MM", "type": "Series A", "amount": "$XXM", "leadInvestors": ["Investor1"] }
    ],
    "lastRoundDate": "YYYY-MM",
    "runwaySignal": "Assessment of financial runway"
  },
  "keyPeople": [
    { "name": "Name", "title": "CEO", "tenure": "Since YYYY", "notable": "Previously at X" }
  ],
  "recentNews": [
    { "date": "YYYY-MM", "headline": "...", "source": "TechCrunch", "significance": "..." }
  ],
  "competitiveLandscape": [
    { "name": "Competitor", "comparison": "How they compare", "differentiator": "Key difference" }
  ],
  "acquisitions": [
    { "target": "Company", "date": "YYYY", "amount": "$XXM", "purpose": "..." }
  ],
  "buyingTriggers": [
    { "trigger": "Recent Series B", "evidence": "$50M raised in Q1 2026", "urgency": "high" }
  ],
  "confidenceNotes": "Flags about data quality/availability",
  "fullReport": "Complete markdown report with all sections formatted nicely with headers, tables, and bullets"
}`,

  parseOutput: (raw: string, ctx: CompanyContext): AgentResult => {
    let data: Record<string, any> = {};

    // Try to extract JSON
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        data = { crunchbase: parsed };
      } catch {
        data = { crunchbase: { fullReport: raw } };
      }
    } else {
      data = { crunchbase: { fullReport: raw } };
    }

    // Build a readable response from the structured data
    const cb = data.crunchbase as CrunchbaseOutput;
    let response = cb?.fullReport || raw;

    // If we got structured data but no fullReport, generate one
    if (cb && !cb.fullReport && cb.companyOverview) {
      const sections: string[] = [];
      const ov = cb.companyOverview;
      sections.push(`# ${ov.name} — Company Intelligence Report`);
      sections.push('');
      sections.push('## Company Overview');
      sections.push(`- **Founded:** ${ov.founded || 'N/A'}`);
      sections.push(`- **HQ:** ${ov.hq || 'N/A'}`);
      sections.push(`- **Employees:** ${ov.employeeCount || 'N/A'}`);
      sections.push(`- **Website:** ${ov.website || 'N/A'}`);
      sections.push(`- **Status:** ${ov.status || 'N/A'}`);
      if (ov.categories?.length) sections.push(`- **Categories:** ${ov.categories.join(', ')}`);
      if (ov.description) sections.push(`\n${ov.description}`);

      if (cb.fundingHistory) {
        sections.push('');
        sections.push('## Funding History');
        sections.push(`**Total Funding:** ${cb.fundingHistory.totalFunding || 'N/A'}`);
        if (cb.fundingHistory.rounds?.length) {
          sections.push('');
          sections.push('| Date | Type | Amount | Lead Investors |');
          sections.push('|------|------|--------|----------------|');
          for (const r of cb.fundingHistory.rounds) {
            sections.push(`| ${r.date} | ${r.type} | ${r.amount} | ${r.leadInvestors?.join(', ') || 'N/A'} |`);
          }
        }
        if (cb.fundingHistory.runwaySignal) sections.push(`\n**Runway Signal:** ${cb.fundingHistory.runwaySignal}`);
      }

      if (cb.keyPeople?.length) {
        sections.push('');
        sections.push('## Key People');
        for (const p of cb.keyPeople) {
          sections.push(`- **${p.name}** — ${p.title}${p.tenure ? ` (${p.tenure})` : ''}${p.notable ? ` — ${p.notable}` : ''}`);
        }
      }

      if (cb.recentNews?.length) {
        sections.push('');
        sections.push('## Recent News & Signals');
        for (const n of cb.recentNews) {
          sections.push(`- ${n.date ? `[${n.date}] ` : ''}**${n.headline}**${n.source ? ` — ${n.source}` : ''}${n.significance ? ` → ${n.significance}` : ''}`);
        }
      }

      if (cb.competitiveLandscape?.length) {
        sections.push('');
        sections.push('## Competitive Landscape');
        for (const c of cb.competitiveLandscape) {
          sections.push(`- **${c.name}**: ${c.comparison}${c.differentiator ? ` | ${c.differentiator}` : ''}`);
        }
      }

      if (cb.acquisitions?.length) {
        sections.push('');
        sections.push('## Acquisitions');
        for (const a of cb.acquisitions) {
          sections.push(`- **${a.target}**${a.date ? ` (${a.date})` : ''}${a.amount ? ` — ${a.amount}` : ''}: ${a.purpose || ''}`);
        }
      }

      if (cb.buyingTriggers?.length) {
        sections.push('');
        sections.push('## 🎯 Buying Triggers');
        for (const t of cb.buyingTriggers) {
          const icon = t.urgency === 'high' ? '🔴' : t.urgency === 'medium' ? '🟡' : '🟢';
          sections.push(`- ${icon} **${t.trigger}** — ${t.evidence}`);
        }
      }

      if (cb.confidenceNotes) {
        sections.push('');
        sections.push(`---\n**Confidence Notes:** ${cb.confidenceNotes}`);
      }

      response = sections.join('\n');
    }

    return {
      response,
      data,
      skillUpdates: [],
    };
  }
};
