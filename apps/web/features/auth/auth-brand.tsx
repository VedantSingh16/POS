import { LocalizedText } from "@/components/i18n/localized-text";
import { BrandMark } from "@/components/brand/brand-mark";

export function AuthBrand() {
  return (
    <div className="inline-flex items-center gap-3 text-auth-ink" role="img" aria-label="DeltPOS">
      <BrandMark />
      <span className="inline-flex items-center gap-2">
        <span className="font-sans text-[21px] font-bold leading-none tracking-tight"><LocalizedText value={"DeltPOS"} /></span>
        <span className="inline-flex items-center rounded-[6px] border border-auth-primary/15 bg-auth-primary/[0.06] px-1.5 py-1 font-sans text-[9px] font-extrabold leading-none tracking-[0.12em] text-auth-primary"><LocalizedText value={"POS"} /></span>
      </span>
    </div>
  );
}
