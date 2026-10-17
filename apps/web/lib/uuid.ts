/**
 * `crypto.randomUUID()` only exists on secure contexts (HTTPS, or localhost).
 * This app is also served over plain HTTP in some deployments
 * (e.g. http://<ip>:3100), where the call is `undefined` and throws
 * "crypto.randomUUID is not a function" — this is what crashed the POS
 * screen and cash in/out dialog on load. `crypto.getRandomValues` has no
 * such restriction, so we build a v4 UUID from it when the native helper
 * isn't available, and fall back further to Math.random for environments
 * with neither (very old browsers / certain test runners).
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last-resort fallback: not cryptographically strong, but this id is only
  // used as a client-generated idempotency key, never as a secret.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
