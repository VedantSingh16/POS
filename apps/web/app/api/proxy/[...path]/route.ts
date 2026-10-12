import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/server/cookies";
import { API_URL, LOCK_COOKIE, sessionToken } from "@/lib/server/session";

// Browser → this route → API. The session token lives in an httpOnly cookie and is attached here,
// so page JavaScript never sees it. Only these API areas are reachable through the proxy.
const ALLOWED = [/^admin\//, /^pos\/v1\//, /^auth\/(me|pin|profile)$/];
const FORWARD_HEADERS = ["content-type", "x-store-id", "idempotency-key"];

async function handle(req: NextRequest, ctx: RouteContext<"/api/proxy/[...path]">) {
  const { path } = await ctx.params;
  const target = path.join("/");
  if (!ALLOWED.some((re) => re.test(target))) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const writing = req.method !== "GET" && req.method !== "HEAD";
  if (writing && !sameOrigin(req)) return NextResponse.json({ message: "Cross-site request refused" }, { status: 403 });

  const token = await sessionToken();
  if (!token) return NextResponse.json({ message: "Not signed in" }, { status: 401 });
  // The PIN lock protects the data too: while locked, only the unlock endpoint is callable.
  if (req.cookies.get(LOCK_COOKIE)?.value === "1") return NextResponse.json({ message: "Locked. Enter your PIN." }, { status: 423 });

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of FORWARD_HEADERS) { const v = req.headers.get(name); if (v) headers.set(name, v); }
  const upstream = await fetch(`${API_URL}/api/${target}${req.nextUrl.search}`, {
    method: req.method, headers, body: writing ? await req.text() : undefined, cache: "no-store",
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "The server could not be reached. Try again." }, { status: 502 });

  const out = new Headers();
  const type = upstream.headers.get("content-type");
  if (type) out.set("content-type", type);
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) out.set("content-disposition", disposition);
  return new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
