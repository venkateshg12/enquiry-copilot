import "dotenv/config";
import { logger } from "./utils/logger";

/*
  The queue workers' entry point. Phase 08 adds the email worker, Phase 13 the outbox relay,
  Phase 21 the pipeline worker. index.ts imports closeWorkers/initSchedulers when it runs them
  in-process (RUN_WORKERS_IN_API=true).
 */
export const initSchedulers = async () => {};
export const startRelay = () => {};
export const closeWorkers = async () => {};

if (require.main === module) {
    logger.info("worker started (no workers until Phase 08)");
}
