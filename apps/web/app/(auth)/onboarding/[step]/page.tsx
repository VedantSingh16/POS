import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { OnboardingStep } from "@/features/onboarding/onboarding-step";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";
import { cn } from "@/lib/utils";

const STEPS = [
  { slug: "welcome", label: "Administrator", text: "Confirm your sign-in details and set the password and PIN you will use. You are the person who manages the whole organisation." },
  { slug: "organization", label: "Organisation", text: "Set the business name, address and tax details." },
  { slug: "stores", label: "Stores", text: "Add your stores and create a register for each." },
  { slug: "managers", label: "Store managers", text: "Assign one manager to each store." },
  { slug: "roles", label: "Roles", text: "Review the built-in permissions." },
  { slug: "tax-receipts", label: "Tax & receipts", text: "Set cash rounding and GST defaults." },
  { slug: "review", label: "Review", text: "Check the organisation and store assignments." },
  { slug: "finish", label: "Finish", text: "Complete setup and open your organisation." },
];

export function generateStaticParams() { return STEPS.map((s) => ({ step: s.slug })); }
export const dynamic = "force-dynamic";

export default async function Onboarding({ params }: PageProps<"/onboarding/[step]">) {
  const { step } = await params;
  const me = await requirePermission("org.settings.manage");
  const i = STEPS.findIndex((s) => s.slug === step);
  if (i === -1) notFound();
  const cur = STEPS[i];
  const prev = STEPS[i - 1]; const next = STEPS[i + 1];
  const [{ data: saved }, { data: organization }, { data: storeRows }, { data: roles }] = await Promise.all([api.onboarding(), api.org(), api.stores(), api.roles()]);
  const onboarding = saved.onboarding as { completedSteps?: unknown[]; currentStep?: unknown; complete?: unknown; data?: unknown };
  const details = await Promise.all(storeRows.map(async (store) => (await api.store(store.id)).data));
  const existingStores = details.map((store) => {
    const register = store.registers?.[0];
    return { id: store.id, code: store.code, name: store.name, address: store.address ?? "", timezone: store.timezone ?? "Asia/Kolkata", closeHour: store.closeHour === null ? "" : String(store.closeHour), registerCode: register?.code ?? "REG-01", registerName: register?.name ?? "Front Till" };
  });
  const initialData = onboarding.data && typeof onboarding.data === "object" && !Array.isArray(onboarding.data) ? onboarding.data as Record<string, unknown> : {};
  const complete = onboarding.complete === true;
  const done = (j: number) => j < i || (Array.isArray(onboarding.completedSteps) && onboarding.completedSteps.includes(j));
  return (
    <div className="grid min-h-screen lg:grid-cols-[18.5rem_1fr]">
      <aside className="hidden flex-col border-r bg-card/50 p-7 lg:flex">
        <div className="mb-7 flex items-center gap-2 font-semibold tracking-tight"><span className="grid size-6 place-items-center rounded-md bg-sidebar text-xs font-bold text-sidebar-primary">D</span>DeltCRM POS</div>
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Set up {organization.name}</p>
        <ol aria-label="Progress" className="grid">{STEPS.map((s, j) => (
          <li key={s.slug} aria-current={j === i ? "step" : undefined} className={cn("flex items-center gap-3 py-2 text-sm", j === i ? "font-semibold" : done(j) ? "text-muted-foreground" : "text-muted-foreground/70")}>
            <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold", j === i ? "border-2 border-primary text-primary" : done(j) ? "bg-primary text-primary-foreground" : "border text-muted-foreground")}>{done(j) && j !== i ? <Check className="size-3.5" /> : j + 1}</span>{s.label}
          </li>))}
        </ol>
        <div className="mt-auto rounded-lg border bg-card p-3 text-xs text-muted-foreground"><p className="mb-0.5 text-sm font-medium text-foreground">Your progress is saved</p>Each step is stored as you continue. You can leave and return to where you stopped.</div>
      </aside>
      <div className="flex min-w-0 flex-col px-5 py-8 sm:px-14">
        <div className="w-full max-w-2xl">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Step {i + 1} of {STEPS.length}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary lg:hidden" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={i + 1}><div className="h-full bg-primary" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
          <h1 className="mt-1.5 text-2xl font-semibold">{cur.label}</h1>
          <p className="mb-6 mt-1 max-w-xl text-sm text-muted-foreground">{cur.text}</p>
          {complete && <p className="mb-4 rounded-md border-l-2 border-l-success bg-success-soft px-3 py-2 text-sm text-success">Onboarding is complete. You can revisit these steps from organisation settings.</p>}
          <OnboardingStep currentStep={i} previous={prev?.slug} next={next?.slug} initialData={initialData} organization={{ name: organization.name, maxStores: organization.maxStores }} existingStores={existingStores} roles={roles} admin={{ name: me.user.displayName, email: me.user.email }} />
        </div>
      </div>
    </div>
  );
}
