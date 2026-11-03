import { Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue";
import { processPasswordReset, processVerifyEmail } from "../processors/email.processor";
import { PasswordResetPayload, VerifyEmailPayload } from "../interfaces/jobPayload";
import { onFinalFailure } from "../deadLetter";
import { redisConnection } from "../redis/connection";
import { logger } from "../../utils/logger";

export const emailWorker = new Worker(
    QUEUE_NAMES.EMAIL,
    async (job: Job<any>) => {
        switch (job.name) {
            case JOB_NAMES.EMAIL.VERIFY_EMAIL:
                return await processVerifyEmail(job as Job<VerifyEmailPayload>);
            case JOB_NAMES.EMAIL.PASSWORD_RESET:
                return await processPasswordReset(job as Job<PasswordResetPayload>);
            // Phase 11: ORG_INVITE · Phase 22: BUDGET_WARNING
            default:
                throw new Error(`Unknown job name: ${job.name}`);
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,        // Process up to 5 jobs concurrently
        lockDuration: 30000,   // 30 seconds lock duration
        limiter: {
            max: 2,         // 2 emails per second (safe for Gmail/Mailtrap)
            duration: 1000,
        }
    }
);

emailWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "[EmailWorker] Job completed");
});
emailWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, "[EmailWorker] Job failed");
    void onFinalFailure(job, err);
});
emailWorker.on('stalled', (jobId) => {
    logger.warn({ jobId }, "[EmailWorker] Job stalled: check CPU load / event loop freeze");
});
emailWorker.on('error', (err) => {
    logger.error({ err: err.message }, "[EmailWorker Connection Error]");
});