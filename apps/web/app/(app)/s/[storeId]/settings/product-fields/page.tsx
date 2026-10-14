import { redirect } from "next/navigation";
export default async function StoreProductFields({ params }: PageProps<"/s/[storeId]/settings/product-fields">) {
  await params;
  redirect("/org/catalog/fields");
}
