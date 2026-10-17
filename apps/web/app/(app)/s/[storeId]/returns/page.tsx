import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { ReturnsTable } from "@/features/tables";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Returns") }; }

export default async function Page({ params }: PageProps<"/s/[storeId]/returns">) {
  const { storeId } = await params;
  await requirePermission("refund.view", storeId);
  const { data } = await api.returns(storeId);
  return (
    <>
      <PageHeader title="Returns" description="Credit notes issued against sales." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Returns" }]} actions={<Link href={`/s/${storeId}/returns/new`} className={buttonVariants()}><Plus /> <LocalizedText value={"New return"} /></Link>} />
      <ReturnsTable data={data} />
    </>
  );
}
