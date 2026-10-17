"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  organizationSlug: z.string().optional(),
});
type In = z.input<typeof schema>;
type Org = { slug: string; name: string };

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = React.useState("");
  const [orgs, setOrgs] = React.useState<Org[]>([]);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showRecoveryHint, setShowRecoveryHint] = React.useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<In>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", organizationSlug: "" } });

  async function onSubmit(values: In) {
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...values, organizationSlug: values.organizationSlug || undefined, next }),
    }).catch(() => null);
    if (!res) { setError("Could not reach the server. Check your connection and try again."); return; }
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.code === "ORGANISATION_REQUIRED") { setOrgs(body.organisations ?? []); setError("This email is used in more than one organisation. Choose one."); return; }
    if (!res.ok) { setError(body.message ?? "Sign-in failed"); return; }
    router.replace(body.landing);
    router.refresh();
  }

  return (
    <div className="grid w-full gap-0 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-auth-ink">
      <div className="mb-8">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.19em] text-auth-primary"><LocalizedText value={"Welcome back"} /></p>
        <h1 className="font-display text-[clamp(2.45rem,3.2vw,3.1rem)] font-bold leading-[1.04] tracking-[-0.065em] text-auth-ink"><LocalizedText value={"Sign in to DeltPOS"} /></h1>
        <p className="mt-3 text-base leading-[1.6] text-auth-muted sm:text-[17px]"><LocalizedText value={"Access your organisation and stores."} /></p>
      </div>
      <form className="grid gap-5" noValidate onSubmit={handleSubmit(onSubmit)}>
        <Field label="Email address" htmlFor="email" error={errors.email?.message}>
          <div className="relative">
            <Mail aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2 text-auth-muted" strokeWidth={1.9} />
            <Input id="email" type="email" autoComplete="username" placeholder="you@company.com" className="h-14 rounded-[15px] border-auth-border bg-auth-surface ps-12 pe-4 text-base text-auth-ink placeholder:text-auth-muted" aria-invalid={!!errors.email} {...register("email")} />
          </div>
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <div className="relative">
            <LockKeyhole aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2 text-auth-muted" strokeWidth={1.9} />
            <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" className="h-14 rounded-[15px] border-auth-border bg-auth-surface ps-12 pe-12 text-base text-auth-ink placeholder:text-auth-muted" aria-invalid={!!errors.password} {...register("password")} />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)} className="absolute end-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-auth-muted hover:bg-auth-canvas hover:text-auth-ink">
              {showPassword ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
            </button>
          </div>
          <div className="mt-1 flex justify-end">
            <button type="button" aria-expanded={showRecoveryHint} aria-controls="password-recovery-hint" onClick={() => setShowRecoveryHint((visible) => !visible)} className="text-sm font-semibold text-auth-primary hover:text-auth-primary-hover hover:underline hover:underline-offset-4"><LocalizedText value={"Forgot password?"} /></button>
          </div>
          {showRecoveryHint && <p id="password-recovery-hint" role="status" className="text-sm leading-relaxed text-auth-muted"><LocalizedText value={"Ask your organisation administrator to reset your password."} /></p>}
        </Field>
        {orgs.length > 0 && (
          <Field label="Organisation" htmlFor="organizationSlug">
            <NativeSelect id="organizationSlug" required className="h-14 rounded-[15px] border-auth-border bg-auth-surface px-3.5 text-base text-auth-ink" {...register("organizationSlug")}>
              <option value=""><LocalizedText value={"Choose an organisation…"} /></option>
              {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={isSubmitting} className="relative mt-1 h-14 justify-center rounded-[15px] bg-auth-primary px-4 text-base font-bold text-auth-on-primary shadow-md hover:bg-auth-primary-hover sm:px-5"><span><LocalizedText value={isSubmitting ? "Signing in…" : "Sign in"} /></span><span aria-hidden="true" className="absolute end-5 text-xl">→</span></Button>
      </form>
      <p className="mt-8 text-center text-[15px] text-auth-muted"><LocalizedText value={"New to DeltPOS? "} /><Link href="/register" className="font-bold text-auth-primary underline decoration-auth-primary/35 underline-offset-4 hover:decoration-auth-primary"><LocalizedText value={"Create your organisation"} /></Link></p>
    </div>
  );
}
