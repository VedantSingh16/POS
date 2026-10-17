"use client";

import { LocalizedText } from "@/components/i18n/localized-text";
import { Input } from "@/components/ui/input";
import { OMAN_ADDRESS_FIELDS, OMAN_GOVERNORATES, omanGovernorate, type OmanAddressDetails, type OmanAddressKey } from "@pos/shared/address-formats";

export function OmanAddressFields({ value, onChange, disabled = false, idPrefix }: {
  value: OmanAddressDetails;
  onChange: (value: OmanAddressDetails) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const set = (key: OmanAddressKey, next: string) => onChange({ ...value, [key]: next });
  const governoratesId = `${idPrefix}-governorates`;
  const wilayatsId = `${idPrefix}-wilayats`;
  return <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
    {OMAN_ADDRESS_FIELDS.map((field) => <label className="grid gap-1 text-sm" key={field.key}>
      <LocalizedText value={field.label} />
      <Input
        value={value[field.key] ?? ""}
        onChange={(event) => set(field.key, event.target.value)}
        disabled={disabled}
        maxLength={field.maxLength}
        inputMode={field.inputMode}
        placeholder={field.placeholder}
        list={field.key === "governorate" ? governoratesId : field.key === "wilayat" ? wilayatsId : undefined}
      />
    </label>)}
    <datalist id={governoratesId}>{OMAN_GOVERNORATES.map((entry) => <option value={entry.name} key={entry.name} />)}</datalist>
    <datalist id={wilayatsId}>{(omanGovernorate(value.governorate)?.wilayats ?? []).map((name) => <option value={name} key={name} />)}</datalist>
    <p className="text-xs text-muted-foreground sm:col-span-2"><LocalizedText value={"Governorate and wilayat suggestions can be edited. Postal code is optional; if entered, use three digits."} /></p>
  </div>;
}
