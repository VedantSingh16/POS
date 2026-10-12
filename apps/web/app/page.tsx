import { redirect } from "next/navigation";
import { landingPath } from "@/lib/permissions";
import { getSession, isLocked } from "@/lib/server/session";

export default async function Home() {
  const me = await getSession();
  if (!me) redirect("/login");
  if (await isLocked()) redirect("/lock");
  redirect(landingPath(me));
}
