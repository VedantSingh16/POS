import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, sameOrigin } from "@/lib/server/cookies";
import { LOCK_COOKIE, getSession } from "@/lib/server/session";

/** Locks the till screen. The API session stays valid; only a PIN (or signing in again) clears the lock. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Cross-site request refused" }, { status: 403 });
  const me = await getSession();
  if (!me) return NextResponse.json({ message: "Not signed in" }, { status: 401 });
  if (!me.hasPin) return NextResponse.json({ message: "Set a PIN before locking the till" }, { status: 409 });
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(LOCK_COOKIE, "1", cookieOptions(req));
  return res;
}
