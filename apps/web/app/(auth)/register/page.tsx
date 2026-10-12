import { AuthSplit } from "@/features/auth/auth-split";
import { RegistrationForm } from "@/features/auth/registration-form";

export const metadata = { title: "Register organisation" };

export default function RegisterPage() {
  return <AuthSplit><RegistrationForm /></AuthSplit>;
}
