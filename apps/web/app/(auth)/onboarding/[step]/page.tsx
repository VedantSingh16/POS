import { notFound, redirect } from "next/navigation";
import { Check, CheckCircle2 } from "lucide-react";
import { OnboardingStep } from "@/features/onboarding/onboarding-step";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { AuthBrand } from "@/features/auth/auth-brand";

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
    <div className="min-h-svh bg-auth-canvas text-auth-ink lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="hidden flex-col px-8 py-8 lg:flex xl:px-10">
        <AuthBrand />
        <div className="mt-16">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-auth-primary">Workspace setup</p>
          <h2 className="mt-3 break-words font-sans text-[22px] font-semibold leading-tight tracking-tight text-auth-ink">{organization.name}</h2>
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-auth-muted">Setup roadmap</p>
          <ol aria-label="Setup roadmap" className="relative mt-5 grid gap-5 before:absolute before:inset-y-[18px] before:left-[17px] before:w-px before:bg-auth-border before:content-['']">
            {STEPS.map((item, position) => {
              const active = position === index;
              const finished = !active && (position < index || done(position));
              return (
                <li key={item.slug} aria-current={active ? "step" : undefined} className="relative grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
                  <span className={cn(
                    "relative z-10 grid size-9 place-items-center rounded-full border text-sm font-semibold transition-colors",
                    active && "border-2 border-auth-primary bg-auth-surface text-auth-primary ring-4 ring-auth-primary/10",
                    finished && "border-auth-primary bg-auth-primary text-auth-on-primary",
                    !active && !finished && "border-auth-border bg-auth-surface text-auth-muted",
                  )}>
                    {finished ? <Check aria-hidden="true" className="size-4" strokeWidth={2.5} /> : position + 1}
                  </span>
                  <span className="grid gap-1 pt-0.5">
                    <span className={cn("text-sm font-semibold", active ? "text-auth-ink" : finished ? "text-auth-ink" : "text-auth-muted")}>{item.label}</span>
                    <span className="text-xs leading-5 text-auth-muted">{item.summary}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="mt-auto flex items-center gap-2 pt-10 text-xs text-auth-muted"><CheckCircle2 aria-hidden="true" className="size-4 text-auth-primary" />Progress is saved when you continue.</p>
      </aside>
      <div className="min-w-0">
        <header className="px-5 pt-5 sm:px-8 lg:hidden">
          <AuthBrand />
          <div className="mt-6 flex items-center justify-between text-xs font-semibold text-auth-muted">
            <span>Step {index + 1} of {STEPS.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-auth-border/60" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1}>
            <div className="h-full rounded-full bg-auth-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col justify-center px-5 py-8 sm:px-8 lg:min-h-svh lg:px-12 lg:py-12 xl:px-16">
          <div className="mx-auto w-full max-w-5xl">
            <p className="mb-2 hidden text-xs font-bold uppercase tracking-[0.18em] text-auth-primary lg:mb-3 lg:block">Step {index + 1} of {STEPS.length}</p>
            <h1 className="font-display text-[clamp(2rem,3vw,2.7rem)] font-bold leading-[1.08] tracking-[-0.06em] text-auth-ink">{current.label}</h1>
            <p className="mb-6 mt-2 max-w-2xl text-base leading-[1.6] text-auth-muted sm:mb-8 sm:text-[17px]">{current.text}</p>
            <OnboardingStep currentStep={index} initialData={initialData} organization={organization} admin={{ email: me.user.email }} complete={complete} />
          </div>
        </main>
      </div>
    </div>
  );
}
