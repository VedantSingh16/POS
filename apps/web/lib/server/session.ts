import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setActiveCurrency } from "@/lib/format";
import { canAccessStore, hasOrgScope, hasPermission, landingPath, type Me } from "@/lib/permissions";

export const SESSION_COOKIE = "pos_session";
export const LOCK_COOKIE = "pos_locked";

/** Server-side base URL of the API (inside Docker: http://api:4000). Never exposed to the browser. */
export const API_URL = (process.env.API_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function apiFetch(path: string, init: RequestInit & { token?: string | null; storeId?: string } = {}): Promise<Response> {
  const { token, storeId, headers, ...rest } = init;
  return fetch(`${API_URL}/api${path}`, {
    cache: "no-store",
    ...rest,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(storeId ? { "x-store-id": storeId } : {}), ...(headers as Record<string, string> | undefined) },
  });
}

/** The signed-in user's profile, or null when there is no valid session. One API call per request. */
export const getSession = cache(async (): Promise<Me | null> => {
  const token = await sessionToken();
  if (!token) return null;
  try {
    const res = await apiFetch("/auth/me", { token });
    if (!res.ok) return null;
    const me = (await res.json()) as Me;
    setActiveCurrency(me.organisation.currency);
    return me;
  } catch {
    return null;
  }
});

export async function isLocked(): Promise<boolean> {
  return (await cookies()).get(LOCK_COOKIE)?.value === "1";
}

/** For protected pages: redirect to sign-in or the lock screen as needed. */
export async function requireSession(): Promise<Me> {
  const me = await getSession();
  if (!me) redirect("/login");
  if (await isLocked()) redirect("/lock");
  return me;
}

export async function requirePermission(code: string, storeId?: string): Promise<Me> {
  const me = await requireSession();
  if (storeId && !canAccessStore(me, storeId)) redirect("/forbidden");
  if (!hasPermission(me, code, storeId)) redirect("/forbidden");
  return me;
}

export async function requireOrgArea(): Promise<Me> {
  const me = await requireSession();
  if (!hasOrgScope(me)) redirect(landingPath(me));
  return me;
}
