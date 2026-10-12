import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, sameOrigin } from "@/lib/server/cookies";
import { apiFetch, LOCK_COOKIE, SESSION_COOKIE } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Cross-site request refused" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const upstream = await apiFetch("/auth/organizations/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "The server could not be reached. Try again." }, { status: 502 });

  const payload = await upstream.json().catch(() => ({})) as { accessToken?: string; expiresAt?: string; message?: string };
  if (!upstream.ok) return NextResponse.json({ message: payload.message ?? "Registration failed" }, { status: upstream.status });
  if (!payload.accessToken || !payload.expiresAt) return NextResponse.json({ message: "Registration returned an invalid session" }, { status: 502 });

  const maxAge = Math.max(60, Math.floor((new Date(payload.expiresAt).getTime() - Date.now()) / 1000));
  const response = NextResponse.json({ landing: "/onboarding/welcome" }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, payload.accessToken, cookieOptions(req, maxAge));
  response.cookies.delete(LOCK_COOKIE);
  return response;
}
