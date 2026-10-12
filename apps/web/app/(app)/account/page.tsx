import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { AccountForms } from "@/features/actions";

export const metadata = { title: "My account" };

export default async function Page() {
  const me = await requireSession();
  const [first, ...rest] = me.user.displayName.trim().split(/\s+/);
  return (
    <>
      <PageHeader title="My account" description="Your name, password and approval PIN." />
      <AccountForms firstName={first ?? ""} lastName={rest.join(" ")} email={me.user.email} />
    </>
  );
}
