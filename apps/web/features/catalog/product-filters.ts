export type CatalogFilterableProduct = {
  categoryId?: string | null;
  brand?: string;
  productTypeName?: string;
  inStore?: boolean;
  status: string;
};

export type CatalogProductFilters = {
  categoryId?: string;
  brand?: string;
  productTypeName?: string;
  storeAssignment?: "IN_STORE" | "NOT_IN_STORE";
  status?: string;
};

export function filterCatalogProducts<T extends CatalogFilterableProduct>(products: T[], filters: CatalogProductFilters): T[] {
  return products.filter((product) =>
    (!filters.categoryId || product.categoryId === filters.categoryId) &&
    (!filters.brand || product.brand === filters.brand) &&
    (!filters.productTypeName || product.productTypeName === filters.productTypeName) &&
    (filters.storeAssignment === undefined || product.inStore === (filters.storeAssignment === "IN_STORE")) &&
    (!filters.status || product.status === filters.status));
}
