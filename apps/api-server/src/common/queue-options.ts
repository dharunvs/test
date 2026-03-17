import type { JobsOptions } from "bullmq";

export const reliableQueueOptions: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2000
  },
  removeOnComplete: 1000,
  removeOnFail: 5000
};

