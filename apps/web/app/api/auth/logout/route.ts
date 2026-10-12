import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/server/cookies";
import { apiFetch, LOCK_COOKIE, SESSION_COOKIE, sessionToken } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Cross-site request refused" }, { status: 403 });
  const token = await sessionToken();
  if (token) await apiFetch("/auth/logout", { method: "POST", token }).catch(() => null);
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(LOCK_COOKIE);
  return res;
}
