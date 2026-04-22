export const PROVIDER_GROUP_DESCRIPTION_MAX_BYTES = 16 * 1024;

export function getUtf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function exceedsProviderGroupDescriptionLimit(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return getUtf8ByteLength(value) > PROVIDER_GROUP_DESCRIPTION_MAX_BYTES;
}
