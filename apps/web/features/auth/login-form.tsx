"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { AuthTabs } from "@/features/auth/auth-tabs";

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
    <div className="grid w-full max-w-sm gap-5">
      <AuthTabs active="login" />
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1><p className="mt-1 text-sm text-muted-foreground">Use the account your administrator created for you.</p>
      </div>
      <form className="grid gap-4" noValidate onSubmit={handleSubmit(onSubmit)}>
        <Field label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="username" aria-invalid={!!errors.email} {...register("email")} /></Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}><Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register("password")} /></Field>
        {orgs.length > 0 && (
          <Field label="Organisation" htmlFor="organizationSlug">
            <NativeSelect id="organizationSlug" required {...register("organizationSlug")}>
              <option value="">Choose an organisation…</option>
              {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">Setting up a new business? <Link href="/register" className="font-medium text-primary hover:underline">Register your organisation</Link></p>
    </div>
  );
}
