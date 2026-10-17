"use client";
import { ErrorState } from "@/components/data/primitives";
import Link from "next/link";
import { useParams } from "next/navigation";

/**
 * Covers the (pos) route group (the till screen), which previously had no
 * error boundary of its own and fell through to Next.js's bare built-in
 * error screen ("This page couldn't load") whenever pos-screen.tsx threw
 * during hydration — most commonly crypto.randomUUID() on a plain-HTTP
 * origin (see lib/uuid.ts).
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ storeId?: string }>();
  return <div className="mx-auto max-w-xl p-6">
    <ErrorState title="This page failed to load" description={error.digest ? `Reference: ${error.digest}` : "Please try again."} onRetry={reset} />
    {params.storeId && <Link className="mt-4 inline-block text-sm underline" href={`/s/${params.storeId}`}>Back to store</Link>}
  </div>;
}
