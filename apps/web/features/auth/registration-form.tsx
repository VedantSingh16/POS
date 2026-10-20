"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";

const schema = z.object({
  organizationName: z.string().trim().min(2, "Enter your organisation name").max(120),
  organizationSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Use 3–48 lowercase letters, numbers or hyphens").optional().or(z.literal("")),
  firstName: z.string().trim().min(1, "Enter your first name").max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(12, "Use at least 12 characters").max(200),
});
type RegistrationInput = z.input<typeof schema>;

export function RegistrationForm() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegistrationInput>({
    resolver: zodResolver(schema),
    defaultValues: { organizationName: "", organizationSlug: "", firstName: "", lastName: "", email: "", password: "" },
  });

  async function submit(value: RegistrationInput) {
    setServerError("");
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...value, organizationSlug: value.organizationSlug || undefined }),
    }).catch(() => null);
    if (!response) { setServerError("Could not reach the server. Check your connection and try again."); return; }
    const payload = await response.json().catch(() => ({})) as { message?: string; landing?: string };
    if (!response.ok) { setServerError(payload.message ?? "Registration failed. Check the details and try again."); return; }
    router.replace(payload.landing ?? "/onboarding/welcome");
    router.refresh();
  }

  return (
    <div className="mx-auto grid w-full gap-0 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-auth-ink">
      <div className="mb-6">
        <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.19em] text-auth-primary"><LocalizedText value={"Workspace setup"} /></p>
        <h1 className="font-display text-[clamp(2.1rem,3vw,2.65rem)] font-bold leading-[1.04] tracking-[-0.035em] text-auth-ink"><LocalizedText value={"Create your organisation"} /></h1>
        <p className="mt-2.5 text-base leading-[1.55] text-auth-muted sm:text-[17px]"><LocalizedText value={"Set up your workspace and administrator account. You can add stores next."} /></p>
      </div>
      <form className="grid gap-x-5 gap-y-4 sm:grid-cols-2" noValidate onSubmit={handleSubmit(submit)}>
        <Field label="Organisation name" htmlFor="register-org" error={errors.organizationName?.message}>
          <Input id="register-org" autoComplete="organization" placeholder="e.g. Northstar Retail" className="h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink placeholder:text-auth-muted" aria-invalid={!!errors.organizationName} {...register("organizationName")} />
        </Field>
        <Field label="Organisation URL (optional)" htmlFor="register-slug" hint="Leave blank to generate it from the name." error={errors.organizationSlug?.message}>
          <Input id="register-slug" autoComplete="off" placeholder="northstar-retail" className="h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink placeholder:text-auth-muted" aria-invalid={!!errors.organizationSlug} {...register("organizationSlug")} />
        </Field>
        <div className="sm:col-span-2 flex items-center gap-3 pt-1 text-[11px] font-bold uppercase tracking-[0.17em] text-auth-primary"><span><LocalizedText value={"Administrator details"} /></span><span aria-hidden="true" className="h-px flex-1 bg-auth-primary/15" /></div>
        <Field label="First name" htmlFor="register-first" error={errors.firstName?.message}><Input id="register-first" autoComplete="given-name" className="h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink" aria-invalid={!!errors.firstName} {...register("firstName")} /></Field>
        <Field label="Last name" htmlFor="register-last" error={errors.lastName?.message}><Input id="register-last" autoComplete="family-name" className="h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink" aria-invalid={!!errors.lastName} {...register("lastName")} /></Field>
        <Field label="Work email" htmlFor="register-email" error={errors.email?.message}><Input id="register-email" type="email" autoComplete="email" className="h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink" aria-invalid={!!errors.email} {...register("email")} /></Field>
        <Field label="Password" htmlFor="register-password" hint="At least 12 characters." error={errors.password?.message}><Input id="register-password" type="password" autoComplete="new-password" className="h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink" aria-invalid={!!errors.password} {...register("password")} /></Field>
        {serverError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{serverError}</p>}
        <div className="pt-1 sm:col-span-2">
          <Button type="submit" disabled={isSubmitting} className="relative h-14 w-full justify-center rounded-[15px] bg-auth-primary px-4 text-base font-bold text-auth-on-primary shadow-md hover:bg-auth-primary-hover sm:px-5"><span><LocalizedText value={isSubmitting ? "Creating…" : "Create organisation"} /></span><span aria-hidden="true" className="absolute end-5 text-xl">→</span></Button>
        </div>
      </form>
      <p className="mt-7 text-center text-[15px] text-auth-muted"><LocalizedText value={"Already have an account? "} /><Link href="/login" className="font-bold text-auth-primary underline decoration-auth-primary/35 underline-offset-4 hover:decoration-auth-primary"><LocalizedText value={"Sign in"} /></Link></p>
    </div>
  );
}
