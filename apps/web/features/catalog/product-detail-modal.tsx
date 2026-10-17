"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

export function ProductDetailModal({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const router = useRouter();
  return <Sheet open onOpenChange={(open) => { if (!open) router.back(); }}>
    <SheetContent size="xl" aria-describedby={description ? undefined : "product-detail-description"}>
      <SheetTitle>{title}</SheetTitle>
      <SheetDescription id="product-detail-description">{description ?? "Product details"}</SheetDescription>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </SheetContent>
  </Sheet>;
}
