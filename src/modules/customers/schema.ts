import { z } from "zod";
import { money, optText } from "@/lib/validation";

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: optText,
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal("").transform(() => null)),
  address: optText,
  creditLimit: money.default(0),
  notes: optText,
  active: z.boolean().default(true),
});
