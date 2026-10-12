import Link from "next/link";
import { cn } from "@/lib/utils";

/** The two ways into the product, always visible so a new business never has to hunt for registration. */
export function AuthTabs({ active }: { active: "login" | "register" }) {
  const tab = "flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium";
  return (
    <nav aria-label="Account" className="flex gap-1 rounded-lg bg-muted p-1">
      <Link href="/login" aria-current={active === "login" ? "page" : undefined} className={cn(tab, active === "login" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>Sign in</Link>
      <Link href="/register" aria-current={active === "register" ? "page" : undefined} className={cn(tab, active === "register" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>Create organisation</Link>
    </nav>
  );
}
