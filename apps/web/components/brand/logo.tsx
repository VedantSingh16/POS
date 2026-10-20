import Image from "next/image";
import { cn } from "@/lib/utils";
import logoColor from "./assets/liqaa-pos-logo-color.png";
import logoWhite from "./assets/liqaa-pos-logo-white.png";
import markBlue from "./assets/liqaa-pos-mark-blue.png";
import markWhite from "./assets/liqaa-pos-mark-white.png";

/*
 * Liqaa POS brand artwork (brand guidelines, Oct 2026).
 * - Images are static imports so they are served from /_next/static and follow `assetPrefix`
 *   when the app runs behind the platform gateway; files in /public would not.
 * - `unoptimized` keeps that static URL (the image optimiser endpoint is not prefixed).
 * - Never stretch the artwork: width is always derived from the source aspect ratio.
 * - Guideline minimums: full logo 160px wide, symbol 32px high.
 * - The brand name is not translated, so the alt text stays "Liqaa POS" in every locale.
 */

const BRAND_NAME = "Liqaa POS";
const LOGO_RATIO = logoColor.width / logoColor.height;
const MARK_RATIO = markBlue.width / markBlue.height;

type Tone = "color" | "white" | "auto";

type ArtworkProps = {
  /** "auto" shows the colour artwork in light mode and the white artwork in dark mode. */
  tone?: Tone;
  height?: number;
  className?: string;
  /** Hide from assistive technology when an adjacent element already names the brand. */
  decorative?: boolean;
};

function Artwork({ light, dark, ratio, tone, height, className, decorative }: Required<Pick<ArtworkProps, "tone" | "height">> & Omit<ArtworkProps, "tone" | "height"> & { light: typeof logoColor; dark: typeof logoColor; ratio: number }) {
  const width = Math.round(height * ratio);
  const alt = decorative ? "" : BRAND_NAME;
  const common = { width, height, unoptimized: true, draggable: false } as const;
  const base = "block max-w-none shrink-0 select-none";
  if (tone === "auto") {
    return (
      <span className={cn("inline-flex shrink-0", className)}>
        <Image {...common} src={light} alt={alt} className={cn(base, "dark:hidden")} />
        {/* Only the visible copy is announced: display:none removes the other from the accessibility tree. */}
        <Image {...common} src={dark} alt={alt} className={cn(base, "hidden dark:block")} />
      </span>
    );
  }
  return <Image {...common} src={tone === "white" ? dark : light} alt={alt} className={cn(base, className)} />;
}

/** Full horizontal lockup: symbol + "liqaa" + "POS". */
export function Logo({ tone = "color", height = 40, className, decorative }: ArtworkProps) {
  return <Artwork light={logoColor} dark={logoWhite} ratio={LOGO_RATIO} tone={tone} height={height} className={className} decorative={decorative} />;
}

/** Symbol only, for compact spaces such as the checkout top bar. */
export function LogoMark({ tone = "color", height = 32, className, decorative }: ArtworkProps) {
  return <Artwork light={markBlue} dark={markWhite} ratio={MARK_RATIO} tone={tone} height={height} className={className} decorative={decorative} />;
}
