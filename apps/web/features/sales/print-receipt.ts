"use client";
import { clientApi } from "@/features/client-api";
import { fitRollPage, receiptHtml, type ReceiptData, type ReceiptOptions } from "@/features/sales/receipt-html";

export type PrintOutcome = "printed" | "timeout" | "failed";

/** Where a device remembers whether the cashier wants receipts printed. */
export const printPreferenceKey = (storeId: string) => `pos.printReceipt.${storeId}`;
export function readPrintPreference(storeId: string): boolean | null {
  try {
    const value = localStorage.getItem(printPreferenceKey(storeId));
    return value === null ? null : value === "1";
  } catch { return null; }
}
export function savePrintPreference(storeId: string, on: boolean): void {
  try { localStorage.setItem(printPreferenceKey(storeId), on ? "1" : "0"); } catch { /* storage blocked: preference is not remembered */ }
}

/**
 * Prints an HTML document from a hidden iframe and resolves when the browser print finishes.
 * The page the cashier is on never navigates away. With Chrome started using `--kiosk-printing`
 * the job goes to the default printer without a dialog.
 */
export function printHtml(html: string, { timeoutMs = 60_000 }: { timeoutMs?: number } = {}): Promise<PrintOutcome> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.title = "Receipt";
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", opacity: "0", pointerEvents: "none" });
    let settled = false;
    const finish = (outcome: PrintOutcome) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // Remove after the print spooler has read the document.
      window.setTimeout(() => frame.remove(), 1000);
      resolve(outcome);
    };
    const timer = window.setTimeout(() => finish("timeout"), timeoutMs);
    frame.onload = async () => {
      const win = frame.contentWindow;
      if (!win) { finish("failed"); return; }
      try {
        await win.document.fonts?.ready;
        fitRollPage(win.document);
        win.addEventListener("afterprint", () => finish("printed"), { once: true });
        win.focus();
        win.print();
        // Browsers that block until the dialog closes (Chrome) have finished printing here.
        window.setTimeout(() => finish("printed"), 500);
      } catch { finish("failed"); }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export async function loadReceipt(saleId: string): Promise<ReceiptData> {
  return clientApi<ReceiptData>(`/pos/v1/sales/${encodeURIComponent(saleId)}/receipt`);
}

/**
 * Loads the server's receipt for a completed sale, prints it, then records the print.
 * Never throws: printing must not interfere with the sale, which is already final.
 */
export async function printReceipt(saleId: string, options: ReceiptOptions = {}): Promise<{ outcome: PrintOutcome; printCount?: number; error?: string }> {
  let data: ReceiptData;
  try { data = await loadReceipt(saleId); }
  catch (error) { return { outcome: "failed", error: error instanceof Error ? error.message : "Could not load the receipt" }; }
  const copies = options.copies ?? data.settings.copies;
  const outcome = await printHtml(receiptHtml(data, { ...options, copies }));
  if (outcome !== "printed") return { outcome };
  try {
    const recorded = await clientApi<{ printCount: number }>(`/pos/v1/sales/${encodeURIComponent(saleId)}/printed`, { method: "POST", body: JSON.stringify({ copies, channel: "BROWSER" }) });
    return { outcome, printCount: recorded.printCount };
  } catch { return { outcome }; }
}
