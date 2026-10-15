import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { AuthCentered } from "@/features/auth/auth-split";
import { RegistrationForm } from "@/features/auth/registration-form";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Register organisation") }; }

export default function RegisterPage() {
  return <AuthCentered><RegistrationForm /></AuthCentered>;
}
