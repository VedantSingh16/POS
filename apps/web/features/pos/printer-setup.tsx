"use client";
import * as React from "react";
import { CheckCircle2, Printer } from "lucide-react";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { clientApi } from "@/features/client-api";
import { printHtml } from "@/features/sales/print-receipt";
import { receiptHtml, sampleReceipt, type ReceiptPaper } from "@/features/sales/receipt-html";
import { currencyCode, currencyDecimals } from "@/lib/format";
import { toast } from "@/lib/i18n/toast";
import { cn } from "@/lib/utils";

export type PrinterProfile = { paper: ReceiptPaper | null; setupConfirmedAt: string | null; setupConfirmedBy: string | null };

const CHOICES: { paper: ReceiptPaper; title: string; hint: string }[] = [
  { paper: "80mm", title: "80 mm receipt printer", hint: "Most counter receipt printers (Epson TM-T20/T82/m30, Star TSP100, Xprinter)." },
  { paper: "58mm", title: "58 mm receipt printer", hint: "Small and mobile receipt printers." },
  { paper: "A4", title: "A4 office printer", hint: "A normal sheet printer. Use Invoice PDF for a full A4 tax invoice." },
];

/** The paper-size name to pick in Chrome's print dialog for each printer type. */
const PAPER_NAME: Record<ReceiptPaper, string> = {
  "80mm": "Paper size: \"Roll Paper 80 x 297 mm\" (Epson: \"80 x Receipt\", Star: \"72mm x Receipt\")",
  "58mm": "Paper size: \"Roll Paper 58 x 297 mm\" (Epson: \"58 x Receipt\")",
  A4: "Paper size: A4",
};

const PROBLEMS: { symptom: string; fix: string }[] = [
  { symptom: "A small receipt in the middle of a large page", fix: "The wrong printer is selected (for example Save as PDF or Microsoft Print to PDF), or the printer's driver is set to A4/Letter. Choose the receipt printer and its roll paper size." },
  { symptom: "Date, receipt number or web address printed at the top or bottom", fix: "Turn off Headers and footers under More settings, and set Margins to None." },
  { symptom: "The right side is cut off", fix: "The paper is narrower than the printer type chosen above. Choose 58 mm receipt printer and test again." },
  { symptom: "Very small text", fix: "Set Scale to Default (100). \"Fit to page\" shrinks the receipt when the paper size is wrong." },
  { symptom: "No roll paper size in the list", fix: "Open Windows Settings → Printers & scanners → the receipt printer → Printing preferences, and choose roll paper 80 mm (or 58 mm) on the Layout or Paper tab. Then restart Chrome." },
];

type Step = "choose" | "test" | "check" | "help";

