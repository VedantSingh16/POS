import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { NewStoreSheet } from "@/features/forms";
import { StoresTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Stores" };

export default async function StoresPage() {
  await requirePermission("stores.view");
  const [{ data }, { data: org }] = await Promise.all([api.stores(), api.org()]);
  const activeCount = data.filter((store) => store.status === "ACTIVE").length;
  return (
    <>
      <PageHeader title="Stores" description="Every store in the organisation, who manages it, and whether it is ready to trade. Open a store to manage its team and registers." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Stores" }]} actions={<NewStoreSheet used={activeCount} max={org.maxStores} />} />
      <StoresTable data={data} />
    </>
  );
}
