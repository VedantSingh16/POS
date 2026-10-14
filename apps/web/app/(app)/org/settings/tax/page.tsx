import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Tax profile" };
export default function Page() {
  return <Card><CardContent className="grid gap-2 text-sm">
    <p>The organization tax profile and GSTIN are maintained in the <Link className="underline" href="/org/settings/general">organization profile</Link>.</p>
    <p>Tax rates, HSN assignments, and tax group availability are configured independently for each store. Open a store’s <Link className="underline" href="/org/stores">settings</Link> to manage its tax groups.</p>
  </CardContent></Card>;
}
