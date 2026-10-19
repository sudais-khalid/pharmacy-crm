import { z } from "zod";

/** Developer sign-in. */
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

/** Staff sign-in: pharmacy URL name, then username (or email) and password. */
export const staffLoginSchema = z.object({
  pharmacy: z.string().trim().toLowerCase().min(1, "Enter the pharmacy code").max(40),
  username: z.string().trim().toLowerCase().min(1, "Enter your username").max(120),
  password: z.string().min(1, "Enter your password"),
});

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,29}$/, "2 to 30 letters, digits, dot, dash or underscore");

/** A new staff account: it gets an invite link, or a temporary password to change at first sign-in. */
export const userCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("A valid email is required").max(120),
  username: usernameSchema.optional().or(z.literal("").transform(() => undefined)),
  roleId: z.string().uuid("Choose a role"),
  credentials: z.enum(["invite", "password"]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  roleId: z.string().uuid().optional(),
  active: z.boolean().optional(),
});
