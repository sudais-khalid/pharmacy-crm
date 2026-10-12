import { z } from "zod";

export const adjustSchema = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["ADD", "REMOVE", "DAMAGE", "EXPIRY"]),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  note: z.string().trim().min(3, "Please give a reason").max(300),
});
