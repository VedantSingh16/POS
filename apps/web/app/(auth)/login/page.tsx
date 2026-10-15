import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthSplit } from "@/features/auth/auth-split";
import { LoginForm } from "@/features/auth/login-form";
import { landingPath } from "@/lib/permissions";
import { getSession, isLocked } from "@/lib/server/session";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Sign in") }; }

export default async function LoginPage() {
  const me = await getSession();
  if (me) redirect((await isLocked()) ? "/lock" : landingPath(me));
  return <AuthSplit><Suspense><LoginForm /></Suspense></AuthSplit>;
}
