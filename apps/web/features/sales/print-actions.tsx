"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export const invoicePdfUrl = (storeId: string, saleId: string) => `/api/proxy/pos/v1/sales/${saleId}/invoice.pdf?storeId=${encodeURIComponent(storeId)}`;

export function PrintActions({ storeId, saleId, receipt }: { storeId: string; saleId: string; receipt?: string }) {
  function print(size: "80mm" | "A4") {
    const style = document.createElement("style");
    style.textContent = `@media print { @page { size: ${size} auto; margin: ${size === "80mm" ? "4mm" : "12mm"}; } }`;
    document.head.appendChild(style);
    const cleanup = () => { style.remove(); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }
  return <div className="flex gap-2 print:hidden">
    <Button asChild><a href={invoicePdfUrl(storeId, saleId)} target="_blank" rel="noreferrer" download={`${receipt || "invoice"}.pdf`}><Download /> <LocalizedText value={"Download invoice (PDF)"} /></a></Button>
    <Button variant="outline" onClick={() => print("80mm")}><LocalizedText value={"Print 80 mm"} /></Button>
  </div>;
}
