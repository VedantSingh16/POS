import { BrandMark } from "@/components/brand/brand-mark";

export function AuthBrand() {
  return (
    <div className="inline-flex items-center gap-3 text-auth-ink" role="img" aria-label="DeltCRM POS">
      <BrandMark />
      <span className="inline-flex items-center gap-2">
        <span className="font-display text-[21px] font-extrabold leading-none tracking-[-0.055em]">DeltCRM</span>
        <span className="inline-flex items-center rounded-[6px] border border-auth-primary/15 bg-auth-primary/[0.06] px-1.5 py-1 font-sans text-[9px] font-extrabold leading-none tracking-[0.12em] text-auth-primary">POS</span>
      </span>
    </div>
  );
}
