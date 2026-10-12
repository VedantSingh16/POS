import Link from "next/link";
import { EmptyState } from "@/components/data/primitives";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return <EmptyState title="Page not found" description="The record may have been removed, or you may not have access to it." action={<Link href="/org" className={buttonVariants({ variant: "outline" })}>Back to overview</Link>} />;
}
