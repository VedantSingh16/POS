import { notFound } from "next/navigation";
import { api } from "@/features/api";
import { ProductDetailModal } from "@/features/catalog/product-detail-modal";
import { StoreProductDetailPanel } from "@/features/catalog/product-detail-panel";

export default async function StoreProductModal({ params }: PageProps<"/s/[storeId]/products/[variantId]">) {
  const { storeId, variantId } = await params;
  let product;
  try {
    product = (await api.storeProduct(storeId, variantId)).data;
  } catch { notFound(); }
  return <ProductDetailModal title={product.name} description={`${product.variantName} · ${product.sku}`}><StoreProductDetailPanel product={product} /></ProductDetailModal>;
}
