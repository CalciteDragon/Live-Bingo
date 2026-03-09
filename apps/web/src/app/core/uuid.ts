/**
 * UUID v4 generator that works in both secure (HTTPS) and non-secure (HTTP)
 * contexts. `crypto.randomUUID` is only available in secure contexts, so we
 * fall back to a `Math.random`-based implementation for LAN dev over HTTP.
 */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
