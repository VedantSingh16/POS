import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsEditor } from "@/features/settings/settings-editor";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Security settings") }; }
export default async function Page() { const { data } = await api.settings(); return <Card><CardContent><SettingsEditor section="security" initial={data} /></CardContent></Card>; }
