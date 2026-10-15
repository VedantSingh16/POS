import { NextResponse } from "next/server";
import { isLocale } from "@/lib/i18n/messages";
import { apiFetch, SESSION_COOKIE } from "@/lib/server/session";
import { cookieOptions, sameOrigin } from "@/lib/server/cookies";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const locale = typeof body === "object" && body !== null && "locale" in body ? body.locale : undefined;
  if (!isLocale(locale)) return NextResponse.json({ error: "Unsupported language" }, { status: 400 });

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const upstream = await apiFetch("/auth/profile", {
      method: "PATCH",
      token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferredLocale: locale }),
    }).catch(() => null);
    if (!upstream?.ok) return NextResponse.json({ error: "Could not save language preference" }, { status: upstream?.status ?? 502 });
  }

  const response = NextResponse.json({ locale });
  response.cookies.set("pos_locale", locale, cookieOptions(request, 60 * 60 * 24 * 365));
  return response;
}
