import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { PosScreen } from "@/features/pos/pos-screen";
import { api, soft } from "@/features/api";
import { requirePermission } from "@/lib/server/session";
import { SessionProvider } from "@/components/app/session-context";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Point of sale") }; }

export default async function PosPage({ params }: PageProps<"/s/[storeId]/pos">) {
  const { storeId } = await params;
  const me = await requirePermission("sale.create", storeId);
  const store = me.stores.find((s) => s.id === storeId);
  // Each request is independent: if one fails (or is not permitted) the till still opens and says what is missing.
  const problems: string[] = [];
  const [{ data: products }, { data: categories }, { data: registers }, { data: customers }, { data: checkoutConfig }] = await Promise.all([
    soft(api.products(storeId), [], (m) => problems.push(`products: ${m}`)),
    soft(api.categories(storeId), [], (m) => problems.push(`categories: ${m}`)),
    soft(api.registers(storeId), [], (m) => problems.push(`registers: ${m}`)),
    soft(api.customers(storeId), [], (m) => problems.push(`customers: ${m}`)),
    soft(api.checkoutConfig(storeId), { fields: [], coreFields: ["billHandler", "tender", "cashTendered"], handlers: [], requireBillHandler: false, requireDiscountReasonCode: false, discountReasons: [], discounts: { lineEnabled: true, lineMaxPercent: 100, billEnabled: true, billMaxPercent: 100, allowStacking: true }, productFields: [], productCoreFields: ["name", "sku", "price"] }, (m) => problems.push(`checkout settings: ${m}`)),
  ]);
  return (
    <SessionProvider me={me}>
      <PosScreen
        storeId={storeId}
        storeName={store?.name ?? "Store"}
        cashier={me.user.displayName}
        currentUserId={me.user.userId}
        checkoutConfig={checkoutConfig}
        products={products.map((product) => ({ ...product, status: product.status === "ACTIVE" || product.status === "SEASONAL" ? "ACTIVE" as const : "INACTIVE" as const }))}
        categories={categories.map((c) => c.name)}
        customers={customers.map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone }))}
        registers={registers.map((r) => ({ id: r.id, name: r.name, status: r.status, sessionId: r.sessionId, active: (r as { registerStatus?: string }).registerStatus !== "INACTIVE" }))}
        loadProblems={problems}
        canExit={me.permissions.organization.length > 0 || (me.permissions.stores[storeId] ?? []).some((p) => p !== "sale.create")}
      />
    </SessionProvider>
  );
}
