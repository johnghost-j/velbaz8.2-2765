// ─── Audio generation for generated sites & apps ─────────────────────────────
// Mirrors images.ts. An LLM "sound designer" decides IF and WHAT audio a site
// actually needs (most sites need none — it is 100% optional, like the shader
// backgrounds). We generate the clips with the sandbox CLI tools
// (`sound-effects`, `music`, `say`), base64-encode them into `audio/mpeg` data
// URIs, and expose them as a manifest written into the generated app as
// `src/lib/audio.ts`. Because that manifest is a plain project file, it is
// already covered by the checkpoint / rollback / fork machinery, exactly like
// the images manifest.
import { generateText } from "ai";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateway } from "../agent/gateway";

export type AudioKind = "sfx" | "music" | "voice" | "jingle";

export interface AudioSlot {
  key: string; // stable snake_case id used in code, ex: "click", "ambient", "welcome_vo"
  kind: AudioKind;
  // sfx/music/jingle → description of the sound; voice → the exact text to speak.
  prompt: string;
  duration?: number; // seconds
  loop?: boolean; // ambient music / loopable sfx
  voice?: string; // for kind=voice: rachel|sarah|lily|george|charlie|chris
}

export interface AudioManifest {
  // key -> data URI (data:audio/mpeg;base64,…)
  urls: Record<string, string>;
  // key -> metadata so the page prompt can tell the model what each clip is for
  meta: Record<string, { kind: AudioKind; loop: boolean; desc: string }>;
}

const VOICES = new Set(["rachel", "sarah", "lily", "george", "charlie", "chris"]);

// Hard caps keep the base64 payload reasonable inside a .ts file.
function clampDuration(kind: AudioKind, d?: number): number {
  const n = Number.isFinite(d) ? Number(d) : NaN;
  if (kind === "sfx") return Math.min(Math.max(n || 1, 0.5), 3);
  if (kind === "jingle") return Math.min(Math.max(n || 3, 1), 6);
  if (kind === "music") return Math.min(Math.max(n || 15, 5), 20);
  return Math.min(Math.max(n || 6, 1), 30); // voice
}

const SOUND_DESIGNER_SYSTEM =
  `Tu es un sound designer d'interface. Tu décides du son d'un site/app généré. ` +
  `Le son est un LUXE OPTIONNEL : l'écrasante majorité des sites n'en ont PAS besoin et ` +
  `renvoyer une liste VIDE est la bonne réponse par défaut. N'ajoute du son que s'il sert ` +
  `vraiment l'expérience (marque immersive, jeu, produit ludique/créatif, expérience premium, ` +
  `landing événementielle…). JAMAIS d'autoplay agressif. Reste sobre : au maximum quelques ` +
  `effets d'interaction + éventuellement UNE ambiance discrète. Réponds en JSON strict.`;

