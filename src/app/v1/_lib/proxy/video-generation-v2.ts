import { normalizeEndpointPath } from "./endpoint-paths";

export const VIDEO_GENERATION_V2_CREATE_PATH = "/v2/video_generation";

const TEXT_TO_VIDEO_MODEL = "MiniMax-H3";
const TEXT_TO_VIDEO_RESOLUTION = "2K";
const TEXT_TO_VIDEO_RATIOS = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);

export interface VideoGenerationV2TextContent {
  type: "text";
  text: string;
}

export interface VideoGenerationV2TextRequest {
  model: typeof TEXT_TO_VIDEO_MODEL;
  content: [VideoGenerationV2TextContent];
  resolution: typeof TEXT_TO_VIDEO_RESOLUTION;
  duration: number;
  ratio: string;
  callback_url?: string;
}

export type VideoGenerationV2ValidationResult =
  | { ok: true; request: VideoGenerationV2TextRequest }
  | { ok: false; message: string };

function fail(message: string): VideoGenerationV2ValidationResult {
  return { ok: false, message };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateVideoGenerationV2TextRequest(params: {
  pathname: string;
  method: string;
  body: Record<string, unknown>;
}): VideoGenerationV2ValidationResult {
  if (
    params.method.toUpperCase() !== "POST" ||
    normalizeEndpointPath(params.pathname) !== VIDEO_GENERATION_V2_CREATE_PATH
  ) {
    return { ok: true, request: params.body as unknown as VideoGenerationV2TextRequest };
  }

  const { body } = params;
  if (body.model !== TEXT_TO_VIDEO_MODEL) {
    return fail(`Invalid request: model must be ${TEXT_TO_VIDEO_MODEL}.`);
  }

  if (!Array.isArray(body.content) || body.content.length !== 1) {
    return fail("Invalid request: text-to-video content must contain exactly one text item.");
  }

  const content = body.content[0];
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    return fail("Invalid request: content must be an object.");
  }
  const textContent = content as Record<string, unknown>;
  if (textContent.type !== "text") {
    return fail("Invalid request: text-to-video content type must be text.");
  }
  if (typeof textContent.text !== "string" || textContent.text.trim().length === 0) {
    return fail("Invalid request: text-to-video requires a non-empty text prompt.");
  }
  if (textContent.text.length > 7000) {
    return fail("Invalid request: text prompt must not exceed 7000 characters.");
  }

  if (body.resolution !== TEXT_TO_VIDEO_RESOLUTION) {
    return fail(`Invalid request: resolution must be ${TEXT_TO_VIDEO_RESOLUTION}.`);
  }
  if (!Number.isInteger(body.duration) || Number(body.duration) < 4 || Number(body.duration) > 15) {
    return fail("Invalid request: duration must be an integer from 4 to 15 seconds.");
  }
  if (typeof body.ratio !== "string" || !TEXT_TO_VIDEO_RATIOS.has(body.ratio)) {
    return fail("Invalid request: text-to-video requires a supported non-adaptive ratio.");
  }
  if (
    body.callback_url !== undefined &&
    (typeof body.callback_url !== "string" || !isHttpUrl(body.callback_url))
  ) {
    return fail("Invalid request: callback_url must be an HTTP or HTTPS URL.");
  }

  return { ok: true, request: body as unknown as VideoGenerationV2TextRequest };
}
