import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/data/primitives";
import { buttonVariants } from "@/components/ui/button";
import { landingPath } from "@/lib/permissions";
import { requireSession } from "@/lib/server/session";

export const metadata = { title: "No access" };

export default async function Forbidden() {
  const me = await requireSession();
  const home = landingPath(me);
  return <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Ask an organisation administrator if you need it." action={home === "/forbidden" ? undefined : <Link href={home} className={buttonVariants({ variant: "outline" })}>Go to my home page</Link>} />;
}
