import { redirect } from "next/navigation";

export default async function Page({ params }: PageProps<"/s/[storeId]/brands">) {
  const { storeId } = await params;
  redirect(`/s/${storeId}/products`);
}
