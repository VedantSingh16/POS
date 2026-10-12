import { redirect } from "next/navigation";
import { LockScreen } from "@/features/auth/lock-screen";
import { landingPath } from "@/lib/permissions";
import { getSession, isLocked } from "@/lib/server/session";

export const metadata = { title: "Locked" };

export default async function LockPage() {
  const me = await getSession();
  if (!me) redirect("/login");
  if (!(await isLocked())) redirect(landingPath(me));
  return <LockScreen name={me.user.displayName} home={landingPath(me)} />;
}
