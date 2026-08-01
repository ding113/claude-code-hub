import { createElement, forwardRef } from "react";

export const FluentEmoji = forwardRef<HTMLSpanElement, { emoji?: string; className?: string }>(
  ({ emoji = "", className }, ref) =>
    createElement("span", { ref, className, "aria-hidden": true }, emoji)
);

FluentEmoji.displayName = "FluentEmoji";

export function getEmoji(character: string): string {
  return character;
}

export function getEmojiNameByCharacter(character: string): string {
  return character;
}

export function getFluentEmojiCDN(): string {
  return "";
}

export default FluentEmoji;
