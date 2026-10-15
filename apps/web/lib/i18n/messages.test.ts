import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { arabicMessages, isLocale, translateText } from "./messages";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatTime, setActiveCurrency } from "../format";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".tsx") ? [path] : [];
  });
}

function localizedLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "LocalizedText") {
      const value = node.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === "value");
      const expression = value?.initializer && ts.isJsxExpression(value.initializer) ? value.initializer.expression : undefined;
      if (expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))) values.push(expression.text.replace(/\s+/g, " ").trim());
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === "toast") {
      const message = node.arguments[0];
      if (message && (ts.isStringLiteral(message) || ts.isNoSubstitutionTemplateLiteral(message))) values.push(message.text.replace(/\s+/g, " ").trim());
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
      const message = node.arguments[0];
      if (message && (ts.isStringLiteral(message) || ts.isNoSubstitutionTemplateLiteral(message))) values.push(message.text.replace(/\s+/g, " ").trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

function propLiterals(file: string, propertyNames: string[]): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && propertyNames.includes(node.name.getText(source)) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      values.push(node.initializer.text.replace(/\s+/g, " ").trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

function metadataTitleLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "generateMetadata" && statement.body) {
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "getLocalizedPageTitle") {
          const title = node.arguments[0];
          if (title && ts.isStringLiteral(title)) values.push(title.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(statement.body);
    }
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== "metadata" || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      const title = declaration.initializer.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === "title");
      if (title && ts.isPropertyAssignment(title) && ts.isStringLiteral(title.initializer)) values.push(title.initializer.text);
    }
  }
  return values;
}

function accessibilityLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["aria-label", "title", "placeholder", "alt"]);
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && names.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      values.push(node.initializer.text.replace(/\s+/g, " ").trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values.filter((value) => !/^\d+(?:\.\d+)?$/.test(value) && value !== "Asia/Kolkata" && value !== "northstar-retail" && value !== "TAX-YYYYMMDD-0000" && value !== "DAMAGED");
}

function attributeLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["description", "confirmLabel", "emptyTitle", "emptyDescription", "backLabel"]);
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && names.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      values.push(node.initializer.text.replace(/\s+/g, " ").trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

describe("English and Arabic locale support", () => {
  it("accepts only the supported locales and translates known text", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(translateText("Sign in", "ar")).toBe("تسجيل الدخول");
    expect(translateText("Sign in", "en")).toBe("Sign in");
    expect(translateText("Deactivate Store 1?", "ar")).toBe("هل تريد تعطيل Store 1؟");
    expect(translateText("Edit GST 5%", "ar")).toBe("تعديل GST 5%");
    expect(translateText("Store code S-01 · Jaipur", "ar")).toBe("رمز المتجر S-01 · Jaipur");
  });

  it("translates dynamic POS, register, catalogue, and billing labels", () => {
    const dynamicUiCopy = [
      "Pay", "Pricing…", "Save checkout fields", "Save product fields", "On shift",
      "Draft", "Active", "Discontinued", "Seasonal", "Blocked",
      "Cash", "Card", "UPI / QR", "Wallet", "Loyalty points", "Other", "Quick keys",
      "This code cannot be used", "This code does not exist", "This offer is switched off",
      "This offer has not started yet", "This offer has expired", "This offer has been used up",
      "This customer has already used this offer", "The bill is below the minimum for this offer",
      "No item in the cart qualifies", "A better offer was applied instead", "Received", "Declined",
      "Waiting for confirmation", "Charge through the payment gateway, or enter the slip reference above.",
      "Cash in", "Cash out", "Cash drop", "Pickup",
      "Money added to the drawer (e.g. change from the bank)", "Money taken out for an expense",
      "Moving surplus cash to the safe", "A manager collects cash from the drawer", "cashier",
      "Deactivated: it cannot be opened.", "Closed: no sales can be taken on this till.",
      "Identity", "Details", "Stock and pricing", "Field settings",
      "Payments and checkout", "Discount rules", "Held bills and loyalty", "Register controls",
      "Payment methods offered", "Allow line-item discounts", "Cashiers can discount an individual product on the bill.",
      "Customer picker", "Coupon code", "Discount controls", "Payment reference", "Split tender",
      "Line note", "Bill handler", "Payment method", "Cash tendered",
      "Attach a customer to the bill for purchase history and loyalty.",
      "Let the cashier enter a store offer or coupon code.",
      "Show controls for permitted item and bill discounts.",
      "Ask why a manual discount was applied.",
      "Record a UPI, card, or bank transaction reference.",
      "Allow one bill to be paid with more than one method.",
      "Add a note to an individual product line.",
      "Choose the staff member responsible for the bill.",
      "Choose how the customer pays. This stays available.",
      "Enter cash received and calculate change. This stays available.",
      "Cash rounding (INR, 0 = off)", "Loyalty point value (INR)",
      "Cash movement approval (INR)", "Cash count tolerance (INR)",
      "10% off", "₹12.50 off", "over ₹500.00", "Invoice INV-123",
      "Offers & coupons", "Price rules", "Discount reasons", "No offers yet.",
      "No price rules. Every item sells at its base price.", "No reasons yet. Cashiers can type a free-text reason.",
      "No stock on record", "Out of stock", `${formatNumber(3, "ar")} in stock`,
      "Wholesale customers", "from 3 units", "3 per customer", "price ₹12.50",
      "every item", "product", "category", "brand", "per item", "on each item", "per bill", "no GST", "prior",
    ];
    expect(dynamicUiCopy.filter((value) => translateText(value, "ar") === value)).toEqual([]);
  });

  it("formats dates in the selected locale and report time zone", () => {
    const value = "2026-10-16T12:34:00.000Z";
    const arabicDate = formatDateTime(value, "ar", "UTC");
    expect(arabicDate).toMatch(/[\u0600-\u06FF]/);
    expect(formatDate(value, "ar", "UTC")).toMatch(/[٠-٩]/);
    expect(formatDateTime(value, "en", "UTC")).not.toMatch(/[\u0600-\u06FF]/);
    expect(formatTime(value, "ar", "UTC")).toMatch(/[٠-٩]/);
    expect(formatTime(value, "en", "UTC")).not.toMatch(/[\u0600-\u06FF]/);
  });

  it("formats money and counts with Arabic numerals", () => {
    setActiveCurrency("INR");
    expect(formatMoney(12345, "ar")).toMatch(/[٠-٩]/);
    expect(formatNumber(1250, "ar")).toMatch(/[٠-٩]/);
    expect(translateText("Invoice INV-123", "ar")).toBe("الفاتورة INV-123");
    const amount = formatMoney(1250, "ar");
    expect(translateText(`${formatNumber(10, "ar")}% off`, "ar")).toBe("خصم ١٠٪");
    expect(translateText(`${amount} off`, "ar")).toBe(`خصم ${amount}`);
    expect(translateText(`over ${formatMoney(50000, "ar")}`, "ar")).toBe(`على فاتورة تتجاوز ${formatMoney(50000, "ar")}`);
    expect(translateText("Wholesale customers", "ar")).toBe("عملاء Wholesale");
    expect(translateText(`from ${formatNumber(3, "ar")} units`, "ar")).toBe("ابتداءً من ٣ وحدات");
    expect(translateText(`${formatNumber(3, "ar")} in stock`, "ar")).toBe("٣ في المخزون");
  });

  it("provides an Arabic translation for every static UI string", () => {
    const roots = ["app", "components", "features"].map((directory) => resolve(process.cwd(), directory));
    const files = roots.flatMap((root) => sourceFiles(root));
    const mappedText = files.flatMap((file) => localizedLiterals(file).concat(propLiterals(file, ["header", "label", "allLabel"]), accessibilityLiterals(file), attributeLiterals(file), metadataTitleLiterals(file)).filter(Boolean).filter((value) => !(value in arabicMessages)).map((value) => `${file}: ${value}`));
    const nav = resolve(process.cwd(), "lib/nav.ts");
    const navText = propLiterals(nav, ["title", "label", "group"]).filter(Boolean).filter((value) => !(value in arabicMessages)).map((value) => `${nav}: ${value}`);
    const missing = [...mappedText, ...navText];
    expect(missing).toEqual([]);
  }, 15_000);
});
