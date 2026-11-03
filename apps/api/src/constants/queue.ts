export const QUEUE_NAMES = {
    EMAIL: 'email-queue',
    DEAD_LETTER: 'dead-letter-queue',
    MAINTENANCE: 'maintenance-queue',
    // Phase 21: PIPELINE · Phase 24: SEND_REPLY · Phase 25: GMAIL_POLL
} as const;

export const JOB_NAMES = {
    EMAIL: {
        VERIFY_EMAIL: 'send_verify_email',
        PASSWORD_RESET: 'send_password_reset',
        // Phase 11: ORG_INVITE · Phase 22: BUDGET_WARNING
    },
    MAINTENANCE: {
        PURGE_EXPIRED: 'purge-expired',
        // Phase 28: RETENTION_SWEEP   (the outbox relay, Phase 13, is a polling loop in the worker, not a job)
    },
} as const;
