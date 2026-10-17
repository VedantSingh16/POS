import { redirect } from "next/navigation";
import { canAccessStore } from "@/lib/permissions";
import { requireSession } from "@/lib/server/session";

export default async function StoreLayout({ children, modal, params }: LayoutProps<"/s/[storeId]"> & { modal: React.ReactNode }) {
  const { storeId } = await params;
  const me = await requireSession();
  if (!canAccessStore(me, storeId)) redirect("/forbidden");
  return <>{children}{modal}</>;
}
