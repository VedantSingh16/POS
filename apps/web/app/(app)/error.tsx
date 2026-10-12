"use client";
import { ErrorState } from "@/components/data/primitives";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="This page failed to load" description={error.digest ? `Reference: ${error.digest}` : "Please try again."} onRetry={reset} />;
}
