import type { Provider } from "@/types/provider";

export type OpenAIImageEndpoint = "generations" | "edits" | "variations";

type OpenAIImageModelFamily = "gpt" | "dall-e-2" | "dall-e-3" | "unknown";

type MultipartTextPart = {
  name: string;
  kind: "text";
  value: string;
};

type MultipartFilePart = {
  name: string;
  kind: "file";
  value: File;
};

export type OpenAIImageMultipartPart = MultipartTextPart | MultipartFilePart;

export interface OpenAIImageRequestMetadata {
  endpoint: OpenAIImageEndpoint;
  bodyKind: "json" | "multipart";
  contentType: string | null;
  model: string | null;
  parts: OpenAIImageMultipartPart[];
}

export interface OpenAIImageValidationResult {
  ok: boolean;
  message?: string;
}

const GENERATION_GPT_MODELS = new Set([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "chatgpt-image-latest",
]);
const EDIT_GPT_MODELS = new Set([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "chatgpt-image-latest",
]);
const VARIATION_MODEL = "dall-e-2";

const GPT_ONLY_GENERATION_PARAMS = new Set([
  "background",
  "moderation",
  "output_compression",
  "output_format",
  "partial_images",
  "stream",
]);

const GPT_ONLY_EDIT_PARAMS = new Set([
  "moderation",
  "output_compression",
  "output_format",
  "partial_images",
  "quality",
  "size",
  "stream",
]);

