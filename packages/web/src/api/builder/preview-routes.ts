// Shared helpers mapping React app routes ↔ websitePages slugs ↔ preview URLs.
// Used by the build pipeline (to create one marker page per real route so the
// editor + page picker list every page) and by the public serve redirect.

export function routeToSlug(route: string): string {
  if (!route || route === "/") return "index";
  return route.replace(/^\//, "").replace(/\/$/, "");
}

export function slugToPreviewPath(slug: string): string {
  return !slug || slug === "index" ? "/" : `/${slug}`;
}

/**
 * Derive the marker pages for a React app from its plan pages.
 * - Skips dynamic routes (containing ":") — they can't be previewed standalone.
 * - Always guarantees an "index" page for "/".
 * - De-dups by slug, preserving first occurrence order.
 */
export function markerPagesFromPlan(
  planPages: Array<{ route?: string; name?: string }> | undefined,
  fallbackTitle: string,
): Array<{ slug: string; title: string; sortOrder: number }> {
  const routes: Array<{ route: string; name: string }> = (planPages || [])
    .filter((p) => typeof p?.route === "string" && !p.route!.includes(":"))
    .map((p) => ({ route: p.route as string, name: p.name || (p.route as string) }));
  if (!routes.some((r) => r.route === "/")) routes.unshift({ route: "/", name: fallbackTitle });

  const seen = new Set<string>();
  const out: Array<{ slug: string; title: string; sortOrder: number }> = [];
  let order = 0;
  for (const r of routes) {
    const slug = routeToSlug(r.route);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, title: slug === "index" ? fallbackTitle : r.name, sortOrder: order++ });
  }
  return out;
}
