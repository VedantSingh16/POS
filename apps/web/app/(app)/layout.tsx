import { AppShell } from "@/components/app/app-shell";
import { SessionProvider } from "@/components/app/session-context";
import { landingPath } from "@/lib/permissions";
import { requireSession } from "@/lib/server/session";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireSession();
  if (me.onboardingRequired && me.user.isOrganisationAdministrator) redirect("/onboarding/welcome");
  return (
    <SessionProvider me={me}>
      <AppShell orgName={me.organisation.name} stores={me.stores} defaultStoreId={me.stores.find((s) => s.id === me.user.defaultStoreId)?.id ?? me.stores[0]?.id ?? ""} home={landingPath(me)}>
        {children}
      </AppShell>
    </SessionProvider>
  );
}
