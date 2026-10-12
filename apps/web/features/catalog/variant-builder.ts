export type VariantAttribute = { name: string; values: string };
export type VariantCombination = { key: string; label: string };

export function buildVariantCombinations(attributes: VariantAttribute[]): VariantCombination[] {
  if (attributes.length === 0) return [];
  const axes = attributes.map((attribute) => ({
    name: attribute.name.trim(),
    values: attribute.values.split(",").map((value) => value.trim()).filter(Boolean),
  }));
  if (axes.some((axis) => !axis.name || axis.values.length === 0 || new Set(axis.values).size !== axis.values.length)) return [];
  if (new Set(axes.map((axis) => axis.name.toLocaleLowerCase())).size !== axes.length) return [];

  return axes.reduce<VariantCombination[]>((rows, axis) => rows.flatMap((row) => axis.values.map((value) => ({
    label: row.label ? `${row.label} / ${axis.name}: ${value}` : `${axis.name}: ${value}`,
    key: row.key ? `${row.key}|${encodeURIComponent(axis.name)}=${encodeURIComponent(value)}` : `${encodeURIComponent(axis.name)}=${encodeURIComponent(value)}`,
  }))), [{ label: "", key: "" }]);
}
