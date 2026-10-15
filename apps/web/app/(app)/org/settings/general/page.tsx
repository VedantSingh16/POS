import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsEditor } from "@/features/settings/settings-editor";
import { api } from "@/features/api";
import { OrgProfileForm } from "@/features/actions";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("General settings") }; }
export default async function Page() {
  const [{ data }, { data: profile }] = await Promise.all([api.settings(), api.orgProfile()]);
  return (
    <div className="grid gap-4">
      <Card><CardContent className="grid gap-3"><div><h2 className="font-semibold"><LocalizedText value={"Organisation profile"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"Shown on receipts and tax invoices."} /></p></div><OrgProfileForm initial={profile} /></CardContent></Card>
      <Card><CardContent><SettingsEditor section="general" initial={data} /></CardContent></Card>
    </div>
  );
}
