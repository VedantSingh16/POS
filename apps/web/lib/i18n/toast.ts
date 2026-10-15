"use client";

import { toast as sonnerToast } from "sonner";
import { translateText, type Locale } from "@/lib/i18n/messages";

function activeLocale(): Locale {
  return typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar" : "en";
}

function localize(value: unknown): unknown {
  return typeof value === "string" ? translateText(value, activeLocale()) : value;
}

/** Keep the Sonner API intact while translating known application messages at the shared boundary. */
export const toast = new Proxy(sonnerToast, {
  apply(target, thisArg, args: unknown[]) {
    return Reflect.apply(target, thisArg, [localize(args[0]), ...args.slice(1)]);
  },
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      if (property === "promise" && args[1] && typeof args[1] === "object") {
        const messages = args[1] as Record<string, unknown>;
        const translated = Object.fromEntries(Object.entries(messages).map(([key, message]) => [key, localize(message)]));
        return Reflect.apply(value, target, [args[0], translated, ...args.slice(2)]);
      }
      return Reflect.apply(value, target, [localize(args[0]), ...args.slice(1)]);
    };
  },
}) as typeof sonnerToast;
