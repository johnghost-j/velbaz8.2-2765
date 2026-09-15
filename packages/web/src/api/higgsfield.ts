// ─────────────────────────────────────────────────────────────────────────────
// Higgsfield AI integration
// Replaces the old motion-engine / AI-director ad pipeline. Drives image, video,
// image-to-video (DoP), talking-avatar (Speak) and Soul character generation
// through Higgsfield's official platform API (https://platform.higgsfield.ai).
//
// Credentials (root .env — see .env.template):
//   HF_CREDENTIALS="KEY_ID:KEY_SECRET"          (preferred, single value)
//   — or —
//   HF_API_KEY="KEY_ID"  +  HF_API_SECRET="KEY_SECRET"
//
// The key is supplied by the account owner from https://cloud.higgsfield.ai/.
// When no key is present every helper throws HiggsfieldNotConfiguredError so the
// routes can respond with a clean 503 instead of crashing.
// ─────────────────────────────────────────────────────────────────────────────

import { HiggsfieldClient } from "@higgsfield/client";
import {
  InputImage,
  InputAudio,
  inputMotion,
  SoulQuality,
  SoulSize,
  BatchSize,
  DoPModel,
  SpeakVideoQuality,
  SpeakDuration,
  strength,
  seed as seedHelper,
  InputImageType,
} from "@higgsfield/client";
import type { JobSet } from "@higgsfield/client";
import { getSecret } from './secret-store';

export class HiggsfieldNotConfiguredError extends Error {
  constructor() {
    super(
      "Higgsfield n'est pas configuré. Ajoute HF_CREDENTIALS (ou HF_API_KEY + HF_API_SECRET) dans le .env.",
    );
    this.name = "HiggsfieldNotConfiguredError";
  }
}

// ── Credential resolution ────────────────────────────────────────────────────
// Strips whitespace AND any surrounding single/double quotes so credentials keep
// working even when the .env value was written like KEY="uuid" (quotes included).
function clean(v: string | undefined | null): string {
  let s = (v ?? "").trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

function resolveCredentials(): { apiKey: string; apiSecret: string } | null {
  const combined = clean(getSecret('HF_CREDENTIALS') || process.env.HF_KEY);
  if (combined && combined.includes(":")) {
    const idx = combined.indexOf(":");
    const apiKey = clean(combined.slice(0, idx));
    const apiSecret = clean(combined.slice(idx + 1));
    if (apiKey && apiSecret) return { apiKey, apiSecret };
  }
  const apiKey = clean(getSecret('HF_API_KEY') || process.env.HIGGSFIELD_KEY_ID);
  const apiSecret = clean(
    process.env.HF_API_SECRET ||
      process.env.HF_SECRET ||
      process.env.HIGGSFIELD_KEY_SECRET,
  );
  if (apiKey && apiSecret) return { apiKey, apiSecret };
  return null;
}

export function isHiggsfieldConfigured(): boolean {
  return resolveCredentials() !== null;
}

let _client: HiggsfieldClient | null = null;
function getClient(): HiggsfieldClient {
  const creds = resolveCredentials();
  if (!creds) throw new HiggsfieldNotConfiguredError();
  if (!_client) {
    _client = new HiggsfieldClient({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      baseURL: process.env.HF_BASE_URL || "https://platform.higgsfield.ai",
      pollInterval: 2500,
      maxPollTime: 8 * 60_000, // videos can take a while
      timeout: 120_000,
    });
  }
  return _client;
}

// ── Endpoints (Higgsfield-native models) ─────────────────────────────────────
export const HF_ENDPOINTS = {
  soulText2Image: "/v1/text2image/soul",
  fluxText2Image: "flux-pro/kontext/max/text-to-image",
  dopImage2Video: "/v1/image2video/dop",
  speakVideo: "/v1/speak/higgsfield",
} as const;

// ── Normalized job result ────────────────────────────────────────────────────
export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface HfJobResult {
  requestId: string;
  status: HfStatus;
  /** primary media (image or video) URLs */
  outputs: string[];
  /** first output for convenience */
  outputUrl: string | null;
  /** thumbnail / min-res preview for the first output */
  thumbnailUrl: string | null;
  error: string | null;
  raw: unknown;
}

function normalize(jobSet: JobSet): HfJobResult {
  const status: HfStatus = jobSet.isCompleted
    ? "completed"
    : jobSet.isFailed
      ? "failed"
      : jobSet.isNsfw
        ? "nsfw"
        : jobSet.isCanceled
          ? "canceled"
          : jobSet.isInProgress
            ? "in_progress"
            : "queued";

  const outputs: string[] = [];
  let thumbnailUrl: string | null = null;
  for (const job of jobSet.jobs || []) {
    const raw = job.results?.raw?.url;
    const min = job.results?.min?.url;
    if (raw) {
      outputs.push(raw);
      if (!thumbnailUrl) thumbnailUrl = min || raw;
    }
  }

  return {
    requestId: jobSet.id,
    status,
    outputs,
    outputUrl: outputs[0] || null,
    thumbnailUrl,
    error: status === "failed" ? "Generation failed" : status === "nsfw" ? "Rejected by moderation (NSFW)" : null,
    raw: jobSet,
  };
}

// ── Upload (get a public URL Higgsfield can read) ────────────────────────────
export async function uploadImageBuffer(
  buffer: Buffer,
  format: "jpeg" | "png" | "webp" = "png",
): Promise<string> {
  return getClient().uploadImage(buffer, format);
}

/** Accepts a data URL (data:image/png;base64,...) or a raw base64 string. */
export async function uploadDataUrl(dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.*)$/);
  let base64 = dataUrl;
  let format: "jpeg" | "png" | "webp" = "png";
  if (m) {
    const mime = m[2];
    format = mime === "jpg" ? "jpeg" : (mime as "jpeg" | "png" | "webp");
    base64 = m[3];
  }
  return uploadImageBuffer(Buffer.from(base64, "base64"), format);
}