const BOOLEAN_MULTIPART_FIELDS = new Set(["stream"]);
const INTEGER_MULTIPART_FIELDS = new Set(["n", "output_compression", "partial_images"]);
const PRIMARY_IMAGE_FILE_FIELDS = new Set(["image", "image[]"]);
const SINGLE_VALUE_MULTIPART_FIELDS = new Set([
  "prompt",
  "model",
  "background",
  "input_fidelity",
  "mask",
  "moderation",
  "n",
  "output_compression",
  "output_format",
  "partial_images",
  "quality",
  "size",
  "stream",
  "user",
  "response_format",
  "style",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenAIImageUrl(value: string): boolean {
  if (value.startsWith("data:")) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function firstTextPart(
  metadata: OpenAIImageRequestMetadata | null | undefined,
  name: string
): string | null {
  if (!metadata) return null;
  const part = metadata.parts.find((entry) => entry.kind === "text" && entry.name === name);
  return part?.kind === "text" ? part.value : null;
}

function allTextParts(
  metadata: OpenAIImageRequestMetadata | null | undefined,
  name: string
): string[] {
  if (!metadata) return [];
  return metadata.parts
    .filter((entry): entry is MultipartTextPart => entry.kind === "text" && entry.name === name)
    .map((entry) => entry.value);
}

function countFileParts(
  metadata: OpenAIImageRequestMetadata | null | undefined,
  names: string[]
): number {
  if (!metadata) return 0;
  const nameSet = new Set(names);
  return metadata.parts.filter((entry) => entry.kind === "file" && nameSet.has(entry.name)).length;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fail(message: string): OpenAIImageValidationResult {
  return { ok: false, message };
}

function success(): OpenAIImageValidationResult {
  return { ok: true };
}

function isGptImageModel(model: string): boolean {
  return GENERATION_GPT_MODELS.has(model) || EDIT_GPT_MODELS.has(model);
}

function getKnownModelFamily(
  endpoint: OpenAIImageEndpoint,
  model: string | null
): OpenAIImageModelFamily | null {
  if (!model) return null;
  if (model === "dall-e-2") return "dall-e-2";
  if (model === "dall-e-3") return "dall-e-3";
  if (
    (endpoint === "generations" && isGptImageModel(model)) ||
    (endpoint === "edits" && isGptImageModel(model))
  ) {
    return "gpt";
  }
  return null;
}

function inferGenerationModelFamily(body: Record<string, unknown>, model: string | null) {
  const knownFamily = getKnownModelFamily("generations", model);
  if (knownFamily) return knownFamily;
  if (model) return "unknown" as const;

  const size = parseString(body.size);
  const quality = parseString(body.quality);
  const style = parseString(body.style);
  const hasGptOnlyParam = Array.from(GPT_ONLY_GENERATION_PARAMS).some(
    (key) => body[key] !== undefined
  );

  if (style === "vivid" || style === "natural") return "dall-e-3";
  if (size === "1792x1024" || size === "1024x1792") return "dall-e-3";
  if (quality === "hd") return "dall-e-3";

  if (hasGptOnlyParam) return "gpt";
  if (size === "auto" || size === "1536x1024" || size === "1024x1536") return "gpt";
  if (quality === "low" || quality === "medium" || quality === "high") return "gpt";

  return "dall-e-2";
}

function inferEditModelFamily(
  body: Record<string, unknown>,
  model: string | null
): OpenAIImageModelFamily | null {
  const knownFamily = getKnownModelFamily("edits", model);
  if (knownFamily) return knownFamily;
  if (model) return "unknown";

  const hasGptOnlyParam = Array.from(GPT_ONLY_EDIT_PARAMS).some((key) => body[key] !== undefined);
  return hasGptOnlyParam ? "gpt" : null;
}

function inferMultipartEditModelFamily(
  metadata: OpenAIImageRequestMetadata,
  model: string | null
): OpenAIImageModelFamily | null {
  const knownFamily = getKnownModelFamily("edits", model);
  if (knownFamily) return knownFamily;
  if (model) return "unknown";

  const hasGptOnlyParam = Array.from(GPT_ONLY_EDIT_PARAMS).some(
    (key) => firstTextPart(metadata, key) !== null
  );
  return hasGptOnlyParam ? "gpt" : null;
}

function validatePromptLength(
  prompt: string,
  family: OpenAIImageModelFamily | null
): OpenAIImageValidationResult {
  if (family === "gpt") {
    return prompt.length <= 32000
      ? success()
      : fail("Invalid request: prompt exceeds the 32000 character limit for GPT image models.");
  }

  if (family === "dall-e-2") {
    return prompt.length <= 1000
      ? success()
      : fail("Invalid request: prompt exceeds the 1000 character limit for dall-e-2.");
  }

  if (family === "dall-e-3") {
    return prompt.length <= 4000
      ? success()
      : fail("Invalid request: prompt exceeds the 4000 character limit for dall-e-3.");
  }

  return success();
}

function validateDallEUrlField(name: string, value: string): OpenAIImageValidationResult {
  if (value.length > 20 * 1024 * 1024) {
    return fail(`Invalid request: ${name} exceeds the documented maxLength of 20971520.`);
  }

  return isOpenAIImageUrl(value)
    ? success()
    : fail(`Invalid request: ${name} must be a fully qualified URL or a data URL.`);
}

function validateGenerationsRequest(body: Record<string, unknown>): OpenAIImageValidationResult {
  const prompt = parseString(body.prompt);
  if (!prompt) {
    return fail("Missing required parameter: prompt");
  }

  const model = parseString(body.model);
  if (model === "gpt-image-2") {
    return success();
  }

  const family = inferGenerationModelFamily(body, model);
  const promptLengthResult = validatePromptLength(prompt, family);
  if (!promptLengthResult.ok) return promptLengthResult;

  const background = parseString(body.background);
  if (
    background &&
    background !== "transparent" &&
    background !== "opaque" &&
    background !== "auto"
  ) {
    return fail('Invalid request: background must be one of "transparent", "opaque", or "auto".');
  }
  if (background && family !== "gpt") {
    return fail("Invalid request: background is only supported for GPT image models.");
  }

  const outputFormat = parseString(body.output_format);
  if (outputFormat && !["png", "jpeg", "webp"].includes(outputFormat)) {
    return fail('Invalid request: output_format must be one of "png", "jpeg", or "webp".');
  }
  if (outputFormat && family !== "gpt") {
    return fail("Invalid request: output_format is only supported for GPT image models.");
  }
  if (background === "transparent" && outputFormat && !["png", "webp"].includes(outputFormat)) {
    return fail('Invalid request: transparent background requires output_format "png" or "webp".');
  }

  const moderation = parseString(body.moderation);
  if (moderation && moderation !== "low" && moderation !== "auto") {
    return fail('Invalid request: moderation must be either "low" or "auto".');
  }
  if (moderation && family !== "gpt") {
    return fail("Invalid request: moderation is only supported for GPT image models.");
  }

  const n = parseInteger(body.n);
  if (body.n !== undefined) {
    if (n === null || !Number.isInteger(n) || n < 1 || n > 10) {
      return fail("Invalid request: n must be an integer between 1 and 10.");
    }
    if (family === "dall-e-3" && n !== 1) {
      return fail("Invalid request: dall-e-3 only supports n=1.");
    }
  }

  const outputCompression = parseInteger(body.output_compression);
  if (body.output_compression !== undefined) {
    if (outputCompression === null || outputCompression < 0 || outputCompression > 100) {
      return fail("Invalid request: output_compression must be between 0 and 100.");
    }
    if (family !== "gpt") {
      return fail("Invalid request: output_compression is only supported for GPT image models.");
    }
    if (outputFormat && !["jpeg", "webp"].includes(outputFormat)) {
      return fail('Invalid request: output_compression requires output_format "jpeg" or "webp".');
    }
  }

  const partialImages = parseInteger(body.partial_images);
  if (body.partial_images !== undefined) {
    if (partialImages === null || !Number.isInteger(partialImages) || partialImages < 0) {
      return fail("Invalid request: partial_images must be an integer between 0 and 3.");
    }
    if (partialImages > 3) {
      return fail("Invalid request: partial_images must be an integer between 0 and 3.");
    }
  }

  const quality = parseString(body.quality);
  if (quality && !["standard", "hd", "low", "medium", "high", "auto"].includes(quality)) {
    return fail(
      'Invalid request: quality must be one of "standard", "hd", "low", "medium", "high", or "auto".'
    );
  }
  if (quality && family === "gpt" && !["low", "medium", "high", "auto"].includes(quality)) {
    return fail(
      'Invalid request: GPT image models only support quality "low", "medium", "high", or "auto".'
    );
  }
  if (quality && family === "dall-e-3" && !["standard", "hd", "auto"].includes(quality)) {
    return fail('Invalid request: dall-e-3 only supports quality "standard" or "hd".');
  }
  if (quality && family === "dall-e-2" && !["standard", "auto"].includes(quality)) {
    return fail('Invalid request: dall-e-2 only supports quality "standard".');
  }

  const responseFormat = parseString(body.response_format);
  if (responseFormat && !["url", "b64_json"].includes(responseFormat)) {
    return fail('Invalid request: response_format must be either "url" or "b64_json".');
  }
  if (responseFormat && family === "gpt") {
    return fail("Invalid request: response_format is not supported for GPT image models.");
  }

  const size = parseString(body.size);
  if (
    size &&
    ![
      "auto",
      "1024x1024",
      "1536x1024",
      "1024x1536",
      "256x256",
      "512x512",
      "1792x1024",
      "1024x1792",
    ].includes(size)
  ) {
    return fail("Invalid request: size is not a supported value for the Images API.");
  }
  if (size && family === "gpt" && !["auto", "1024x1024", "1536x1024", "1024x1536"].includes(size)) {
    return fail(
      "Invalid request: GPT image models only support size auto, 1024x1024, 1536x1024, or 1024x1536."
    );
  }
  if (size && family === "dall-e-2" && !["256x256", "512x512", "1024x1024"].includes(size)) {
    return fail("Invalid request: dall-e-2 only supports size 256x256, 512x512, or 1024x1024.");
  }
  if (size && family === "dall-e-3" && !["1024x1024", "1792x1024", "1024x1792"].includes(size)) {
    return fail("Invalid request: dall-e-3 only supports size 1024x1024, 1792x1024, or 1024x1792.");
  }

  const stream = parseBoolean(body.stream);
  if (body.stream !== undefined && stream === null) {
    return fail("Invalid request: stream must be a boolean.");
  }
  if (stream !== null && stream && family !== "gpt") {
    return fail("Invalid request: stream is only supported for GPT image models.");
  }

  const style = parseString(body.style);
  if (style && style !== "vivid" && style !== "natural") {
    return fail('Invalid request: style must be either "vivid" or "natural".');
  }
  if (style && family !== "dall-e-3") {
    return fail("Invalid request: style is only supported for dall-e-3.");
  }

  return success();
}

function validateEditMask(mask: unknown): OpenAIImageValidationResult {
  if (!isRecord(mask)) {
    return fail("Invalid request: mask must be an object.");
  }

  const fileId = parseString(mask.file_id);
  const imageUrl = parseString(mask.image_url);
  if ((fileId ? 1 : 0) + (imageUrl ? 1 : 0) !== 1) {
    return fail("Invalid request: mask must provide exactly one of image_url or file_id.");
  }

  if (imageUrl) {
    return validateDallEUrlField("mask.image_url", imageUrl);
  }

  return success();
}

function validateEditImages(images: unknown, family: OpenAIImageModelFamily | null) {
  if (!Array.isArray(images) || images.length === 0) {
    return fail("Missing required parameter: images");
  }
  if (family === "gpt" && images.length > 16) {
    return fail("Invalid request: GPT image edit requests support up to 16 images.");
  }

  for (const [index, image] of images.entries()) {
    if (!isRecord(image)) {
      return fail(`Invalid request: images[${index}] must be an object.`);
    }
    const fileId = parseString(image.file_id);
    const imageUrl = parseString(image.image_url);
    if (!fileId && !imageUrl) {
      return fail(`Invalid request: images[${index}] must provide file_id or image_url.`);
    }
    if (imageUrl) {
      const result = validateDallEUrlField(`images[${index}].image_url`, imageUrl);
      if (!result.ok) return result;
    }
  }

  return success();
}

function validateEditsJsonRequest(body: Record<string, unknown>): OpenAIImageValidationResult {
  const prompt = parseString(body.prompt);
  if (!prompt) {
    return fail("Missing required parameter: prompt");
  }
  if (prompt.length < 1 || prompt.length > 32000) {
    return fail("Invalid request: prompt must be between 1 and 32000 characters.");
  }

  const model = parseString(body.model);
  if (model === "dall-e-3") {
    return fail("Invalid request: /images/edits does not support dall-e-3.");
  }

  const family = inferEditModelFamily(body, model);
  const imagesResult = validateEditImages(body.images, family);
  if (!imagesResult.ok) return imagesResult;

  const background = parseString(body.background);
  if (
    background &&
    background !== "transparent" &&
    background !== "opaque" &&
    background !== "auto"
  ) {
    return fail('Invalid request: background must be one of "transparent", "opaque", or "auto".');
  }

  const inputFidelity = parseString(body.input_fidelity);
  if (inputFidelity && inputFidelity !== "high" && inputFidelity !== "low") {
    return fail('Invalid request: input_fidelity must be "high" or "low".');
  }

  if (body.mask !== undefined) {
    const maskResult = validateEditMask(body.mask);
    if (!maskResult.ok) return maskResult;
  }

  if (model === "gpt-image-2") {
    return success();
  }

  const moderation = parseString(body.moderation);
  if (moderation && moderation !== "low" && moderation !== "auto") {
    return fail('Invalid request: moderation must be either "low" or "auto".');
  }
  if (moderation && family !== "gpt") {
    return fail("Invalid request: moderation is only supported for GPT image models.");
  }

  const n = parseInteger(body.n);
  if (body.n !== undefined && (n === null || !Number.isInteger(n) || n < 1 || n > 10)) {
    return fail("Invalid request: n must be an integer between 1 and 10.");
  }

  const outputCompression = parseInteger(body.output_compression);
  if (body.output_compression !== undefined) {
    if (outputCompression === null || outputCompression < 0 || outputCompression > 100) {
      return fail("Invalid request: output_compression must be between 0 and 100.");
    }
    const outputFormat = parseString(body.output_format);
    if (outputFormat && !["jpeg", "webp"].includes(outputFormat)) {
      return fail('Invalid request: output_compression requires output_format "jpeg" or "webp".');
    }
  }

  const outputFormat = parseString(body.output_format);
  if (outputFormat && !["png", "jpeg", "webp"].includes(outputFormat)) {
    return fail('Invalid request: output_format must be one of "png", "jpeg", or "webp".');
  }
  if (outputFormat && family !== "gpt") {
    return fail("Invalid request: output_format is only supported for GPT image models.");
  }

  const partialImages = parseInteger(body.partial_images);
  if (body.partial_images !== undefined) {
    if (partialImages === null || !Number.isInteger(partialImages) || partialImages < 0) {
      return fail("Invalid request: partial_images must be an integer between 0 and 3.");
    }
    if (partialImages > 3) {
      return fail("Invalid request: partial_images must be an integer between 0 and 3.");
    }
  }

  const quality = parseString(body.quality);
  if (quality && !["low", "medium", "high", "auto"].includes(quality)) {
    return fail('Invalid request: quality must be one of "low", "medium", "high", or "auto".');
  }
  if (quality && family !== "gpt") {
    return fail("Invalid request: quality is only supported for GPT image models.");
  }

  const size = parseString(body.size);
  if (size && !["auto", "1024x1024", "1536x1024", "1024x1536"].includes(size)) {
    return fail(
      "Invalid request: /images/edits only supports size auto, 1024x1024, 1536x1024, or 1024x1536."
    );
  }

  const stream = parseBoolean(body.stream);
  if (body.stream !== undefined && stream === null) {
    return fail("Invalid request: stream must be a boolean.");
  }

  return success();
}

function getPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return null;
  }
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | (bytes[19] & 0xff);
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | (bytes[23] & 0xff);
  return { width: width >>> 0, height: height >>> 0 };
}

async function validateVariationImageFile(file: File): Promise<OpenAIImageValidationResult> {
  const fileName = file.name.toLowerCase();
  const isPng = file.type === "image/png" || fileName.endsWith(".png");
  if (!isPng) {
    return fail("Invalid request: /images/variations requires a valid PNG file.");
  }

  if (file.size >= 4 * 1024 * 1024) {
    return fail("Invalid request: /images/variations requires the image file to be less than 4MB.");
  }

  const buffer = await file.arrayBuffer();
  const pngSize = getPngSize(new Uint8Array(buffer));
  if (!pngSize) {
    return fail("Invalid request: /images/variations requires a valid PNG file.");
  }

  if (pngSize.width !== pngSize.height) {
    return fail("Invalid request: /images/variations requires a square PNG image.");
  }

  return success();
}

async function validateVariationsMultipartRequest(
  metadata: OpenAIImageRequestMetadata
): Promise<OpenAIImageValidationResult> {
  const imageFiles = metadata.parts.filter(
    (entry): entry is MultipartFilePart => entry.kind === "file" && entry.name === "image"
  );

  if (imageFiles.length !== 1) {
    return fail("Missing required parameter: image");
  }

  const imageResult = await validateVariationImageFile(imageFiles[0].value);
  if (!imageResult.ok) return imageResult;

  const model = firstTextPart(metadata, "model");
  if (model && model !== VARIATION_MODEL) {
    return fail("Invalid request: /images/variations only supports model dall-e-2.");
  }

  const n = parseInteger(firstTextPart(metadata, "n"));
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > 10)) {
    return fail("Invalid request: n must be an integer between 1 and 10.");
  }

  const responseFormat = firstTextPart(metadata, "response_format");
  if (responseFormat && responseFormat !== "url" && responseFormat !== "b64_json") {
    return fail('Invalid request: response_format must be either "url" or "b64_json".');
  }

  const size = firstTextPart(metadata, "size");
  if (size && !["256x256", "512x512", "1024x1024"].includes(size)) {
    return fail(
      "Invalid request: /images/variations only supports size 256x256, 512x512, or 1024x1024."
    );
  }

  return success();
}

