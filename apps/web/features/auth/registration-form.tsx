"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { AuthTabs } from "@/features/auth/auth-tabs";

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
    <div className="grid w-full max-w-lg gap-5">
      <AuthTabs active="register" />
      <div>
        <h1 className="text-2xl font-semibold">Register your organisation</h1>
        <p className="text-sm text-muted-foreground">Create your administrator account, then set up stores and assign each store manager.</p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={handleSubmit(submit)}>
        <Field label="Organisation name" htmlFor="register-org" error={errors.organizationName?.message}><Input id="register-org" autoComplete="organization" aria-invalid={!!errors.organizationName} {...register("organizationName")} /></Field>
        <Field label="Organisation URL" htmlFor="register-slug" hint="Optional; generated from the name if left blank." error={errors.organizationSlug?.message}><Input id="register-slug" autoComplete="off" aria-invalid={!!errors.organizationSlug} {...register("organizationSlug")} /></Field>
        <Field label="Administrator first name" htmlFor="register-first" error={errors.firstName?.message}><Input id="register-first" autoComplete="given-name" aria-invalid={!!errors.firstName} {...register("firstName")} /></Field>
        <Field label="Administrator last name" htmlFor="register-last" error={errors.lastName?.message}><Input id="register-last" autoComplete="family-name" aria-invalid={!!errors.lastName} {...register("lastName")} /></Field>
        <Field label="Work email" htmlFor="register-email" error={errors.email?.message}><Input id="register-email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} /></Field>
        <Field label="Password" htmlFor="register-password" hint="At least 12 characters." error={errors.password?.message}><Input id="register-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} /></Field>
        {serverError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{serverError}</p>}
        <p className="text-sm text-muted-foreground sm:col-span-2">This account administers this organisation only. Platform support accounts are provisioned separately.</p>
        <div className="flex items-center justify-between sm:col-span-2">
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>Back to sign in</Link>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create organisation"}</Button>
        </div>
      </form>
    </div>
  );
}