export function PrinterSetupDialog({ open, onOpenChange, registerId, registerName, store, profile, defaultPaper, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; registerId: string; registerName: string;
  store: { name: string; taxNumber?: string }; profile: PrinterProfile | null; defaultPaper: ReceiptPaper; onSaved: (profile: PrinterProfile) => void;
}) {
  const [step, setStep] = React.useState<Step>("choose");
  const [paper, setPaper] = React.useState<ReceiptPaper>(profile?.paper ?? defaultPaper);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // Start again each time the dialog opens, from what this till has saved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep("choose"); setPaper(profile?.paper ?? defaultPaper);
  }, [open, profile?.paper, defaultPaper]);

  async function save(patch: { paper?: ReceiptPaper; confirmed?: boolean }): Promise<PrinterProfile | null> {
    setBusy(true);
    try {
      const saved = await clientApi<PrinterProfile>(`/pos/v1/registers/${encodeURIComponent(registerId)}/printer`, { method: "PATCH", body: JSON.stringify(patch) });
      onSaved({ paper: saved.paper, setupConfirmedAt: saved.setupConfirmedAt, setupConfirmedBy: saved.setupConfirmedBy });
      return saved;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the printer setting");
      return null;
    } finally { setBusy(false); }
  }

  async function testPrint() {
    if (!(await save({ paper }))) return;
    const sample = sampleReceipt({ name: store.name, taxNumber: store.taxNumber, currency: currencyCode(), decimals: currencyDecimals() },
      { paper, autoPrint: "ASK", language: "en", copies: 1, showTaxBreakdown: true }, { header: "", footer: "" });
    const outcome = await printHtml(receiptHtml(sample, { test: true, paper }));
    if (outcome === "failed") toast.error("Could not open the print dialog.");
    setStep("check");
  }

  async function confirm() {
    if (await save({ confirmed: true })) { toast.success("Receipt printer set up on this till"); onOpenChange(false); }
  }

  const choice = CHOICES.find((entry) => entry.paper === paper)!;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg">
    <DialogTitle><LocalizedText value={"Receipt printer setup"} /></DialogTitle>
    <DialogDescription><LocalizedText value={"Do this once on each till. The browser cannot change the paper in the printer, so the printer and the print dialog must match the receipt."} /></DialogDescription>
    {registerName && <p className="-mt-2 text-sm"><span className="text-muted-foreground"><LocalizedText value={"Till:"} /></span> <span className="font-medium">{registerName}</span></p>}

    {step === "choose" && <div className="grid gap-3">
      <p className="text-sm font-medium"><LocalizedText value={"What is connected to this till?"} /></p>
      <div role="radiogroup" aria-label="Printer type" className="grid gap-2">{CHOICES.map((entry) => <button key={entry.paper} type="button" role="radio" aria-checked={paper === entry.paper} onClick={() => setPaper(entry.paper)} className={cn("rounded-md border p-3 text-start text-sm hover:bg-muted", paper === entry.paper && "border-primary bg-accent")}><span className="block font-semibold"><LocalizedText value={entry.title} /></span><span className="block text-xs text-muted-foreground"><LocalizedText value={entry.hint} /></span></button>)}</div>
      <div className="flex justify-end"><Button onClick={() => setStep("test")}><LocalizedText value={"Next"} /></Button></div>
    </div>}

    {step === "test" && <div className="grid gap-3 text-sm">
      <p className="font-medium"><LocalizedText value={"Set up Chrome's print dialog once"} /> <span className="text-muted-foreground">· <LocalizedText value={choice.title} /></span></p>
      <ol className="grid list-decimal gap-1.5 ps-5">
        <li><LocalizedText value={"Destination: your receipt printer. Not \"Save as PDF\" or \"Microsoft Print to PDF\"."} /></li>
        <li><LocalizedText value={"Open \"More settings\"."} /></li>
        <li><LocalizedText value={PAPER_NAME[paper]} /></li>
        <li><LocalizedText value={paper === "A4" ? "Margins: Default" : "Margins: None"} /></li>
        <li><LocalizedText value={"Headers and footers: off"} /></li>
        <li><LocalizedText value={"Scale: Default (100)"} /></li>
      </ol>
      <p className="text-xs text-muted-foreground"><LocalizedText value={"Chrome remembers these choices on this computer. Press Print test receipt, then make these settings in the print dialog that opens."} /></p>
      <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => setStep("choose")}><LocalizedText value={"Back"} /></Button><Button onClick={() => void testPrint()} disabled={busy}><Printer /> <LocalizedText value={"Print test receipt"} /></Button></div>
    </div>}

    {step === "check" && <div className="grid gap-3 text-sm">
      <p className="font-medium"><LocalizedText value={"Did the test receipt print correctly?"} /></p>
      <ul className="grid list-disc gap-1 ps-5 text-muted-foreground">
        <li><LocalizedText value={paper === "A4" ? "It is at the top of the sheet and easy to read." : "It uses the full width of the paper roll."} /></li>
        <li><LocalizedText value={"There is no date, receipt number or web address at the top or bottom."} /></li>
        <li><LocalizedText value={"Nothing is cut off on the right."} /></li>
      </ul>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setStep("help")}><LocalizedText value={"No, something is wrong"} /></Button><Button onClick={() => void confirm()} disabled={busy}><CheckCircle2 /> <LocalizedText value={"Yes, it printed correctly"} /></Button></div>
    </div>}

    {step === "help" && <div className="grid gap-3 text-sm">
      <p className="font-medium"><LocalizedText value={"What does the printout look like?"} /></p>
      <ul className="grid gap-2">{PROBLEMS.map((problem) => <li key={problem.symptom} className="rounded-md border p-3"><span className="block font-semibold"><LocalizedText value={problem.symptom} /></span><span className="block text-muted-foreground"><LocalizedText value={problem.fix} /></span></li>)}</ul>
      <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => setStep("choose")}><LocalizedText value={"Change printer type"} /></Button><Button onClick={() => void testPrint()} disabled={busy}><Printer /> <LocalizedText value={"Print test receipt again"} /></Button></div>
    </div>}
  </DialogContent></Dialog>;
}
