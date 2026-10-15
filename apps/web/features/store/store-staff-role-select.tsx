"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";

export function StoreStaffRoleSelect({ storeId, userId, initialRoleId, roleOptions }: {
  storeId: string; userId: string; initialRoleId: string; roleOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [roleId, setRoleId] = React.useState(initialRoleId);
  const [busy, setBusy] = React.useState(false);
  const changed = roleId !== initialRoleId;

  async function save() {
    setBusy(true);
    try {
      await clientApi(`/admin/stores/${storeId}/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ roleId: roleId || null }),
      });
      toast.success("Store role updated");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the store role");
    } finally { setBusy(false); }
  }

  return <div className="flex min-w-48 items-center gap-2">
    <NativeSelect aria-label="Assign store role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
      <option value=""><LocalizedText value={"No store role"} /></option>
      {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
    </NativeSelect>
    <Button size="sm" variant="outline" disabled={!changed || busy} onClick={() => void save()}><LocalizedText value={busy ? "Saving…" : "Save"} /></Button>
  </div>;
}
