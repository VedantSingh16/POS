import { redirect } from "next/navigation";
import { canAccessStore } from "@/lib/permissions";
import { requireSession } from "@/lib/server/session";

export default async function StoreLayout({ children, params }: LayoutProps<"/s/[storeId]">) {
  const { storeId } = await params;
  const me = await requireSession();
  if (!canAccessStore(me, storeId)) redirect("/forbidden");
  return <>{children}</>;
}
