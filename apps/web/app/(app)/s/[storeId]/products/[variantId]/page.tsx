import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { api } from "@/features/api";
import { StoreProductDetailPanel } from "@/features/catalog/product-detail-panel";
import { requirePermission } from "@/lib/server/session";

export default async function StoreProductDetail({ params }: PageProps<"/s/[storeId]/products/[variantId]">) {
  const { storeId, variantId } = await params;
  await requirePermission("catalog.view", storeId);
  let product;
  try {
    product = (await api.storeProduct(storeId, variantId)).data;
  } catch { notFound(); }
  return <><PageHeader title={product.name} crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Products", href: `/s/${storeId}/products` }, { label: product.name }]} backHref={`/s/${storeId}/products`} backLabel="Back to products" /><StoreProductDetailPanel product={product} /></>;
}
