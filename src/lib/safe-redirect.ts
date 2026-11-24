/** `value` if it is a path on this site, otherwise `fallback`. */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  return value && /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : fallback;
}
