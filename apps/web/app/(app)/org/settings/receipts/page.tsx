import { Card, CardContent } from "@/components/ui/card";
import { SettingsEditor } from "@/features/settings/settings-editor";
import { api } from "@/features/api";

export const metadata = { title: "Receipts settings" };
export default async function Page() { const { data } = await api.settings(); return <Card><CardContent><SettingsEditor section="receipts" initial={data} /></CardContent></Card>; }
