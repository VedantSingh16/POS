import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export const TableHeader = (p: React.ComponentProps<"thead">) => <thead className="bg-secondary/45 [&_tr]:border-b" {...p} />;
export const TableBody = (p: React.ComponentProps<"tbody">) => <tbody className="[&_tr:last-child]:border-0" {...p} />;
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b transition-colors hover:bg-accent/35 data-[clickable=true]:cursor-pointer", className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-12 px-3.5 text-left align-middle text-sm font-semibold text-muted-foreground whitespace-nowrap", className)} {...props} />;
}
export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("h-(--table-row-height) px-3.5 py-2 align-middle", className)} {...props} />;
}
