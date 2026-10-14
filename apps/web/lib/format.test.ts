import { describe, expect, it } from "vitest";
import { currencyCode, formatMoney, minorPerUnit, setActiveCurrency, toInput, toMinor } from "./format";

describe("organisation currency formatting", () => {
  it("uses the Omani rial with three decimals by default", () => {
    setActiveCurrency(undefined);
    expect(currencyCode()).toBe("OMR");
    expect(minorPerUnit()).toBe(1000);
    expect(toMinor("12.5")).toBe(12500);
    expect(toInput(12500)).toBe("12.500");
    expect(formatMoney(12500)).toContain("12.500");
  });
  it("switches to two-decimal rupees when the organisation chooses INR", () => {
    setActiveCurrency("INR");
    expect(minorPerUnit()).toBe(100);
    expect(toMinor("99.66")).toBe(9966);
    expect(toInput(9966)).toBe("99.66");
    setActiveCurrency(undefined);
  });
});