async function validateEditsMultipartRequest(
  metadata: OpenAIImageRequestMetadata
): Promise<OpenAIImageValidationResult> {
  for (const field of SINGLE_VALUE_MULTIPART_FIELDS) {
    if (allTextParts(metadata, field).length > 1) {
      return fail(`Invalid request: multipart field "${field}" must not be repeated.`);
    }
  }

  const prompt = firstTextPart(metadata, "prompt");
  if (!prompt) {
    return fail("Missing required parameter: prompt");
  }
  if (prompt.length < 1 || prompt.length > 32000) {
    return fail("Invalid request: prompt must be between 1 and 32000 characters.");
  }

  const model = firstTextPart(metadata, "model");
  if (model === "dall-e-3") {
    return fail("Invalid request: /images/edits does not support dall-e-3.");
  }

  const family = inferMultipartEditModelFamily(metadata, model);
  const imageCount = countFileParts(metadata, ["image", "image[]"]);
  if (imageCount < 1) {
    return fail("Missing required parameter: image");
  }
  if (family === "gpt" && imageCount > 16) {
    return fail("Invalid request: GPT image edit requests support up to 16 images.");
  }

  const background = firstTextPart(metadata, "background");
  if (
    background &&
    background !== "transparent" &&
    background !== "opaque" &&
    background !== "auto"
  ) {
    return fail('Invalid request: background must be one of "transparent", "opaque", or "auto".');
  }

  const inputFidelity = firstTextPart(metadata, "input_fidelity");
  if (inputFidelity && inputFidelity !== "high" && inputFidelity !== "low") {
    return fail('Invalid request: input_fidelity must be "high" or "low".');
  }

  const maskTextCount = allTextParts(metadata, "mask").length;
  const maskFileCount = countFileParts(metadata, ["mask"]);
  if (maskTextCount + maskFileCount > 1) {
    return fail("Invalid request: multipart /images/edits accepts at most one mask field.");
  }

  if (model === "gpt-image-2") {
    return success();
  }

  const moderation = firstTextPart(metadata, "moderation");
  if (moderation && moderation !== "low" && moderation !== "auto") {
    return fail('Invalid request: moderation must be either "low" or "auto".');
  }
  if (moderation && family !== "gpt") {
    return fail("Invalid request: moderation is only supported for GPT image models.");
  }

  const n = parseInteger(firstTextPart(metadata, "n"));
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > 10)) {
    return fail("Invalid request: n must be an integer between 1 and 10.");
  }

  const outputCompression = parseInteger(firstTextPart(metadata, "output_compression"));
  const outputFormat = firstTextPart(metadata, "output_format");
  if (outputCompression !== null) {
    if (outputCompression < 0 || outputCompression > 100) {
      return fail("Invalid request: output_compression must be between 0 and 100.");
    }
    if (outputFormat && !["jpeg", "webp"].includes(outputFormat)) {
      return fail('Invalid request: output_compression requires output_format "jpeg" or "webp".');
    }
  }

  if (outputFormat && !["png", "jpeg", "webp"].includes(outputFormat)) {
    return fail('Invalid request: output_format must be one of "png", "jpeg", or "webp".');
  }
  if (outputFormat && family !== "gpt") {
    return fail("Invalid request: output_format is only supported for GPT image models.");
  }

  const partialImages = parseInteger(firstTextPart(metadata, "partial_images"));
  if (partialImages !== null && (!Number.isInteger(partialImages) || partialImages < 0)) {
    return fail("Invalid request: partial_images must be an integer between 0 and 3.");
  }
  if (partialImages !== null && partialImages > 3) {
    return fail("Invalid request: partial_images must be an integer between 0 and 3.");
  }

  const quality = firstTextPart(metadata, "quality");
  if (quality && !["low", "medium", "high", "auto"].includes(quality)) {
    return fail('Invalid request: quality must be one of "low", "medium", "high", or "auto".');
  }
  if (quality && family !== "gpt") {
    return fail("Invalid request: quality is only supported for GPT image models.");
  }

  const size = firstTextPart(metadata, "size");
  if (size && !["auto", "1024x1024", "1536x1024", "1024x1536"].includes(size)) {
    return fail(
      "Invalid request: /images/edits only supports size auto, 1024x1024, 1536x1024, or 1024x1536."
    );
  }

  const stream = firstTextPart(metadata, "stream");
  if (stream !== null && parseBoolean(stream) === null) {
    return fail("Invalid request: stream must be a boolean.");
  }

  return success();
}

