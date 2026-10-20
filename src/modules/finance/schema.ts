import { z } from "zod";
import { dateStr } from "@/lib/validation";

export const expenseSchema = z.object({
  categoryId: z.string().uuid("Choose a category"),
  amount: z.coerce.number().positive("Enter an amount").max(100_000_000),
  date: dateStr,
  method: z.enum(["CASH", "CARD"]),
  description: z.string().trim().min(2, "Say what it was for").max(300),
  // a form sends "true" or "false" as text, and z.coerce.boolean would read "false" as true
  fromDrawer: z.preprocess((v) => v === true || v === "true" || v === "1" || v === "on", z.boolean()).default(false),
});
export const categorySchema = z.object({ name: z.string().trim().min(2).max(60), active: z.boolean().optional() });
export const cancelExpenseSchema = z.object({ reason: z.string().trim().min(3, "Please give a reason").max(300) });
