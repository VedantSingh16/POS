"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function ConfirmDialog({ trigger, title, description, confirmLabel = "Confirm", destructive, onConfirm }: {
  trigger: React.ReactNode; title: string; description: string; confirmLabel?: string; destructive?: boolean; onConfirm: () => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle><LocalizedText value={title} /></DialogTitle>
        <DialogDescription><LocalizedText value={description} /></DialogDescription>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="outline"><LocalizedText value={"Cancel"} /></Button></DialogClose>
          <DialogClose asChild><Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}><LocalizedText value={confirmLabel} /></Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FormSheet({ trigger, title, description, children, open, onOpenChange, size }: { trigger: React.ReactNode; title: string; description?: string; children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; size?: "md" | "lg" | "xl" }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent size={size}>
        <div className="pe-8">
          <SheetTitle><LocalizedText value={title} /></SheetTitle>
          {description && <SheetDescription><LocalizedText value={description} /></SheetDescription>}
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}
