import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { Card, CardContent } from "@/components/ui/card";
import { ApprovalPolicyForm } from "@/features/settings/settings-editor";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Approvals settings") }; }
export default async function Page() {
  const { data } = await api.approvalPolicy();
  return <Card><CardContent><ApprovalPolicyForm initial={data} /></CardContent></Card>;
}
