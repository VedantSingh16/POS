import { Skeleton } from "@/components/ui/skeleton";
import { LocalizedText } from "@/components/i18n/localized-text";

export default function Loading() {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only"><LocalizedText value={"Loading"} /></span>
      <Skeleton className="h-7 w-56" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-72" />
    </div>
  );
}
