"use client";

/**
 * Last-resort boundary: Next.js renders this only when an error escapes
 * every nested error.tsx, including one thrown by the root layout itself
 * (e.g. if LocaleProvider or its children ever fail to mount). Because the
 * root layout is gone at that point, this file must render its own <html>
 * and <body> and cannot rely on anything the root layout normally provides
 * (fonts, LocaleProvider context, Toaster) — LocalizedText/useLocale would
 * themselves throw ("LocaleProvider is missing") if used here, so this
 * stays plain, untranslated text on purpose.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ display: "flex", minHeight: "100vh", background: "#f8fafc", color: "#111827", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.75rem", fontFamily: "system-ui, sans-serif", padding: "1.5rem", textAlign: "center" }}>
        <p style={{ fontSize: "1rem", fontWeight: 600 }}>Something went wrong</p>
        {error.digest && <p style={{ fontSize: "0.875rem", color: "#64748b" }}>Reference: {error.digest}</p>}
        <button onClick={reset} style={{ marginTop: "0.5rem", height: "2.75rem", borderRadius: "0.375rem", border: "1px solid #cbd5e1", background: "#fff", padding: "0 1rem", fontSize: "1rem", fontWeight: 500, cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
