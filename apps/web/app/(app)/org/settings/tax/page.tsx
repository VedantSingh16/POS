import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Tax profile") }; }
export default function Page() {
  return <Card><CardContent className="grid gap-2 text-sm">
    <p><LocalizedText value={"The organization tax profile and GSTIN are maintained in the "} /><Link className="underline" href="/org/settings/general"><LocalizedText value={"organization profile"} /></Link>.</p>
    <p><LocalizedText value={"Tax rates, HSN assignments, and tax group availability are configured independently for each store. Open a store’s "} /><Link className="underline" href="/org/stores"><LocalizedText value={"settings"} /></Link> <LocalizedText value={"to manage its tax groups."} /></p>
  </CardContent></Card>;
}
