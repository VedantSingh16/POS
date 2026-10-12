import { describe, expect, it } from "vitest";
import { filterCatalogProducts } from "../../features/catalog/product-filters";

const rows = [
  { id: "1", categoryId: "cat-a", brand: "Acme", status: "ACTIVE", taxGroupId: "gst-5" },
  { id: "2", categoryId: "cat-a", brand: "Acme", status: "DISCONTINUED", taxGroupId: "gst-12" },
  { id: "3", categoryId: "cat-b", brand: "Other", status: "ACTIVE", taxGroupId: "gst-5" },
];

describe("catalog product filters", () => {
  it("filters category, brand, status and tax group independently", () => {
    expect(filterCatalogProducts(rows, { categoryId: "cat-b" }).map((row) => row.id)).toEqual(["3"]);
    expect(filterCatalogProducts(rows, { brand: "Acme" }).map((row) => row.id)).toEqual(["1", "2"]);
    expect(filterCatalogProducts(rows, { status: "DISCONTINUED" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterCatalogProducts(rows, { taxGroupId: "gst-12" }).map((row) => row.id)).toEqual(["2"]);
  });

  it("combines all selected filters with AND semantics and leaves all rows when unset", () => {
    expect(filterCatalogProducts(rows, { categoryId: "cat-a", brand: "Acme", status: "ACTIVE", taxGroupId: "gst-5" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterCatalogProducts(rows, {})).toEqual(rows);
  });
});
