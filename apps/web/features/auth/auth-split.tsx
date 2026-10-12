import type { ReactNode } from "react";

const LEVELS = [
  { n: 1, title: "Organisation", text: "Owns the catalogue, tax groups, customers and team." },
  { n: 2, title: "Stores", text: "Each store trades on its own registers, stock and staff." },
  { n: 3, title: "Store operations", text: "Managers and cashiers only see the stores they are assigned to." },
];

/** Shared frame for sign-in and registration: form on the left, the organisation → store hierarchy on the right. */
export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_32rem]">
      <div className="flex flex-col px-6 py-8 sm:px-14">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded-md bg-sidebar text-xs font-bold text-sidebar-primary">D</span>DeltCRM POS
        </div>
        <div className="flex flex-1 items-center justify-center py-10">{children}</div>
        <p className="text-xs text-muted-foreground">Sessions are kept in a secure cookie. Never share your PIN.</p>
      </div>
      <aside className="hidden flex-col justify-center gap-7 bg-sidebar p-14 text-sidebar-foreground lg:flex">
        <p className="max-w-sm text-2xl font-semibold leading-tight tracking-tight text-white">One organisation. Many stores. Clear boundaries.</p>
        <ol className="grid gap-5">
          {LEVELS.map((l) => (
            <li key={l.n} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-md border border-sidebar-border text-xs font-semibold text-sidebar-primary">{l.n}</span>
              <div><p className="font-medium text-white">{l.title}</p><p className="text-sm text-sidebar-muted">{l.text}</p></div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