export function getOpenAIImageEndpoint(pathname: string): OpenAIImageEndpoint | null {
  if (pathname === "/v1/images/generations") return "generations";
  if (pathname === "/v1/images/edits") return "edits";
  if (pathname === "/v1/images/variations") return "variations";
  return null;
}

export function isOpenAIImageMultipartContentType(contentType: string | null): boolean {
  return (
    typeof contentType === "string" && contentType.toLowerCase().includes("multipart/form-data")
  );
}

export async function parseOpenAIImageMultipartMetadata(
  request: Request,
  pathname: string,
  contentType: string | null
): Promise<OpenAIImageRequestMetadata | null> {
  const endpoint = getOpenAIImageEndpoint(pathname);
  if (!endpoint || !isOpenAIImageMultipartContentType(contentType)) {
    return null;
  }

  const formData = await request.clone().formData();
  const parts: OpenAIImageMultipartPart[] = [];
  let model: string | null = null;

  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") {
      parts.push({ name, kind: "text", value });
      if (name === "model" && model === null) {
        model = value;
      }
      continue;
    }

    parts.push({ name, kind: "file", value });
  }

  return {
    endpoint,
    bodyKind: "multipart",
    contentType,
    model,
    parts,
  };
}

export function getOpenAIImageMultipartSummary(metadata: OpenAIImageRequestMetadata): string {
  const fileCount = metadata.parts.filter((entry) => entry.kind === "file").length;
  const fieldCount = metadata.parts.filter((entry) => entry.kind === "text").length;
  const promptLength = firstTextPart(metadata, "prompt")?.length ?? 0;
  return JSON.stringify(
    {
      type: "openai_image_multipart",
      endpoint: metadata.endpoint,
      model: metadata.model,
      fieldCount,
      fileCount,
      promptLength,
    },
    null,
    2
  );
}

