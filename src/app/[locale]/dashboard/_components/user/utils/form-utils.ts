/**
 * Get the first error message from a form errors object.
 * Prioritizes _form error, then returns the first non-empty message.
 */
export function getFirstErrorMessage(errors: Record<string, string>): string | null {
  if (errors._form) return errors._form;
  const first = Object.entries(errors).find(([, msg]) => Boolean(msg));
  return first?.[1] || null;
}
