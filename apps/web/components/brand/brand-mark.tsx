import { Store } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  size?: "compact" | "default";
  className?: string;
};

export function BrandMark({ size = "default", className }: BrandMarkProps) {
  const compact = size === "compact";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center bg-auth-primary text-auth-on-primary shadow-sm ring-1 ring-inset ring-white/25",
        compact ? "size-7 rounded-[9px]" : "size-12 rounded-[15px]",
        className,
      )}
    >
      <Store className={compact ? "size-[16px]" : "size-[25px]"} strokeWidth={2.1} />
    </span>
  );
}