export function isOpenAIImageMultipartRequest(
  metadata: OpenAIImageRequestMetadata | null | undefined
): boolean {
  return metadata?.bodyKind === "multipart";
}

export function setOpenAIImageMultipartModel(
  metadata: OpenAIImageRequestMetadata,
  model: string
): void {
  let rewritten = false;
  metadata.model = model;

  metadata.parts = metadata.parts.map((entry) => {
    if (entry.kind === "text" && entry.name === "model") {
      if (!rewritten) {
        rewritten = true;
        return { ...entry, value: model };
      }
      return entry;
    }

    return entry;
  });

  if (!rewritten) {
    metadata.parts.push({ name: "model", kind: "text", value: model });
  }
}

export function buildOpenAIImageLogicalBody(
  metadata: OpenAIImageRequestMetadata | null | undefined
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const grouped = new Map<string, string[]>();
  for (const part of metadata.parts) {
    if (part.kind !== "text") continue;
    const existing = grouped.get(part.name) ?? [];
    existing.push(part.value);
    grouped.set(part.name, existing);
  }

  const logicalBody: Record<string, unknown> = {};
  for (const [name, values] of grouped.entries()) {
    logicalBody[name] = values.length === 1 ? coerceMultipartLogicalValue(name, values[0]) : values;
  }

  for (const part of metadata.parts) {
    if (part.kind !== "file" || PRIMARY_IMAGE_FILE_FIELDS.has(part.name)) continue;
    if (!(part.name in logicalBody)) {
      logicalBody[part.name] = "[file]";
    }
  }

  return logicalBody;
}

