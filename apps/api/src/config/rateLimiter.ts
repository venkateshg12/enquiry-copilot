import { Request } from "express";
import { createDualRateLimiter, createRateLimiter } from "../middleware/rateLimiter";
import { extractClientIp } from "../utils/rateLimiter/ipExtractor";
import {
    AUTH_FORGOT_ACCOUNT_PREFIX,
    AUTH_FORGOT_PASS_PREFIX,
    AUTH_FORGOT_SOURCE_PREFIX,
    AUTH_LOGIN_ACCOUNT_PREFIX,
    AUTH_LOGIN_SOURCE_PREFIX,
    AUTH_LOGIN_PREFIX,
    AUTH_REFRESH_PREFIX,
    AUTH_REFRESH_SOURCE_PREFIX,
    AUTH_REGISTER_PREFIX,
    AUTH_REGISTER_SOURCE_PREFIX,
    AUTH_RESET_PREFIX,
    AUTH_VERIFY_PREFIX,
    AUTH_VERIFY_RESEND_ACCOUNT_PREFIX,
    AUTH_VERIFY_RESEND_SOURCE_PREFIX,
    FIFTEEN_MINUTES_MS,
    FIVE_MINUTES_MS,
    GLOBAL_IP_PREFIX,
    GLOBAL_VISITOR_PREFIX,
    INTAKE_FORM_PREFIX,
    INTAKE_IP_PREFIX,
    INTAKE_IP_PUNITIVE_PREFIX,
    INTAKE_VISITOR_PREFIX,
    INVITE_TARGET_PREFIX,
    ONE_DAY_MS,
    ONE_HOUR_MS,
    PROTECTED_API_PREFIX,
    TEN_MINUTES_MS,
    THIRTY_MINUTES_MS,
} from "../constants/rateLimiter.constant";
import { refreshTokenVerifyOptions, verifyToken } from "../utils/auth";
import { RefreshTokenPayload } from "../types/auth.types";

/*
  Key Resolvers
 */
const ipAndEmailKeyResolver = (req: Request): string => {
    const ip = extractClientIp(req);
    return `ip:${ip}:email:${emailKeyPart(req)}`;
};

// The account being tried, independent of where the attempt came from.
const emailKeyPart = (req: Request): string =>
    req.body?.email ? String(req.body.email).toLowerCase().trim() : "anonymous";

const emailKeyResolver = (req: Request): string => `email:${emailKeyPart(req)}`;

const ipKeyResolver = (req: Request): string => `ip:${extractClientIp(req)}`;

const visitorKeyResolver = (req: Request): string => {
    return req.visitorId || req.cookies?.visitorId || extractClientIp(req);
};

/*
  The session a refresh cookie belongs to, so every signed-in user gets their own refresh budget
  instead of sharing one per IP — behind an office NAT or carrier-grade NAT, an IP-keyed budget ran
  out and the client then signed out everyone on that address. Verifying is a single HMAC, so it's
  cheap; a missing or forged cookie falls back to the IP.
 */
const refreshSessionKeyResolver = (req: Request): string => {
    const refreshToken = req.cookies?.refreshToken;
    if (typeof refreshToken === "string") {
        const { payload } = verifyToken<RefreshTokenPayload>(refreshToken, refreshTokenVerifyOptions);
        if (payload?.sessionId) {
            return `session:${payload.sessionId}`;
        }
    }
    return `ip:${extractClientIp(req)}`;
};

/*
  1. Global Infrastructure Protection (Atomic Dual-Bucket)
  Runs pre-auth across all incoming requests.
  Evaluates both:
  - Anonymous browser fairness: 500 requests / 5 minutes
  - Aggregate IP flood defense: 2000 requests / 5 minutes
 */
export const globalLimiter = createDualRateLimiter({
    visitorPrefix: GLOBAL_VISITOR_PREFIX,
    ipPrefix: GLOBAL_IP_PREFIX,
    windowMs: FIVE_MINUTES_MS,
    visitorLimit: 500,
    ipLimit: 2000,
    visitorKeyResolver: (req: Request) => visitorKeyResolver(req),
    ipKeyResolver: (req: Request) => extractClientIp(req)
});

