// ─── API Designer Agent — REST & GraphQL architecture specialist ─────────────

import type { AgentConfig, CompanyContext, AgentResult } from "./types";

export const apiDesignerAgent: AgentConfig = {
  role: 'api_designer' as any,
  name: 'API Designer',
  model: 'openai/gpt-5.4-mini',
  maxTokens: 4000,

  systemPrompt: (ctx: CompanyContext) => `You are a senior API designer specializing in REST and GraphQL architectures. When given a task, analyze business domain models and client requirements, then design APIs following API-first principles: resource-oriented architecture, proper HTTP semantics, consistent naming, and comprehensive OpenAPI 3.1 specifications.

Cover authentication patterns (OAuth 2.0, JWT, API keys), versioning strategies (URI, header, content-type), pagination (cursor, page-based, limit/offset), webhooks, bulk operations, and error handling with consistent formats and actionable messages. Optimize for developer experience — generate request/response examples, error catalogs, and SDK guidance.

For GraphQL, address type system design, query complexity, mutation patterns, subscriptions, and federation. Always ensure backward compatibility, define deprecation policies, and include rate limiting and cache control headers. Deliver complete OpenAPI specs, Postman collections, and migration guides.

## COMPANY CONTEXT
${ctx.name ? `- Company/Product: ${ctx.name}` : ''}
${ctx.idea ? `- Business idea: ${ctx.idea}` : ''}
${ctx.industry ? `- Industry: ${ctx.industry}` : ''}
${ctx.targetAudience ? `- Target audience: ${ctx.targetAudience}` : ''}
${ctx.products ? `- Products/Services: ${ctx.products}` : ''}
${(ctx as any).research?.fullReport ? `- Market context: ${(ctx as any).research.fullReport.slice(0, 500)}` : ''}
${(ctx as any).businessPlan?.businessModel ? `- Business model: ${(ctx as any).businessPlan.businessModel}` : ''}

## OUTPUT FORMAT
Respond with structured JSON inside \`\`\`json ... \`\`\`:
{
  "apiStyle": "REST" | "GraphQL" | "hybrid",
  "baseUrl": "/api/v1",
  "authentication": {
    "primary": "OAuth 2.0 / JWT / API Key",
    "flows": ["authorization_code", "client_credentials"],
    "tokenEndpoint": "/auth/token",
    "notes": "Implementation details"
  },
  "versioning": {
    "strategy": "URI / Header / Content-Type",
    "current": "v1",
    "deprecationPolicy": "..."
  },
  "resources": [
    {
      "name": "Resource Name",
      "path": "/resource",
      "description": "What this resource represents",
      "endpoints": [
        {
          "method": "GET|POST|PUT|PATCH|DELETE",
          "path": "/resource/:id",
          "description": "What it does",
          "auth": "required|optional|public",
          "requestBody": "{ ... } or null",
          "responseExample": "{ ... }",
          "errorCodes": ["400", "404"]
        }
      ]
    }
  ],
  "pagination": {
    "strategy": "cursor|page|offset",
    "params": "Details",
    "example": "GET /resource?cursor=abc&limit=20"
  },
  "errorFormat": {
    "structure": "{ error: { code, message, details } }",
    "catalog": [
      { "code": "RESOURCE_NOT_FOUND", "status": 404, "message": "..." }
    ]
  },
  "webhooks": [
    { "event": "resource.created", "payload": "{ ... }", "retryPolicy": "..." }
  ],
  "rateLimiting": {
    "strategy": "token bucket / sliding window",
    "limits": "100 req/min default",
    "headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset"
  },
  "caching": {
    "strategy": "ETags / Last-Modified / Cache-Control",
    "details": "..."
  },
  "sdkGuidance": "Recommendations for client SDK generation",
  "openApiSpec": "Complete OpenAPI 3.1 YAML (abbreviated if very long)",
  "fullReport": "Complete markdown report with all sections"
}

## RULES
- Design for the SPECIFIC business described — not generic APIs
- Include REAL endpoint examples with request/response bodies
- Consider mobile clients, web clients, and third-party integrations
- Follow REST best practices: plural nouns, proper HTTP verbs, HATEOAS where useful
- Respond in the SAME LANGUAGE as the user's request`,

  parseOutput: (raw: string, ctx: CompanyContext): AgentResult => {
    let data: Record<string, any> = {};

    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        data = { apiDesign: parsed };
      } catch {
        data = { apiDesign: { fullReport: raw } };
      }
    } else {
      data = { apiDesign: { fullReport: raw } };
    }

    const api = data.apiDesign;
    let response = api?.fullReport || raw;

    // Generate readable report if structured data but no fullReport
    if (api && !api.fullReport && api.resources) {
      const s: string[] = [];
      s.push(`# API Architecture — ${ctx.name || 'Project'}`);
      s.push('');

      if (api.apiStyle) s.push(`**Style:** ${api.apiStyle} | **Base URL:** ${api.baseUrl || '/api/v1'}`);
      s.push('');

      if (api.authentication) {
        s.push('## Authentication');
        s.push(`- **Method:** ${api.authentication.primary}`);
        if (api.authentication.flows) s.push(`- **Flows:** ${api.authentication.flows.join(', ')}`);
        if (api.authentication.notes) s.push(`- ${api.authentication.notes}`);
        s.push('');
      }

      if (api.versioning) {
        s.push('## Versioning');
        s.push(`- **Strategy:** ${api.versioning.strategy} (current: ${api.versioning.current})`);
        if (api.versioning.deprecationPolicy) s.push(`- **Deprecation:** ${api.versioning.deprecationPolicy}`);
        s.push('');
      }

      if (api.resources?.length) {
        s.push('## API Resources');
        for (const res of api.resources) {
          s.push(`### ${res.name} \`${res.path}\``);
          if (res.description) s.push(res.description);
          s.push('');
          if (res.endpoints?.length) {
            s.push('| Method | Path | Auth | Description |');
            s.push('|--------|------|------|-------------|');
            for (const ep of res.endpoints) {
              s.push(`| \`${ep.method}\` | \`${ep.path}\` | ${ep.auth || '-'} | ${ep.description} |`);
            }
            s.push('');
          }
        }
      }

      if (api.pagination) {
        s.push('## Pagination');
        s.push(`**Strategy:** ${api.pagination.strategy}`);
        if (api.pagination.example) s.push(`**Example:** \`${api.pagination.example}\``);
        s.push('');
      }

      if (api.errorFormat) {
        s.push('## Error Handling');
        s.push(`**Format:** \`${api.errorFormat.structure}\``);
        if (api.errorFormat.catalog?.length) {
          s.push('');
          s.push('| Code | Status | Message |');
          s.push('|------|--------|---------|');
          for (const e of api.errorFormat.catalog) {
            s.push(`| \`${e.code}\` | ${e.status} | ${e.message} |`);
          }
        }
        s.push('');
      }

      if (api.webhooks?.length) {
        s.push('## Webhooks');
        for (const w of api.webhooks) {
          s.push(`- **${w.event}** — ${w.retryPolicy || ''}`);
        }
        s.push('');
      }

      if (api.rateLimiting) {
        s.push('## Rate Limiting');
        s.push(`- **Strategy:** ${api.rateLimiting.strategy}`);
        s.push(`- **Limits:** ${api.rateLimiting.limits}`);
        s.push(`- **Headers:** ${api.rateLimiting.headers}`);
        s.push('');
      }

      if (api.sdkGuidance) {
        s.push('## SDK Guidance');
        s.push(api.sdkGuidance);
      }

      response = s.join('\n');
    }

    return {
      response,
      data,
      skillUpdates: [],
    };
  }
};
