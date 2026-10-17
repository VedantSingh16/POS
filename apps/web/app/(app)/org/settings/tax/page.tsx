import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Tax profile") }; }
export default async function Page() {
  const { data: profile } = await api.orgProfile();
  const taxLabel = profile.taxRegime === "GST" ? "GST" : profile.taxRegime === "VAT" ? "VAT" : "Tax";
  const codeLabel = profile.countryCode === "IN" ? "HSN" : "HS code";
  return <Card><CardContent className="grid gap-2 text-sm">
    <p><LocalizedText value={`The organization tax profile and ${taxLabel} registration are maintained in the `} /><Link className="underline" href="/org/settings/general"><LocalizedText value={"organization profile"} /></Link>.</p>
    <p><LocalizedText value={`Tax rates, ${codeLabel} assignments, and tax group availability are configured independently for each store. Open a store’s `} /><Link className="underline" href="/org/stores"><LocalizedText value={"settings"} /></Link> <LocalizedText value={"to manage its tax groups."} /></p>
  </CardContent></Card>;
}
