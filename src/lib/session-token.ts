import { SignJWT, jwtVerify } from "jose";

/**
 * Signed session tokens, one realm per kind of account (docs/plan/02-architecture.md, section 5.3).
 * The realm is the JWT audience, so a token from one realm is rejected by the others.
 * Dependency free (jose only) so the Edge middleware can verify tokens too.
 */
export type SessionRealm = "staff" | "platform";

export const SESSION_COOKIES: Record<SessionRealm, string> = { staff: "pcrm_staff", platform: "pcrm_platform" };
export const SESSION_MAX_AGE_S: Record<SessionRealm, number> = { staff: 8 * 3600, platform: 2 * 3600 };

const ISSUER = "pharmacy-crm";

/** Claims: sub = account id, sv = session version (bumped to revoke), pid = pharmacy, mfa = second factor done. */
export type SessionClaims = { sub: string; sv: number; pid?: string; mfa?: boolean };
export type VerifiedSession = SessionClaims & { iat: number; exp: number };

function key() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET must be set and at least 32 characters long");
  return new TextEncoder().encode(s);
}

export async function signSession(realm: SessionRealm, claims: SessionClaims): Promise<string> {
  const { sub, ...rest } = claims;
  return new SignJWT(rest)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience(realm)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S[realm]}s`)
    .sign(key());
}

export async function verifySession(realm: SessionRealm, token: string | undefined): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: realm, issuer: ISSUER, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.sv !== "number" || !payload.iat || !payload.exp) return null;
    if (realm === "staff" && typeof payload.pid !== "string") return null;
    return { sub: payload.sub, sv: payload.sv, pid: payload.pid as string | undefined, mfa: payload.mfa === true, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

/** Sliding sessions: re-issue once more than half of the lifetime has passed. */
export function needsRefresh(session: VerifiedSession, now = Date.now() / 1000) {
  return now - session.iat > (session.exp - session.iat) / 2;
}
