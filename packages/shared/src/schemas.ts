import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const moneySchema = z.number().int().nonnegative();
export const jsonObjectSchema = z.record(z.string(), z.unknown());

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationSlug: z.string().min(1).optional(),
});

export const pinSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) });

export const storeIdSchema = z.object({ storeId: uuidSchema });
