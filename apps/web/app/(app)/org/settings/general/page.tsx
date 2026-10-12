import { Card, CardContent } from "@/components/ui/card";
import { SettingsEditor } from "@/features/settings/settings-editor";
import { api } from "@/features/api";
import { OrgProfileForm } from "@/features/actions";

export const metadata = { title: "General settings" };
export default async function Page() {
  const [{ data }, { data: profile }] = await Promise.all([api.settings(), api.orgProfile()]);
  return (
    <div className="grid gap-4">
      <Card><CardContent className="grid gap-3"><div><h2 className="font-semibold">Organisation profile</h2><p className="text-sm text-muted-foreground">Shown on receipts and tax invoices.</p></div><OrgProfileForm initial={profile} /></CardContent></Card>
      <Card><CardContent><SettingsEditor section="general" initial={data} /></CardContent></Card>
    </div>
  );
}
