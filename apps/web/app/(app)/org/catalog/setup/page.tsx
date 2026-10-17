import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import Link from "next/link";
import { ArrowRight, Barcode, Boxes, Ruler, SlidersHorizontal, Tags } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { requirePermission } from "@/lib/server/session";
import { hasPermission } from "@/lib/permissions";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Catalogue setup") }; }

const productSetup = [
  { title: "Product setup rules", description: "Choose which details and checks different kinds of products need.", href: "/org/catalog/types", icon: SlidersHorizontal },
  { title: "Brands", description: "Maintain the shared brand list used by every store.", href: "/org/catalog/brands", icon: Tags },
  { title: "Units", description: "Set how sellable quantities are labelled on stock and bills.", href: "/org/catalog/units", icon: Ruler },
];

export default async function CatalogueSetupPage() {
  const me = await requirePermission("catalog.view");
  const canManageFields = hasPermission(me, "org.settings.manage");
  const { data: fields } = await api.catalogFieldConfig();

  return (
    <>
      <PageHeader
        title="Catalogue setup"
        description="Set the shared product structure once, then use it across your stores."
        crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Catalogue setup" }]}
        actions={<Link href="/org/catalog/products" className={buttonVariants({ variant: "outline" })}><Boxes /> <LocalizedText value={"View products"} /></Link>}
      />

      <div className="grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.72fr)]">
        <section aria-labelledby="product-setup-heading">
          <div className="mb-3">
            <h2 id="product-setup-heading" className="text-lg font-semibold tracking-tight"><LocalizedText value={"Product details"} /></h2>
            <p className="mt-1 text-sm text-muted-foreground"><LocalizedText value={"Options that help keep product records consistent."} /></p>
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {productSetup.filter((item) => item.title !== "Brands" || fields.coreFields.includes("brand")).map(({ title, description, href, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} className="group flex min-h-[5.5rem] items-center gap-4 px-4 py-4 transition-colors hover:bg-accent/55 sm:px-5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary"><Icon aria-hidden className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-foreground"><LocalizedText value={title} /></span>
                      <span className="mt-1 block text-sm leading-5 text-muted-foreground"><LocalizedText value={description} /></span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section aria-labelledby="shared-fields-heading">
          <div className="mb-3">
            <h2 id="shared-fields-heading" className="text-lg font-semibold tracking-tight"><LocalizedText value={"Shared fields"} /></h2>
            <p className="mt-1 text-sm text-muted-foreground"><LocalizedText value={"Choose which information appears in the catalogue."} /></p>
          </div>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary"><Barcode aria-hidden className="size-5" /></span>
              <div>
                <h3 className="font-semibold"><LocalizedText value={"Product fields"} /></h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground"><LocalizedText value={"Configure shared details such as barcode, description, price and custom fields."} /></p>
                {canManageFields ? (
                  <Link href="/org/catalog/fields" className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline">
                    <LocalizedText value={"Configure fields "} /><ArrowRight aria-hidden className="size-4 rtl:rotate-180" />
                  </Link>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground"><LocalizedText value={"An organisation administrator can configure these fields."} /></p>
                )}
              </div>
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}
