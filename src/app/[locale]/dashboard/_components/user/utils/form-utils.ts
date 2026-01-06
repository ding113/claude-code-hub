/**
 * Get the first error message from a form errors object.
 * Prioritizes _form error, then returns the first non-empty message.
 */
export function getFirstErrorMessage(
  errors: Readonly<Partial<Record<string, string | undefined>>>
): string | null {
  const formError = errors._form;
  if (typeof formError === "string" && formError.trim() !== "") return formError;

  const first = Object.entries(errors).find(
    ([, msg]) => typeof msg === "string" && msg.trim() !== ""
  );
  return first?.[1] ?? null;
}
