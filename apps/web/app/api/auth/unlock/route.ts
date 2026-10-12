import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/server/cookies";
import { apiFetch, LOCK_COOKIE, sessionToken } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Cross-site request refused" }, { status: 403 });
  const token = await sessionToken();
  if (!token) return NextResponse.json({ message: "Session expired. Sign in again." }, { status: 401, headers: { "x-session": "expired" } });
  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  const upstream = await apiFetch("/auth/unlock", { method: "POST", token, headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: body.pin }) }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "The server could not be reached. Try again." }, { status: 502 });
  if (!upstream.ok) {
    const payload = (await upstream.json().catch(() => ({}))) as { message?: string };
    // A 401 that is not about the PIN means the API session itself ended (idle timeout): tell the client to sign in again.
    const sessionEnded = upstream.status === 401 && /session/i.test(payload.message ?? "");
    return NextResponse.json({ message: payload.message ?? "Could not unlock", sessionEnded }, { status: upstream.status });
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(LOCK_COOKIE);
  return res;
}
