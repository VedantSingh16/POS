import { redirect } from "next/navigation";

export default async function StoreSettingsIndex({ params }: PageProps<"/s/[storeId]/settings">) {
  const { storeId } = await params;
  redirect(`/s/${storeId}/settings/profile`);
}
