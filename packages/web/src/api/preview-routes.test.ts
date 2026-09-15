import { describe, it, expect } from "vitest";
import {
  routeToSlug,
  slugToPreviewPath,
  markerPagesFromPlan,
} from "./builder/preview-routes";

describe("preview-routes: route ↔ slug ↔ preview path", () => {
  it("maps root route to 'index' slug", () => {
    expect(routeToSlug("/")).toBe("index");
    expect(routeToSlug("")).toBe("index");
  });

  it("strips leading/trailing slashes from routes", () => {
    expect(routeToSlug("/about")).toBe("about");
    expect(routeToSlug("/settings/")).toBe("settings");
  });

  it("builds preview paths under the Vite base", () => {
    expect(slugToPreviewPath("index")).toBe("/");
    expect(slugToPreviewPath("")).toBe("/");
    expect(slugToPreviewPath("about")).toBe("/about");
  });
});

describe("markerPagesFromPlan: one marker page per real app route", () => {
  it("creates a marker page for every static route (the editor 404/one-page bug)", () => {
    const pages = markerPagesFromPlan(
      [
        { route: "/", name: "Dashboard" },
        { route: "/settings", name: "Settings" },
        { route: "/reports", name: "Reports" },
      ],
      "My App",
    );
    expect(pages.map((p) => p.slug)).toEqual(["index", "settings", "reports"]);
    expect(pages).toHaveLength(3); // NOT one — this was the reported bug
    expect(pages[0].title).toBe("My App"); // index uses company name
    expect(pages[1].title).toBe("Settings");
    expect(pages.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it("skips dynamic routes that can't be previewed standalone", () => {
    const pages = markerPagesFromPlan(
      [
        { route: "/", name: "Home" },
        { route: "/item/:id", name: "Detail" },
      ],
      "App",
    );
    expect(pages.map((p) => p.slug)).toEqual(["index"]);
  });

  it("always guarantees an index page even when the plan omits '/'", () => {
    const pages = markerPagesFromPlan(
      [{ route: "/dashboard", name: "Dashboard" }],
      "App",
    );
    expect(pages[0].slug).toBe("index");
    expect(pages.some((p) => p.slug === "dashboard")).toBe(true);
  });

  it("de-dups routes that collapse to the same slug", () => {
    const pages = markerPagesFromPlan(
      [
        { route: "/", name: "Home" },
        { route: "/about", name: "About" },
        { route: "/about/", name: "About dup" },
      ],
      "App",
    );
    expect(pages.filter((p) => p.slug === "about")).toHaveLength(1);
  });

  it("falls back to a single index page for an empty plan", () => {
    expect(markerPagesFromPlan(undefined, "App").map((p) => p.slug)).toEqual([
      "index",
    ]);
    expect(markerPagesFromPlan([], "App").map((p) => p.slug)).toEqual(["index"]);
  });
});
