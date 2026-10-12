import "server-only";
import type { NextRequest } from "next/server";
import { LOCK_COOKIE, SESSION_COOKIE } from "./session";

/** Secure cookies whenever the request arrived over HTTPS (directly or via a TLS-terminating proxy). */
export function isHttps(req: NextRequest): boolean {
  return (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
}

export function cookieOptions(req: NextRequest, maxAgeSeconds?: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: isHttps(req), path: "/", ...(maxAgeSeconds ? { maxAge: maxAgeSeconds } : {}) };
}

/** Browsers send an Origin on cross-site writes; refuse any that is not this site (defence in depth on top of SameSite=Lax). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}

export { LOCK_COOKIE, SESSION_COOKIE };
