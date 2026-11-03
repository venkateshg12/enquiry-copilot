import { getDefaultStore } from "../middleware/rateLimiter";
import { INTAKE_CAP_PREFIX, ONE_DAY_MS } from "../constants/rateLimiter.constant";
import { INTAKE_DAILY_CAP } from "../constants/env";

export type IntakeCapResult = { withinCap: boolean; count: number; cap: number };

/*
  The per-business cap. Unlike the limiters it never rejects: over the cap the caller still saves
  the message but doesn't start the pipeline, so a flood can't run up the model bill and a real
  customer's message is never lost. A sliding 24 h window (not a calendar day) needs no timezone
  and can't be gamed at midnight. It runs on the limiter's store, so it inherits the circuit
  breaker: with Redis down the count is per process, which is looser, never stricter.
  Call it only for messages that will be stored, after the honeypot and the limiters.
 */
export const checkIntakeCap = async (orgId: string): Promise<IntakeCapResult> => {
    const cap = Number(INTAKE_DAILY_CAP);
    const result = await getDefaultStore().increment(`${INTAKE_CAP_PREFIX}:${orgId}`, ONE_DAY_MS, cap);
    return { withinCap: result.allowed, count: result.totalHits, cap };
};
