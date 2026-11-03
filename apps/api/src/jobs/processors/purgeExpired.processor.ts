import { prisma } from "../../db/prisma";
import { runAsSystem } from "../../utils/requestContext";

/*
  PostgreSQL has no TTL indexes, so this hourly job deletes expired rows. Reads never depend on the
  purge having run: every lookup of these rows also checks expiry itself (sessions and links filter
  on expires_at). Deleting expired sessions directly (not through revokeSessions) is the one allowed
  exception: an expired session already fails authenticate's database check, and its cache key lives
  at most 60 s.
 */
export async function processPurgeExpired(now = new Date()) {
    return runAsSystem(async () => {
        const [sessions, verificationLinks] = await Promise.all([
            prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
            prisma.verificationLink.deleteMany({ where: { expiresAt: { lt: now } } }),
            // Phase 11: invites · Phase 13: dispatched outbox rows · Phase 28: audit log retention
        ]);
        return { sessions: sessions.count, verificationLinks: verificationLinks.count };
    });
}
