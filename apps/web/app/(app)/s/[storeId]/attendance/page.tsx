import { redirect } from "next/navigation";

/** Attendance is paused in the UI; its API and historical records remain available. */
export default async function AttendancePage({ params }: PageProps<"/s/[storeId]/attendance">) {
  const { storeId } = await params;
  redirect(`/s/${storeId}/staff`);
}
