import { Card, CardContent } from "@/components/ui/card";
import { ApprovalPolicyForm } from "@/features/settings/settings-editor";
import { api } from "@/features/api";

export const metadata = { title: "Approvals settings" };
export default async function Page() {
  const { data } = await api.approvalPolicy();
  return <Card><CardContent><ApprovalPolicyForm initial={data} /></CardContent></Card>;
}
