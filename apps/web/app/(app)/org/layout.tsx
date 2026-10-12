import { requireOrgArea } from "@/lib/server/session";

export default async function OrgLayout({ children }: LayoutProps<"/org">) {
  await requireOrgArea();
  return <>{children}</>;
}
