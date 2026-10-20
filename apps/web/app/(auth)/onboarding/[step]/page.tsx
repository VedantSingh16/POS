import { LocalizedText } from "@/components/i18n/localized-text";
import { notFound, redirect } from "next/navigation";
import { Check, CheckCircle2 } from "lucide-react";
import { OnboardingStep } from "@/features/onboarding/onboarding-step";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { AuthBrand } from "@/features/auth/auth-brand";
import { LocaleSwitch } from "@/components/i18n/locale-switch";

const STEPS = [
  { slug: "organization", label: "Organisation", summary: "Business details", text: "Set your business name, country, currency and tax profile." },
  { slug: "store", label: "First store", summary: "Location details", text: "Add the location where you’ll start selling." },
  { slug: "optional", label: "Next steps", summary: "Products, team and checkout", text: "Add products, review checkout, invite your team or configure devices." },
];
const LEGACY_OPTIONAL_STEPS = new Set(["managers", "roles", "tax-receipts", "review", "finish"]);

export function generateStaticParams() { return STEPS.map((step) => ({ step: step.slug })); }
export const dynamic = "force-dynamic";

export default async function Onboarding({ params }: PageProps<"/onboarding/[step]">) {
  const { step } = await params;
  const me = await requirePermission("org.settings.manage");
  const [{ data: saved }, { data: organization }] = await Promise.all([api.onboarding(), api.org()]);
  const onboarding = saved.onboarding as { completedSteps?: unknown[]; complete?: unknown; data?: unknown };
  const initialData = onboarding.data && typeof onboarding.data === "object" && !Array.isArray(onboarding.data) ? onboarding.data as Record<string, unknown> : {};
  const complete = onboarding.complete === true;

  if (step === "welcome") redirect(complete ? "/org" : initialData.organization ? "/onboarding/store" : "/onboarding/organization");
  if (step === "stores") redirect("/onboarding/store");
  if (LEGACY_OPTIONAL_STEPS.has(step)) redirect(complete ? "/onboarding/optional" : "/onboarding/organization");
  const index = STEPS.findIndex((item) => item.slug === step);
  if (index < 0) notFound();
  if (complete && step !== "optional") redirect("/org");
  if (!complete && step === "optional") redirect("/onboarding/organization");
  if (!complete && step === "store" && !initialData.organization) redirect("/onboarding/organization");

  const current = STEPS[index]!;
  const completed = Array.isArray(onboarding.completedSteps) ? onboarding.completedSteps : [];
  const done = (position: number) => complete || completed.includes(position);
  const progress = Math.round(((index + 1) / STEPS.length) * 100);
  return (
    <div className="min-h-svh bg-auth-canvas text-auth-ink lg:grid lg:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="fixed end-4 top-4 z-50"><LocaleSwitch compact /></div>
      <aside className="hidden flex-col border-e border-auth-outline bg-auth-primary/[0.025] px-7 py-8 lg:flex xl:px-8">
        <AuthBrand />
        <div className="mt-12">
          <div className="rounded-xl border border-auth-outline bg-auth-surface px-4 py-3.5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-auth-muted"><LocalizedText value={"Workspace setup"} /></p>
            <h2 className="mt-1.5 break-words font-sans text-[19px] font-medium leading-snug tracking-tight text-auth-ink">{organization.name}</h2>
          </div>
          <div className="mt-8 flex items-center justify-between gap-3 px-1">
            <p id="onboarding-steps-label" className="text-[13px] font-medium uppercase tracking-[0.1em] text-auth-ink"><LocalizedText value={"Setup steps"} /></p>
            <span className="rounded-full bg-auth-primary/10 px-2.5 py-1 text-xs font-medium text-auth-primary">{index + 1} <LocalizedText value={"of "} />{STEPS.length}</span>
          </div>
          <ol aria-labelledby="onboarding-steps-label" className="mt-3 grid gap-1.5">
            {STEPS.map((item, position) => {
              const active = position === index;
              const finished = !active && (position < index || done(position));
              return (
                <li key={item.slug} aria-current={active ? "step" : undefined} className={cn("grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-transparent px-3 py-3", active && "border-auth-primary/15 bg-auth-surface shadow-sm")}>
                  <span className={cn(
                    "grid size-8 place-items-center rounded-full border text-sm font-medium transition-colors",
                    active && "border-auth-primary bg-auth-primary text-auth-on-primary ring-4 ring-auth-primary/10",
                    finished && "border-auth-primary/25 bg-auth-primary/10 text-auth-primary",
                    !active && !finished && "border-auth-border bg-auth-surface text-auth-muted",
                  )}>
                    {finished ? <Check aria-hidden="true" className="size-4" strokeWidth={2.25} /> : position + 1}
                  </span>
                  <span className="grid gap-0.5">
                    <span className={cn("text-[14px] leading-snug", active || finished ? "font-medium text-auth-ink" : "font-normal text-auth-muted")}><LocalizedText value={item.label} /></span>
                    <span className="text-[13px] leading-[1.45] text-auth-muted"><LocalizedText value={item.summary} /></span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="mt-auto pt-8">
          <div className="flex items-center justify-between text-xs font-medium text-auth-muted"><span><LocalizedText value={"Setup progress"} /></span><span>{progress}%</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-auth-border/60" role="progressbar" aria-labelledby="onboarding-progress-label" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-auth-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <span id="onboarding-progress-label" className="sr-only"><LocalizedText value={"Setup progress"} /></span>
          <p className="mt-3 flex items-center gap-2 text-xs text-auth-muted"><CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-auth-primary" /><LocalizedText value={"Progress is saved when you continue."} /></p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="px-5 pt-5 sm:px-8 lg:hidden">
          <AuthBrand />
          <div className="mt-6 flex items-center justify-between text-xs font-semibold text-auth-muted">
            <span><LocalizedText value={"Step "} />{index + 1} <LocalizedText value={"of "} />{STEPS.length}</span>
          </div>
          <span id="onboarding-mobile-progress-label" className="sr-only"><LocalizedText value={"Setup progress"} /></span>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-auth-border/60" role="progressbar" aria-labelledby="onboarding-mobile-progress-label" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1}>
            <div className="h-full rounded-full bg-auth-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col justify-center px-5 py-8 sm:px-8 lg:min-h-svh lg:px-12 lg:py-12 xl:px-16">
          <div className="mx-auto w-full max-w-5xl">
            <p className="mb-2 hidden text-xs font-bold uppercase tracking-[0.18em] text-auth-primary lg:mb-3 lg:block"><LocalizedText value={"Step "} />{index + 1} <LocalizedText value={"of "} />{STEPS.length}</p>
            <h1 className="font-display text-[clamp(1.875rem,2.3vw,2.25rem)] font-medium leading-[1.1] tracking-[-0.03em] text-auth-ink"><LocalizedText value={current.label} /></h1>
            <p className="mb-6 mt-2 max-w-2xl text-[15px] leading-[1.55] text-auth-muted sm:mb-8"><LocalizedText value={current.text} /></p>
            <OnboardingStep currentStep={index} initialData={initialData} organization={organization} admin={{ email: me.user.email }} complete={complete} />
          </div>
        </main>
      </div>
    </div>
  );
}
