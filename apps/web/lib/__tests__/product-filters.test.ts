import { describe, expect, it } from "vitest";
import { filterCatalogProducts } from "../../features/catalog/product-filters";

const rows = [
  { id: "1", categoryId: "cat-a", brand: "Acme", productTypeName: "Packaged food", inStore: true, status: "ACTIVE" },
  { id: "2", categoryId: "cat-a", brand: "Acme", productTypeName: "Service", inStore: false, status: "DISCONTINUED" },
  { id: "3", categoryId: "cat-b", brand: "Other", productTypeName: "Packaged food", inStore: true, status: "ACTIVE" },
];

describe("catalog product filters", () => {
  it("filters category, product version, brand, store assignment, and status independently", () => {
    expect(filterCatalogProducts(rows, { categoryId: "cat-b" }).map((row) => row.id)).toEqual(["3"]);
    expect(filterCatalogProducts(rows, { brand: "Acme" }).map((row) => row.id)).toEqual(["1", "2"]);
    expect(filterCatalogProducts(rows, { productTypeName: "Packaged food" }).map((row) => row.id)).toEqual(["1", "3"]);
    expect(filterCatalogProducts(rows, { storeAssignment: "NOT_IN_STORE" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterCatalogProducts(rows, { status: "DISCONTINUED" }).map((row) => row.id)).toEqual(["2"]);
  });

  it("combines all selected filters with AND semantics and leaves all rows when unset", () => {
    expect(filterCatalogProducts(rows, { categoryId: "cat-a", brand: "Acme", status: "ACTIVE", productTypeName: "Packaged food" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterCatalogProducts(rows, {})).toEqual(rows);
  });
});
