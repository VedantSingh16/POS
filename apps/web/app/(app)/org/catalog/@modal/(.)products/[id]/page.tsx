import { notFound } from "next/navigation";
import { api } from "@/features/api";
import { ProductDetailModal } from "@/features/catalog/product-detail-modal";
import { OrganisationProductDetailPanel } from "@/features/catalog/product-detail-panel";

export default async function ProductModal({ params }: PageProps<"/org/catalog/products/[id]">) {
  const { id } = await params;
  const { data: product } = await api.product(id);
  if (!product) notFound();
  return <ProductDetailModal title={product.name} description="Product details, stock, and recent activity"><OrganisationProductDetailPanel product={product} /></ProductDetailModal>;
}
