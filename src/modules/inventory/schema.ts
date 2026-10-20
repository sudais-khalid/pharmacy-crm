import { z } from "zod";

export const adjustSchema = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["ADD", "REMOVE", "DAMAGE", "EXPIRY"]),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  note: z.string().trim().min(3, "Please give a reason").max(300),
});

export const batchListSchema = z.object({ batchIds: z.array(z.string().uuid()).min(1, "Choose at least one batch").max(500) });
export const writeOffSchema = batchListSchema.extend({ note: z.string().trim().min(3, "Please give a reason").max(300) });
export const setAsideSchema = batchListSchema.extend({ aside: z.boolean(), note: z.string().trim().max(300).optional().nullable() });
