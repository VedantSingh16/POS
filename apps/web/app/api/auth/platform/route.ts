import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions } from "@/lib/server/cookies";
import { apiFetch, LOCK_COOKIE, SESSION_COOKIE } from "@/lib/server/session";
import { landingPath, safeNext, type Me } from "@/lib/permissions";

const PLATFORM_API_URL = (process.env.PLATFORM_API_URL ?? "http://localhost:4011").replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next")) ?? "/";
  const crmToken = (await cookies()).get("deltcrm_access")?.value;
  if (!crmToken) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, req.url));
  // The CRM guard requires the workspace header. This value is only a routing
  // hint decoded from the signed CRM session; CRM remains the authority and
  // validates the token/header pair before issuing the POS token.
  const tenantId = (() => {
    try {
      const payload = JSON.parse(Buffer.from(crmToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { tenantId?: unknown };
      return typeof payload.tenantId === "string" ? payload.tenantId : undefined;
    } catch {
      return undefined;
    }
  })();
  if (!tenantId) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}&error=crm-session`, req.url));

  const tokenResponse = await fetch(`${PLATFORM_API_URL}/product-integration/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${crmToken}`, "x-tenant-id": tenantId },
    body: JSON.stringify({ productKey: "POS" }),
    cache: "no-store",
  }).catch(() => null);
  if (!tokenResponse?.ok) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}&error=crm-pos-unavailable`, req.url));

  const tokenPayload = (await tokenResponse.json()) as { accessToken?: string; expiresIn?: number };
  if (!tokenPayload.accessToken) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}&error=crm-pos-token`, req.url));
  const meResponse = await apiFetch("/auth/me", { token: tokenPayload.accessToken });
  if (!meResponse.ok) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}&error=crm-pos-access`, req.url));
  const me = (await meResponse.json()) as Me;
  const response = NextResponse.redirect(new URL(next === "/" ? landingPath(me) : next, req.url));
  response.cookies.set(SESSION_COOKIE, tokenPayload.accessToken, cookieOptions(req, Math.max(60, tokenPayload.expiresIn ?? 900)));
  const preferredLocale = me.user.preferredLocale === "ar" ? "ar" : "en";
  response.cookies.set("pos_locale", preferredLocale, cookieOptions(req, 60 * 60 * 24 * 365));
  response.cookies.delete(LOCK_COOKIE);
  return response;
}
