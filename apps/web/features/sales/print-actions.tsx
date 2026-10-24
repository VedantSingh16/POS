"use client";
import * as React from "react";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/i18n/toast";
import { printReceipt } from "@/features/sales/print-receipt";

export const invoicePdfUrl = (storeId: string, saleId: string) => `/api/proxy/pos/v1/sales/${saleId}/invoice.pdf?storeId=${encodeURIComponent(storeId)}`;

export function PrintActions({ storeId, saleId, receipt }: { storeId: string; saleId: string; receipt?: string }) {
  const [busy, setBusy] = React.useState(false);
  async function print() {
    setBusy(true);
    const result = await printReceipt(saleId);
    setBusy(false);
    if (result.outcome === "failed") toast.error(result.error ?? "Could not print the receipt");
    else if (result.outcome === "timeout") toast.warning("The printer did not respond. Check it and try again.");
  }
  return <div className="flex flex-wrap gap-2 print:hidden">
    <Button onClick={() => void print()} disabled={busy}><Printer /> <LocalizedText value={busy ? "Printing…" : "Print receipt"} /></Button>
    <Button asChild variant="outline"><a href={invoicePdfUrl(storeId, saleId)} target="_blank" rel="noreferrer" download={`${receipt || "invoice"}.pdf`}><Download /> <LocalizedText value={"Download invoice (PDF)"} /></a></Button>
  </div>;
}
