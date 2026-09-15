import type { Plugin } from "vite";

// Guard plugin: no matter what gets written to source files (manual edits,
// future scaffolds, template syncs, etc.), any RunableBadge import/usage is
// stripped out before Vite compiles/serves the code. This makes the removal
// of the "Made in Runable" badge permanent instead of a one-off edit.
export default function stripRunableBadgePlugin(): Plugin {
	return {
		name: "strip-runable-badge",
		enforce: "pre",
		transform(code, id) {
			if (!id.endsWith(".tsx") && !id.endsWith(".ts")) return null;
			if (!code.includes("RunableBadge")) return null;

			let out = code;

			// Remove `RunableBadge` from named imports, e.g.
			// import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
			out = out.replace(/([{,]\s*)RunableBadge\s*,?\s*/g, (_m, p1) => (p1 === "{" ? "{" : p1));
			// Clean up a leftover trailing comma before the closing brace: `{ AgentFeedback, }`
			out = out.replace(/,(\s*})/g, "$1");
			// If the import ends up with an empty named-import list, drop the whole import line.
			out = out.replace(/import\s*{\s*}\s*from\s*["'][^"']+["'];?\n?/g, "");

			// Remove any JSX usage: <RunableBadge />, <RunableBadge ... />, {<RunableBadge />}
			out = out.replace(/\{?\s*<RunableBadge[^>]*\/>\s*\}?/g, "");
			out = out.replace(/<RunableBadge[^>]*>[\s\S]*?<\/RunableBadge>/g, "");

			if (out === code) return null;
			return { code: out, map: null };
		},
	};
}
