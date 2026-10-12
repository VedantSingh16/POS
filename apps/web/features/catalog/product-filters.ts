export type CatalogFilterableProduct = {
  categoryId?: string | null;
  brand?: string;
  status: string;
  taxGroupId?: string | null;
};

export type CatalogProductFilters = {
  categoryId?: string;
  brand?: string;
  status?: string;
  taxGroupId?: string;
};

export function filterCatalogProducts<T extends CatalogFilterableProduct>(products: T[], filters: CatalogProductFilters): T[] {
  return products.filter((product) =>
    (!filters.categoryId || product.categoryId === filters.categoryId) &&
    (!filters.brand || product.brand === filters.brand) &&
    (!filters.status || product.status === filters.status) &&
    (!filters.taxGroupId || product.taxGroupId === filters.taxGroupId));
}
