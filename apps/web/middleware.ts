import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CRM always links into POS as /{locale}/app/pos/... (the Product Contract navigation
 * template is fixed to /{locale}/app/<product>). POS itself has no locale segment in its
 * own routing — it reads the viewer's language from the `pos_locale` cookie instead
 * (see app/api/locale/route.ts) — so the locale CRM put in the URL would otherwise be
 * silently dropped by the rewrite in next.config.ts. This records it as the viewer's
 * locale before that rewrite runs, the same way a user picking a language in POS's own
 * UI would.
 */
const GATEWAY_ENTRY_PATH = /^\/(en|ar)\/app\/pos(?:\/|$)/;

export function middleware(request: NextRequest) {
  const match = GATEWAY_ENTRY_PATH.exec(request.nextUrl.pathname);
  if (!match) return NextResponse.next();

  const locale = match[1];
  if (request.cookies.get("pos_locale")?.value === locale) return NextResponse.next();

  const response = NextResponse.next();
  const isHttps = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")) === "https";
  response.cookies.set("pos_locale", locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = {
  matcher: ["/(en|ar)/app/pos", "/(en|ar)/app/pos/:path*"],
};
