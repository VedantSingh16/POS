import { LocalizedText } from "@/components/i18n/localized-text";
import type { ReactNode } from "react";
import Image from "next/image";
import { AuthBrand } from "@/features/auth/auth-brand";
import { LocaleSwitch } from "@/components/i18n/locale-switch";

function AuthLanguage() {
  return <LocaleSwitch className="border-auth-outline bg-auth-surface/90 text-auth-muted" />;
}

/** Sign-in split layout with a subdued product image. */
export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate grid min-h-screen overflow-x-clip bg-auth-canvas text-auth-ink lg:grid-cols-[minmax(0,1.06fr)_minmax(440px,0.94fr)]">
      <section className="relative flex min-h-[700px] flex-col px-6 pb-0 pt-7 sm:px-10 lg:min-h-screen lg:px-[clamp(40px,6.1vw,96px)] lg:py-8">
        <div className="relative z-10">
          <AuthBrand />
        </div>

        <div className="relative z-10 mt-14 max-w-[670px] sm:mt-16 lg:mt-[clamp(58px,8vh,100px)]">
          <p className="mb-5 flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-auth-primary sm:text-xs">
            <span aria-hidden="true" className="size-2 rounded-full bg-auth-primary" />
            <LocalizedText value={"Multi-store point of sale"} /></p>
          <h1 className="font-display text-[clamp(3.45rem,5.35vw,5.7rem)] font-extrabold leading-[0.98] tracking-[-0.075em] text-auth-ink">
            <LocalizedText value={"Keep every store"} /><br />
            <span className="text-auth-primary"><LocalizedText value={"in sync."} /></span>
          </h1>
          <p className="mt-5 max-w-[450px] text-[17px] leading-[1.6] text-auth-muted sm:text-[18px]">
            <LocalizedText value={"Sales, stock and store teams, together in one place."} /></p>
        </div>

        <div aria-hidden="true" className="auth-hero-visual pointer-events-none relative z-0 -mx-6 mt-auto h-[260px] sm:-mx-10 sm:h-[320px] lg:absolute lg:start-0 lg:end-[-160px] lg:bottom-0 lg:top-[37%] lg:mx-0 lg:mt-0 lg:h-auto">
          <Image
            src="/images/pos-auth-hero.png"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 58vw, 100vw"
            className="auth-hero-image object-cover object-[center_56%]"
          />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(180deg, var(--auth-canvas) 0%, rgba(var(--auth-canvas-rgb), .78) 20%, rgba(var(--auth-canvas-rgb), .42) 43%, rgba(var(--auth-canvas-rgb), .12) 68%, rgba(var(--auth-canvas-rgb), .04) 100%)",
            }}
          />
        </div>
      </section>

      <section className="relative z-10 flex min-h-[620px] items-center justify-center px-5 pb-12 pt-[92px] sm:px-8 lg:min-h-screen lg:px-10 lg:py-24">
        <div className="absolute end-6 top-6 z-20 sm:end-10 sm:top-8"><AuthLanguage /></div>
        <div className="w-full max-w-[37rem] rounded-[24px] bg-auth-surface/95 px-6 py-8 shadow-xl ring-1 ring-auth-outline backdrop-blur-sm sm:px-10 sm:py-11 lg:px-12 lg:py-12">
          {children}
        </div>
      </section>
    </main>
  );
}

/** Quiet, centered registration layout with a wider card for a shorter form. */
export function AuthCentered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh overflow-x-clip bg-auth-canvas text-auth-ink">
      <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 pt-7 sm:px-10 lg:px-12 lg:pt-8">
        <AuthBrand />
        <AuthLanguage />
      </header>
      <main className="mx-auto flex min-h-[calc(100svh-6.5rem)] w-full max-w-[1440px] items-center justify-center px-4 py-8 sm:px-8 sm:py-10">
        <div className="w-full max-w-[58rem] rounded-[24px] bg-auth-surface/95 px-5 py-7 shadow-xl ring-1 ring-auth-outline backdrop-blur-sm sm:px-8 sm:py-9 lg:px-12 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