// ── Discovery helpers (populate picker UIs) ──────────────────────────────────
export async function getMotions() {
  return getClient().getMotions();
}
export async function getSoulStyles() {
  return getClient().getSoulStyles();
}
export async function listSoulIds(page = 1, pageSize = 20) {
  return getClient().listSoulIds(page, pageSize);
}
export async function createSoulId(name: string, imageUrls: string[], withPolling = true) {
  return getClient().createSoulId(
    {
      name,
      input_images: imageUrls.map((u) => ({ type: InputImageType.IMAGE_URL, image_url: u })),
    },
    withPolling,
  );
}

// ── Generation helpers ───────────────────────────────────────────────────────
interface WebhookOpt {
  url: string;
  secret: string;
}

export interface SoulImageParams {
  prompt: string;
  size?: keyof typeof SoulSize;
  quality?: "SD" | "HD";
  batch?: 1 | 4;
  styleId?: string;
  styleStrength?: number;
  soulId?: string;
  soulStrength?: number;
  seed?: number;
}

export async function generateSoulImage(p: SoulImageParams, webhookOpt?: WebhookOpt): Promise<HfJobResult> {
  const params: Record<string, unknown> = {
    prompt: p.prompt,
    width_and_height: SoulSize[p.size || "SQUARE_1536x1536"],
    quality: p.quality === "SD" ? SoulQuality.SD : SoulQuality.HD,
    batch_size: p.batch === 4 ? BatchSize.QUAD : BatchSize.SINGLE,
  };
  if (p.styleId) {
    params.style_id = p.styleId;
    params.style_strength = strength(p.styleStrength ?? 0.8);
  }
  if (p.soulId) {
    params.custom_reference_id = p.soulId;
    params.custom_reference_strength = strength(p.soulStrength ?? 1);
  }
  if (typeof p.seed === "number") params.seed = seedHelper(p.seed);

  const jobSet = await getClient().generate(HF_ENDPOINTS.soulText2Image, params, {
    withPolling: !webhookOpt,
    webhook: webhookOpt,
  });
  return normalize(jobSet);
}

export interface Image2VideoParams {
  prompt: string;
  imageUrl: string;
  /** optional end frame for start→end transitions */
  endImageUrl?: string;
  model?: "LITE" | "TURBO" | "STANDARD";
  /** motion ids from getMotions(), each 0..1 strength */
  motions?: { id: string; strength?: number }[];
}

export async function generateImageToVideo(p: Image2VideoParams, webhookOpt?: WebhookOpt): Promise<HfJobResult> {
  const inputImages = [InputImage.fromUrl(p.imageUrl)];
  if (p.endImageUrl) inputImages.push(InputImage.fromUrl(p.endImageUrl));

  const params: Record<string, unknown> = {
    model: DoPModel[p.model || "TURBO"],
    prompt: p.prompt,
    input_images: inputImages,
  };
  if (p.motions?.length) {
    params.motions = p.motions.map((m) => inputMotion(m.id, m.strength ?? 0.8));
  }

  const jobSet = await getClient().generate(HF_ENDPOINTS.dopImage2Video, params, {
    withPolling: !webhookOpt,
    webhook: webhookOpt,
  });
  return normalize(jobSet);
}

export interface SpeakVideoParams {
  imageUrl: string;
  /** must be a WAV file URL */
  audioUrl: string;
  prompt?: string;
  quality?: "MID" | "HIGH";
  duration?: "SHORT" | "MEDIUM" | "LONG";
}

export async function generateSpeakVideo(p: SpeakVideoParams, webhookOpt?: WebhookOpt): Promise<HfJobResult> {
  const durationMap: Record<string, number> = {
    SHORT: SpeakDuration.SHORT,
    MEDIUM: (SpeakDuration as Record<string, number>).MEDIUM ?? 10,
    LONG: (SpeakDuration as Record<string, number>).LONG ?? 15,
  };
  const params: Record<string, unknown> = {
    input_image: InputImage.fromUrl(p.imageUrl),
    input_audio: InputAudio.fromUrl(p.audioUrl),
    prompt: p.prompt || "Natural, professional presentation style",
    quality: p.quality === "HIGH" ? SpeakVideoQuality.HIGH : SpeakVideoQuality.MID,
    duration: durationMap[p.duration || "SHORT"],
  };
  const jobSet = await getClient().generate(HF_ENDPOINTS.speakVideo, params, {
    withPolling: !webhookOpt,
    webhook: webhookOpt,
  });
  return normalize(jobSet);
}

/**
 * Generic passthrough for any Higgsfield endpoint (e.g. third-party video models
 * exposed by the platform: bytedance/seedream, kling, veo, sora, wan, ...).
 * Lets the chat agent target new models without a code change.
 */
export async function generateGeneric(
  endpoint: string,
  input: Record<string, unknown>,
  webhookOpt?: WebhookOpt,
): Promise<HfJobResult> {
  const jobSet = await getClient().generate(endpoint, input, {
    withPolling: !webhookOpt,
    webhook: webhookOpt,
  });
  return normalize(jobSet);
}
