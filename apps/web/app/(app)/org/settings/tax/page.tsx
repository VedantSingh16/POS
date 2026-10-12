import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Tax settings" };
export default function Page() {
  return (
    <Card><CardContent className="grid gap-2 text-sm">
      <p>GST is set per product: each variant uses a <Link className="underline" href="/org/catalog/tax">tax group</Link> with its rate and HSN code, and each price records whether it includes tax.</p>
      <p>Your GSTIN lives in the <Link className="underline" href="/org/settings/general">organisation profile</Link>, so there is one place to maintain it.</p>
    </CardContent></Card>
  );
}
