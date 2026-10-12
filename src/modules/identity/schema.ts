import { z } from "zod";

/** Developer sign-in. */
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

/** Staff sign-in: pharmacy URL name, then username (or email) and password. */
export const staffLoginSchema = z.object({
  pharmacy: z.string().trim().toLowerCase().min(1, "Enter the pharmacy code").max(40),
  username: z.string().trim().toLowerCase().min(1, "Enter your username").max(120),
  password: z.string().min(1, "Enter your password"),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  role: z.enum(["ADMIN", "PHARMACIST", "CASHIER"]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["ADMIN", "PHARMACIST", "CASHIER"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(100).optional().or(z.literal("").transform(() => undefined)),
});
