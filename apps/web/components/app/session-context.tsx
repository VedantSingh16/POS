"use client";
import * as React from "react";
import { hasPermission, type Me } from "@/lib/permissions";
import { setActiveCurrency } from "@/lib/format";

const SessionContext = React.createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  // Set during render (not in an effect) so the first paint already uses the organisation's currency.
  setActiveCurrency(me.organisation.currency);
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

/** Like `useMe`, but returns null outside a session (for shared components that may render anywhere). */
export function useMaybeMe(): Me | null {
  return React.useContext(SessionContext);
}

export function useMe(): Me {
  const me = React.useContext(SessionContext);
  if (!me) throw new Error("useMe must be used inside <SessionProvider>");
  return me;
}

/** UI hint only: the API enforces the same rule on every call. */
export function usePermission(code: string, storeId?: string): boolean {
  return hasPermission(useMe(), code, storeId);
}

export function Can({ permission, storeId, fallback = null, children }: { permission: string; storeId?: string; fallback?: React.ReactNode; children: React.ReactNode }) {
  return usePermission(permission, storeId) ? <>{children}</> : <>{fallback}</>;
}
