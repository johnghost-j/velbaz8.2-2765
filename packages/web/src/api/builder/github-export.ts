/**
 * GitHub Export
 * -------------
 * Exports a Velbaz project (all its persisted `projectFiles`) to GitHub as a
 * PRIVATE repository, in a single commit, using the GitHub Git Data API.
 *
 * Configuration (the system is fully implemented and only WAITS for the key):
 *   - GITHUB_TOKEN  (required)  A GitHub Personal Access Token with the `repo`
 *                              scope (classic) or "Contents: Read and write" +
 *                              "Administration: Read and write" (fine-grained).
 *                              Without it, export returns { error: "github_not_configured" }.
 *   - GITHUB_OWNER  (optional) Create the repo under this org/user instead of
 *                              the token owner's personal account.
 *
 * Nothing else is needed — as soon as GITHUB_TOKEN is present in the env, the
 * "Export to GitHub" button works end-to-end.
 */

const GH_API = "https://api.github.com";

import { getSecret } from '../secret-store';

export type ExportFile = { path: string; content: string };

export type ExportResult =
  | { ok: true; repoUrl: string; repoFullName: string; branch: string; created: boolean; fileCount: number }
  | { ok: false; error: string; detail?: string };

/** Whether a GitHub token is configured. UI uses this to know if it can export. */
export function isGithubConfigured(): boolean {
  return !!(getSecret('GITHUB_TOKEN') && getSecret('GITHUB_TOKEN').trim());
}

/** Turn any project name into a valid GitHub repo slug. */
export function toRepoName(name: string): string {
  const slug = (name || "velbaz-project")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")        // strip accents
    .replace(/[^a-z0-9._-]+/g, "-")          // valid chars only
    .replace(/^-+|-+$/g, "")                 // trim dashes
    .replace(/-{2,}/g, "-")                  // collapse dashes
    .slice(0, 90);
  return slug || "velbaz-project";
}

async function gh(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "Velbaz-Exporter",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

/**
 * Export the given files to a private GitHub repository named `repoName`.
 * Creates the repo if it doesn't exist, then pushes all files as one commit on
 * `main` (force-updating if the repo already had content). Returns the repo URL.
 */
export async function exportToGithub(
  repoName: string,
  files: ExportFile[],
  opts: { description?: string; commitMessage?: string } = {},
): Promise<ExportResult> {
  const token = (getSecret('GITHUB_TOKEN') || "").trim();
  if (!token) return { ok: false, error: "github_not_configured" };

  const cleanFiles = files.filter((f) => f && f.path && typeof f.content === "string");
  if (cleanFiles.length === 0) return { ok: false, error: "no_files" };

  // 1) Resolve owner (org from env, else the token's user).
  let owner = (getSecret('GITHUB_OWNER') || "").trim();
  if (!owner) {
    const me = await gh(token, "GET", "/user");
    if (me.status === 401) return { ok: false, error: "github_bad_token", detail: "Token rejected (401)." };
    if (me.status >= 400 || !me.json?.login) {
      return { ok: false, error: "github_error", detail: `GET /user → ${me.status}` };
    }
    owner = me.json.login;
  }

  const repo = toRepoName(repoName);
  const branch = "main";

  // 2) Ensure the repo exists (private). Create it if missing.
  let created = false;
  const existing = await gh(token, "GET", `/repos/${owner}/${repo}`);
  if (existing.status === 404) {
    // Create under org if GITHUB_OWNER is an org, else under the authed user.
    const createUnderOrg = !!(getSecret('GITHUB_OWNER') || "").trim();
    const createPath = createUnderOrg ? `/orgs/${owner}/repos` : `/user/repos`;
    const create = await gh(token, "POST", createPath, {
      name: repo,
      private: true,               // ← always a PRIVATE repository
      description: opts.description || "Exported from Velbaz",
      auto_init: false,
    });
    if (create.status >= 400) {
      return {
        ok: false,
        error: "github_create_failed",
        detail: `POST ${createPath} → ${create.status} ${create.json?.message || ""}`.trim(),
      };
    }
    created = true;
  } else if (existing.status === 401) {
    return { ok: false, error: "github_bad_token", detail: "Token rejected (401)." };
  } else if (existing.status >= 400) {
    return { ok: false, error: "github_error", detail: `GET /repos → ${existing.status}` };
  }

  const repoFullName = `${owner}/${repo}`;
  const repoUrl = `https://github.com/${repoFullName}`;

  // 3) Create a blob for each file (base64 keeps binary/UTF-8 safe).
  const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
  for (const f of cleanFiles) {
    const contentB64 = Buffer.from(f.content, "utf8").toString("base64");
    const blob = await gh(token, "POST", `/repos/${repoFullName}/git/blobs`, {
      content: contentB64,
      encoding: "base64",
    });
    if (blob.status >= 400 || !blob.json?.sha) {
      return { ok: false, error: "github_blob_failed", detail: `blob ${f.path} → ${blob.status}` };
    }
    tree.push({ path: f.path.replace(/^\/+/, ""), mode: "100644", type: "blob", sha: blob.json.sha });
  }

  // 4) Find the current branch head (if the repo already had commits).
  let parentSha: string | null = null;
  const ref = await gh(token, "GET", `/repos/${repoFullName}/git/ref/heads/${branch}`);
  if (ref.status === 200 && ref.json?.object?.sha) parentSha = ref.json.object.sha;

  // 5) Build the tree, commit, and move the branch pointer.
  const treeRes = await gh(token, "POST", `/repos/${repoFullName}/git/trees`, { tree });
  if (treeRes.status >= 400 || !treeRes.json?.sha) {
    return { ok: false, error: "github_tree_failed", detail: `tree → ${treeRes.status} ${treeRes.json?.message || ""}` };
  }

  const commitRes = await gh(token, "POST", `/repos/${repoFullName}/git/commits`, {
    message: opts.commitMessage || "Export from Velbaz",
    tree: treeRes.json.sha,
    parents: parentSha ? [parentSha] : [],
  });
  if (commitRes.status >= 400 || !commitRes.json?.sha) {
    return { ok: false, error: "github_commit_failed", detail: `commit → ${commitRes.status}` };
  }
  const commitSha = commitRes.json.sha;

  if (parentSha) {
    const upd = await gh(token, "PATCH", `/repos/${repoFullName}/git/refs/heads/${branch}`, {
      sha: commitSha,
      force: true,
    });
    if (upd.status >= 400) {
      return { ok: false, error: "github_ref_failed", detail: `update ref → ${upd.status}` };
    }
  } else {
    const mk = await gh(token, "POST", `/repos/${repoFullName}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commitSha,
    });
    if (mk.status >= 400) {
      return { ok: false, error: "github_ref_failed", detail: `create ref → ${mk.status} ${mk.json?.message || ""}` };
    }
  }

  return { ok: true, repoUrl, repoFullName, branch, created, fileCount: cleanFiles.length };
}