function coerceMultipartLogicalValue(name: string, value: string): unknown {
  if (BOOLEAN_MULTIPART_FIELDS.has(name)) {
    return parseBoolean(value) ?? value;
  }
  if (INTEGER_MULTIPART_FIELDS.has(name)) {
    return parseInteger(value) ?? value;
  }
  return value;
}

export function syncOpenAIImageMultipartFromLogicalBody(
  metadata: OpenAIImageRequestMetadata,
  logicalBody: Record<string, unknown>
): void {
  const fileParts = metadata.parts.filter((part): part is MultipartFilePart => {
    if (part.kind !== "file") return false;
    if (part.name.startsWith("_")) return false;
    if (PRIMARY_IMAGE_FILE_FIELDS.has(part.name)) return true;
    return Object.prototype.hasOwnProperty.call(logicalBody, part.name);
  });
  const nextTextParts: MultipartTextPart[] = [];

  for (const [key, value] of Object.entries(logicalBody)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          nextTextParts.push({ name: key, kind: "text", value: String(item) });
        }
      }
      continue;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      nextTextParts.push({ name: key, kind: "text", value: String(value) });
    }
  }

  metadata.parts = [...nextTextParts, ...fileParts];
  metadata.model = parseString(logicalBody.model) ?? null;
}