function extractJSON(raw: string): any {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

export interface PlanAudioInput {
  companyName: string;
  idea: string;
  industry?: string;
  lang: string;
  design?: any;
  /** When the user explicitly asked for sound, force at least a minimal set. */
  requested?: boolean;
  requestNote?: string;
}

export async function planAudioSlots(input: PlanAudioInput): Promise<AudioSlot[]> {
  const prompt =
`Entreprise: "${input.companyName}"
Idée: ${input.idea}
Secteur: ${input.industry || "non précisé"}
Langue (pour la voix off): ${input.lang}
${input.requested ? `L'UTILISATEUR A EXPLICITEMENT DEMANDÉ DU SON: "${input.requestNote || ""}". Tu DOIS donc proposer au moins 1 à 3 clips pertinents.` : `Décide librement — répondre {"slots":[]} est parfaitement acceptable et souvent le bon choix.`}

Décide de l'AUDIO généré pour ce projet. Types possibles ("kind"):
- "sfx": micro-effet d'interaction (clic, hover, succès, notification, transition). Court (<=3s).
- "music": ambiance de fond discrète, bouclable. 5-20s, mets "loop": true.
- "voice": courte voix off / narration (renseigne "prompt" = le TEXTE exact à dire, et "voice" parmi rachel|sarah|lily|george|charlie|chris).
- "jingle": court logo sonore de marque (1-6s).

Règles:
- "key": identifiant court, stable, snake_case, unique (ex: "click", "hover", "success", "ambient", "welcome_vo", "brand_jingle").
- Sois SOBRE. Pas de mur de sons. Jamais de musique forte en autoplay.
- Chaque clip doit avoir une utilité réelle et concrète.

Réponds en JSON strict:
{"slots":[{"key":"click","kind":"sfx","prompt":"soft UI click, subtle","duration":0.6},{"key":"ambient","kind":"music","prompt":"calm ambient pad, minimal","duration":16,"loop":true}]}`;

  try {
    const { text } = await generateText({
      model: gateway("openai/gpt-5.4-mini"),
      system: SOUND_DESIGNER_SYSTEM,
      prompt,
      maxOutputTokens: 2000,
    });
    const obj = extractJSON(text);
    const raw: any[] = Array.isArray(obj?.slots) ? obj.slots : [];
    const seen = new Set<string>();
    const slots: AudioSlot[] = [];
    for (const s of raw) {
      const key = String(s?.key || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
      const promptText = String(s?.prompt || "").trim();
      const kind = (["sfx", "music", "voice", "jingle"].includes(s?.kind) ? s.kind : "sfx") as AudioKind;
      if (!key || !promptText || seen.has(key)) continue;
      seen.add(key);
      const voice = String(s?.voice || "").trim().toLowerCase();
      slots.push({
        key,
        kind,
        prompt: promptText.slice(0, kind === "voice" ? 600 : 200),
        duration: clampDuration(kind, s?.duration),
        loop: kind === "music" ? s?.loop !== false : !!s?.loop,
        voice: VOICES.has(voice) ? voice : undefined,
      });
    }
    // Sécurité: borne le nombre total de clips pour ne pas alourdir le bundle.
    return slots.slice(0, 6);
  } catch (e) {
    console.error("[planAudioSlots] failed:", e);
    return [];
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: timeoutMs }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    // Some tools also accept stdin; we always pass args, so close stdin.
    child.stdin?.end();
  });
}

// Generate ONE clip and return a base64 `audio/mpeg` data URI (or null on
// failure — never throws, so a failed clip just drops out of the manifest).
export async function generateAudioClip(slot: AudioSlot): Promise<string | null> {
  let dir = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "velbaz-audio-"));
    const out = join(dir, `${slot.key}.mp3`);
    const dur = clampDuration(slot.kind, slot.duration);

    if (slot.kind === "voice") {
      const args = ["-o", out];
      if (slot.voice) args.push("-v", slot.voice);
      args.push(slot.prompt);
      await run("say", args, 120_000);
    } else if (slot.kind === "music") {
      await run("music", ["-d", String(Math.round(dur)), "-o", out, slot.prompt], 180_000);
    } else {
      // sfx + jingle → sound-effects
      const args = ["-d", String(dur), "-o", out];
      if (slot.loop) args.push("--loop");
      args.push(slot.prompt);
      await run("sound-effects", args, 120_000);
    }

    const buf = await readFile(out);
    // Guard against oversized payloads (~3MB raw → too heavy for a .ts file).
    if (!buf.length || buf.length > 3_000_000) {
      console.error(`[generateAudioClip] ${slot.key}: empty or too large (${buf.length}b)`);
      return null;
    }
    return `data:audio/mpeg;base64,${buf.toString("base64")}`;
  } catch (e: any) {
    console.error(`[generateAudioClip] ${slot.key} failed:`, e?.message || e);
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function generateAudioManifest(
  slots: AudioSlot[],
  onProgress?: (m: string) => void,
): Promise<AudioManifest> {
  const manifest: AudioManifest = { urls: {}, meta: {} };
  if (!slots.length) return manifest;
  onProgress?.(`🔊 Création de ${slots.length} son(s) sur mesure…`);
  // Bounded parallelism (audio gen is heavier than images → keep it at 2).
  const LIMIT = 2;
  let i = 0;
  async function worker() {
    while (i < slots.length) {
      const slot = slots[i++];
      const uri = await generateAudioClip(slot);
      if (uri) {
        manifest.urls[slot.key] = uri;
        manifest.meta[slot.key] = {
          kind: slot.kind,
          loop: !!slot.loop,
          desc: slot.kind === "voice" ? `voix off: "${slot.prompt.slice(0, 60)}"` : slot.prompt,
        };
        onProgress?.(`🔊 son prêt: ${slot.key} (${slot.kind})`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, slots.length) }, worker));
  const n = Object.keys(manifest.urls).length;
  onProgress?.(n ? `✅ ${n} son(s) intégré(s)` : "ℹ️ Aucun son généré");
  return manifest;
}

// Prompt injection: tells the page model which audio keys exist and how to use
// them via the sound system. Empty string when there is no audio.
export function audioPromptBlock(manifest: AudioManifest): string {
  const keys = Object.keys(manifest.urls);
  if (!keys.length) return "";
  const lines = keys.map((k) => {
    const m = manifest.meta[k];
    return `  - AUDIO.${k} → ${m.kind}${m.loop ? " (loop)" : ""} · ${m.desc}`;
  });
  return (
    `\n\nSONS DISPONIBLES (générés pour ce projet, dans src/lib/audio.ts) — utilise-les via le hook \`useSound()\` de "../lib/sound":\n` +
    lines.join("\n") +
    `\n  Usage: \`const { play } = useSound();\` puis \`onClick={() => play("click")}\` / \`onMouseEnter={() => play("hover")}\`.\n` +
    `  Musique d'ambiance (kind "music"): \`const { toggleAmbient } = useSound();\` déclenchée par un bouton (JAMAIS d'autoplay).\n` +
    `  Le bouton de coupure global <SoundToggle/> est déjà dans le header. N'importe QUE les clés listées ci-dessus.`
  );
}
