import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ReturnsTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Returns" };

export default async function Page({ params }: PageProps<"/s/[storeId]/returns">) {
  const { storeId } = await params;
  await requirePermission("refund.view", storeId);
  const { data } = await api.returns(storeId);
  return (
    <>
      <PageHeader title="Returns" description="Credit notes issued against sales." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Returns" }]} actions={<Link href={`/s/${storeId}/returns/new`} className={buttonVariants()}><Plus /> New return</Link>} />
      <ReturnsTable data={data} />
    </>
  );
}
