import { describe, expect, it } from "vitest";
import { buildVariantCombinations } from "../../features/catalog/variant-builder";

describe("catalog variant builder", () => {
  it("generates the Cartesian product with deterministic unique keys and readable labels", () => {
    const variants = buildVariantCombinations([
      { name: "Color", values: "Blue, Red" },
      { name: "Size", values: "S, M" },
    ]);
    expect(variants).toHaveLength(4);
    expect(variants.map((variant) => variant.label)).toEqual([
      "Color: Blue / Size: S",
      "Color: Blue / Size: M",
      "Color: Red / Size: S",
      "Color: Red / Size: M",
    ]);
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(4);
  });

  it("trims names and option values", () => {
    expect(buildVariantCombinations([{ name: " Size ", values: " S, M " }]).map((variant) => variant.label)).toEqual(["Size: S", "Size: M"]);
  });

  it("keeps an edited row's identity when option order changes", () => {
    const before = buildVariantCombinations([{ name: "Size", values: "S, M" }]);
    const after = buildVariantCombinations([{ name: "Size", values: "M, S" }]);
    expect(after.find((variant) => variant.label === "Size: S")?.key).toBe(before.find((variant) => variant.label === "Size: S")?.key);
  });

  it.each([
    ["no attributes", []],
    ["blank attribute name", [{ name: " ", values: "One" }]],
    ["blank options", [{ name: "Size", values: " , " }]],
    ["duplicate option values", [{ name: "Size", values: "S, S" }]],
    ["duplicate attribute names", [{ name: "Size", values: "S" }, { name: " size ", values: "M" }]],
  ])("does not generate variants for %s", (_label, attributes) => {
    expect(buildVariantCombinations(attributes)).toEqual([]);
  });
});
