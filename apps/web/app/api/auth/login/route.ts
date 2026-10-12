import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, sameOrigin } from "@/lib/server/cookies";
import { apiFetch, LOCK_COOKIE, SESSION_COOKIE } from "@/lib/server/session";
import { landingPath, safeNext, type Me } from "@/lib/permissions";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Cross-site request refused" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; organizationSlug?: unknown; next?: unknown };
  const upstream = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password, organizationSlug: body.organizationSlug }),
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "The server could not be reached. Try again." }, { status: 502 });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    // Pass through the API's message and the ORGANISATION_REQUIRED picker data; nothing else.
    const { message, code, organisations } = payload as { message?: string; code?: string; organisations?: unknown };
    return NextResponse.json({ message: message ?? "Sign-in failed", code, organisations }, { status: upstream.status });
  }

  const { accessToken, expiresAt } = payload as { accessToken: string; expiresAt: string };
  const meRes = await apiFetch("/auth/me", { token: accessToken });
  const me = (await meRes.json()) as Me;
  const maxAge = Math.max(60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const landing = me.onboardingRequired && me.user.isOrganisationAdministrator
    ? landingPath(me)
    : safeNext(typeof body.next === "string" ? body.next : null) ?? landingPath(me);
  const res = NextResponse.json({ landing });
  res.cookies.set(SESSION_COOKIE, accessToken, cookieOptions(req, maxAge));
  res.cookies.delete(LOCK_COOKIE);
  return res;
}
