import type { Key } from "@/types/key";

export function isReadonlyKey(key: Pick<Key, "canLoginWebUi">): boolean {
  return key.canLoginWebUi === false;
}

export function canUseReadonlyAccess(
  key: Pick<Key, "canLoginWebUi">,
  options?: { allowReadOnlyAccess?: boolean }
): boolean {
  return options?.allowReadOnlyAccess === true || !isReadonlyKey(key);
}
