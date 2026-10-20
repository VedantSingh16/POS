import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { landingPath } from "@/lib/permissions";
import { getSession, isLocked } from "@/lib/server/session";

export default async function Home() {
  const me = await getSession();
  if (!me) {
    // A CRM session is the browser-facing SSO hand-off. The API still verifies
    // the resulting product token and re-checks tenant entitlement on every request.
    if ((await cookies()).get("deltcrm_access")?.value) redirect("/api/auth/platform?next=/");
    redirect("/login");
  }
  if (await isLocked()) redirect("/lock");
  redirect(landingPath(me));
}
