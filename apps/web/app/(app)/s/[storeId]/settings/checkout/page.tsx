import { redirect } from "next/navigation";
export default async function CheckoutSettings({ params }: PageProps<"/s/[storeId]/settings/checkout">) {
  const { storeId } = await params;
  redirect(`/s/${storeId}/settings/billing#checkout-fields`);
}