export function cloneOpenAIImageRequestMetadata(
  metadata: OpenAIImageRequestMetadata | null | undefined
): OpenAIImageRequestMetadata | null {
  if (!metadata) return null;

  return {
    endpoint: metadata.endpoint,
    bodyKind: metadata.bodyKind,
    contentType: metadata.contentType,
    model: metadata.model,
    parts: metadata.parts.map((part) =>
      part.kind === "text" ? { ...part } : { ...part, value: part.value }
    ),
  };
}

export async function serializeOpenAIImageMultipartRequest(metadata: OpenAIImageRequestMetadata) {
  const formData = new FormData();
  for (const part of metadata.parts) {
    if (part.kind === "text") {
      formData.append(part.name, part.value);
      continue;
    }

    formData.append(part.name, part.value, part.value.name);
  }

  const request = new Request("https://proxy.invalid/upload", {
    method: "POST",
    body: formData,
  });

  return {
    body: await request.arrayBuffer(),
    contentType: request.headers.get("content-type"),
    summary: getOpenAIImageMultipartSummary(metadata),
    isStreaming: parseBoolean(firstTextPart(metadata, "stream")) === true,
  };
}

export function sanitizeGenerationsRequestForProvider(
  body: Record<string, unknown>,
  provider: Provider | null | undefined
): boolean {
  if (!provider || body.response_format === undefined) {
    return false;
  }

  const providerName = provider.name.toLowerCase();
  const providerUrl = provider.url.toLowerCase();
  const looksLikeYunAiAzure =
    (providerName.includes("yunai") && providerName.includes("azure")) ||
    (providerUrl.includes("yunai") && providerUrl.includes("azure"));

  if (!looksLikeYunAiAzure) {
    return false;
  }

  delete body.response_format;
  return true;
}

export async function validateOpenAIImageRequest(options: {
  pathname: string;
  body: Record<string, unknown>;
  imageRequestMetadata?: OpenAIImageRequestMetadata | null;
}): Promise<OpenAIImageValidationResult> {
  const endpoint = getOpenAIImageEndpoint(options.pathname);
  if (!endpoint) {
    return success();
  }

  if (endpoint === "generations") {
    if (options.imageRequestMetadata?.bodyKind === "multipart") {
      return fail("Invalid request: /images/generations requires a JSON request body.");
    }
    return validateGenerationsRequest(options.body);
  }

  if (endpoint === "edits") {
    if (options.imageRequestMetadata?.bodyKind === "multipart") {
      return validateEditsMultipartRequest(options.imageRequestMetadata);
    }
    return validateEditsJsonRequest(options.body);
  }

  if (endpoint === "variations") {
    if (!options.imageRequestMetadata || options.imageRequestMetadata.bodyKind !== "multipart") {
      return fail("Invalid request: /images/variations requires multipart/form-data.");
    }
    return validateVariationsMultipartRequest(options.imageRequestMetadata);
  }

  return success();
}