/*
  2. Authentication Limiters
  Security-sensitive; applies punitive temporary lockouts to the specific ip:email key.
 */
export const loginLimiter = createRateLimiter({
    prefix: AUTH_LOGIN_PREFIX,
    windowMs: FIVE_MINUTES_MS,
    blockDurationMs: THIRTY_MINUTES_MS,
    max: 10,
    keyResolver: ipAndEmailKeyResolver
});

/*
  The pair above is one axis of three, and on its own it stops neither shape of credential attack:
  spread one account across many sources and no pair fills up; walk a list of accounts from one
  source and, again, no pair fills up. These two cover those axes — an account is locked however
  many places the guesses come from, and a source is capped however many accounts it tries.
  All three run on the login route; the first to reject wins.
*/
/*
  Not punitive on purpose. This key is only the email, which anyone can type, so a lockout here let
  anyone lock any user out for 30 minutes at a time with 15 bad guesses. As a plain sliding window it
  still caps guesses against one account, but the real user regains access as soon as the window
  moves on, and an attacker can't extend a lock.
*/
export const loginAccountLimiter = createRateLimiter({
    prefix: AUTH_LOGIN_ACCOUNT_PREFIX,
    windowMs: FIFTEEN_MINUTES_MS,
    max: 15,
    keyResolver: emailKeyResolver
});

// Deliberately loose: a household or office behind one NAT address shares it, so this is sized to
// catch account enumeration rather than to police normal shared use.
export const loginSourceLimiter = createRateLimiter({
    prefix: AUTH_LOGIN_SOURCE_PREFIX,
    windowMs: FIFTEEN_MINUTES_MS,
    max: 50,
    keyResolver: ipKeyResolver
});

// The ip+email limiter below gives each new address its own bucket, so on its own it let one source
// register (and send verification mail to) any number of addresses.
export const registerSourceLimiter = createRateLimiter({
    prefix: AUTH_REGISTER_SOURCE_PREFIX,
    windowMs: ONE_HOUR_MS,
    max: 10,
    keyResolver: ipKeyResolver
});

export const registerLimiter = createRateLimiter({
    prefix: AUTH_REGISTER_PREFIX,
    windowMs: FIVE_MINUTES_MS,
    blockDurationMs: ONE_HOUR_MS,
    max: 5,
    keyResolver: ipAndEmailKeyResolver
});

export const forgotPasswordLimiter = createRateLimiter({
    prefix: AUTH_FORGOT_PASS_PREFIX,
    windowMs: FIVE_MINUTES_MS,
    blockDurationMs: THIRTY_MINUTES_MS,
    max: 10,
    keyResolver: ipAndEmailKeyResolver
});

// Caps how many reset mails one address can be sent however many sources ask for them, so the
// endpoint can't be used to bury someone's inbox.
export const forgotPasswordAccountLimiter = createRateLimiter({
    prefix: AUTH_FORGOT_ACCOUNT_PREFIX,
    windowMs: ONE_HOUR_MS,
    max: 5,
    keyResolver: emailKeyResolver
});

export const forgotPasswordSourceLimiter = createRateLimiter({
    prefix: AUTH_FORGOT_SOURCE_PREFIX,
    windowMs: FIFTEEN_MINUTES_MS,
    max: 20,
    keyResolver: ipKeyResolver
});

// The reset link carries a 256-bit token, so this only curbs floods of junk tokens. It has its own
// prefix because the body carries no email — it used to share the forgot-password bucket name.
export const resetPasswordLimiter = createRateLimiter({
    prefix: AUTH_RESET_PREFIX,
    windowMs: FIVE_MINUTES_MS,
    blockDurationMs: THIRTY_MINUTES_MS,
    max: 10,
    keyResolver: ipKeyResolver
});

// Clicking a verification link. Kept separate from resending one, so asking for a few new links
// can't use up the budget for actually verifying.
export const verifyEmailLimiter = createRateLimiter({
    prefix: AUTH_VERIFY_PREFIX,
    windowMs: FIVE_MINUTES_MS,
    blockDurationMs: THIRTY_MINUTES_MS,
    max: 5,
    keyResolver: ipKeyResolver
});

