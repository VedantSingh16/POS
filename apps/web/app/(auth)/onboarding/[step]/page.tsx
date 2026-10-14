import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { OnboardingStep } from "@/features/onboarding/onboarding-step";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";
import { cn } from "@/lib/utils";

const STEPS = [
  { slug: "organization", label: "Organisation", text: "Set your business name, country, currency and tax profile." },
  { slug: "store", label: "First store", text: "Add the location where you’ll start selling." },
  { slug: "optional", label: "Optional setup", text: "Add products, review checkout, invite your team or configure devices." },
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
  return (
    <div className="grid min-h-screen lg:grid-cols-[18.5rem_1fr]">
      <aside className="hidden flex-col border-r bg-card/50 p-7 lg:flex">
        <div className="mb-7 flex items-center gap-2 font-semibold tracking-tight"><span className="grid size-6 place-items-center rounded-md bg-sidebar text-xs font-bold text-sidebar-primary">D</span>DeltCRM POS</div>
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Set up {organization.name}</p>
        <ol aria-label="Setup progress" className="grid">
          {STEPS.map((item, position) => <li key={item.slug} aria-current={position === index ? "step" : undefined} className={cn("flex items-center gap-3 py-2 text-sm", position === index ? "font-semibold" : "text-muted-foreground")}>
            <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold", position === index ? "border-2 border-primary text-primary" : done(position) ? "bg-primary text-primary-foreground" : "border text-muted-foreground")}>{done(position) && position !== index ? <Check className="size-3.5" /> : position < 2 ? position + 1 : "·"}</span>
            <span>{item.label}{position < 2 && <span className="ml-1 text-xs font-normal text-muted-foreground">Required</span>}</span>
          </li>)}
        </ol>
        <div className="mt-auto rounded-lg border bg-card p-3 text-xs text-muted-foreground"><p className="mb-0.5 text-sm font-medium text-foreground">Your progress is saved</p>You can leave and return to the step you were completing.</div>
      </aside>
      <div className="flex min-w-0 flex-col px-5 py-8 sm:px-14">
        <div className="w-full max-w-2xl">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{index < 2 ? `Required setup · Step ${index + 1} of 2` : "You can skip this section"}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary lg:hidden" role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={Math.min(index + 1, 2)}><div className="h-full bg-primary" style={{ width: `${(Math.min(index + 1, 2) / 2) * 100}%` }} /></div>
          <h1 className="mt-1.5 text-2xl font-semibold">{current.label}</h1>
          <p className="mb-6 mt-1 max-w-xl text-sm text-muted-foreground">{current.text}</p>
          <OnboardingStep currentStep={index} initialData={initialData} organization={organization} admin={{ email: me.user.email }} complete={complete} />
        </div>
      </div>
    </div>
  );
}
