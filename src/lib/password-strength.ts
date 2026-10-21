/**
 * How strong the Developer password must be. Its bcrypt hash travels in every installer and, with the
 * shared authenticator, it also seals the second factor, so it is what an offline guess would attack.
 * Returns why a password is too weak, or null.
 */
const COMMON = ["password", "passw0rd", "pharmacy", "admin", "owner", "developer", "welcome", "qwerty", "letmein", "123456", "12345", "abc123", "iloveyou", "secret", "crm"];

export function developerPasswordProblem(password: string, email = ""): string | null {
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const lower = password.toLowerCase();
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (password.length < 16) return "at least 16 characters are needed";
  if (password.length < 24 && kinds < 3) return "mix at least three of: lower case, upper case, digits and symbols (or use 24 characters or more)";
  const word = COMMON.find((w) => lower.includes(w));
  if (word) return `it contains the common word "${word}"`;
  if (local.length >= 4 && lower.includes(local)) return "it contains the email name";
  if (/(.)\1{3,}/.test(password)) return "it repeats one character four times or more";
  return null;
}