export const resendVerificationSourceLimiter = createRateLimiter({
    prefix: AUTH_VERIFY_RESEND_SOURCE_PREFIX,
    windowMs: FIFTEEN_MINUTES_MS,
    max: 5,
    keyResolver: ipKeyResolver
});

// Caps verification mails to one address however many sources ask, so the endpoint can't be used
// to flood someone's inbox.
export const resendVerificationAccountLimiter = createRateLimiter({
    prefix: AUTH_VERIFY_RESEND_ACCOUNT_PREFIX,
    windowMs: ONE_HOUR_MS,
    max: 3,
    keyResolver: emailKeyResolver
});

export const refreshTokenLimiter = createRateLimiter({
    prefix: AUTH_REFRESH_PREFIX,
    windowMs: FIFTEEN_MINUTES_MS,
    max: 20,
    keyResolver: refreshSessionKeyResolver
});

// Loose on purpose: sized for many signed-in users behind one address, it only stops a single source
// hammering the endpoint with forged or rotating cookies.
export const refreshTokenSourceLimiter = createRateLimiter({
    prefix: AUTH_REFRESH_SOURCE_PREFIX,
    windowMs: FIFTEEN_MINUTES_MS,
    max: 300,
    keyResolver: ipKeyResolver
});

/*
  5. Authenticated Customer APIs (Post-Auth)
  Isolates users behind shared NAT/cellular towers; protects against runaway client loops.
 */
export const protectedApiLimiter = createRateLimiter({
    prefix: PROTECTED_API_PREFIX,
    windowMs: FIVE_MINUTES_MS,
    max: 300,
    keyResolver: (req: Request) => `user:${req.userId}`
});

// Phase 10: inviteSourceLimiter (INVITE_SOURCE_PREFIX, 30 / hour, keyed by `org:${req.orgId}`): it
// needs req.orgId, which the org middleware adds. Phase 11 attaches it to the invite routes.

export const inviteTargetLimiter = createRateLimiter({
    prefix: INVITE_TARGET_PREFIX,
    windowMs: ONE_DAY_MS,
    max: 3,
    keyResolver: emailKeyResolver
});

/*
  Intake (Phase 13). The widget posts cross-site, where a visitorId cookie is a blocked
  third-party cookie, so the widget sends its own random id. It's a fairness key, not a security
  boundary: the IP bucket beside it is what a spoofer can't escape.
 */
const VISITOR_HEADER_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const intakeVisitorKeyResolver = (req: Request): string => {
    const header = req.get("x-enquiry-visitor");
    if (header && VISITOR_HEADER_PATTERN.test(header)) return `w:${header}`;
    return visitorKeyResolver(req);
};

// A person might send two or three messages; five in ten minutes from one browser is a script.
// The IP pool is generous because campuses and carriers put hundreds of people on one address.
export const intakeDualLimiter = createDualRateLimiter({
    visitorPrefix: INTAKE_VISITOR_PREFIX,
    ipPrefix: INTAKE_IP_PREFIX,
    windowMs: TEN_MINUTES_MS,
    visitorLimit: 5,
    ipLimit: 30,
    visitorKeyResolver: intakeVisitorKeyResolver,
    ipKeyResolver: (req: Request) => extractClientIp(req),
});

// A source that keeps going past the pool is a bot: lock it out for an hour.
export const intakePunitiveLimiter = createRateLimiter({
    prefix: INTAKE_IP_PUNITIVE_PREFIX,
    windowMs: ONE_HOUR_MS,
    blockDurationMs: ONE_HOUR_MS,
    max: 60,
    keyResolver: ipKeyResolver,
});

// A distributed flood against one business's form. Keyed by the public form key from the URL.
export const intakeFormLimiter = createRateLimiter({
    prefix: INTAKE_FORM_PREFIX,
    windowMs: TEN_MINUTES_MS,
    max: 120,
    keyResolver: (req: Request) => `form:${String(req.params.formKey ?? "unknown")}`,
});
