import { bucket } from "./config/bucket";
import { closeDatabases } from "./config/db";
import { appRedis, closeQueues } from "./config/redis";
import { startRenditionsWorker } from "./workers/renditions";

// The background jobs as their own process (dist/worker.js): today the
// renditions (`thumb` and `preview` of pictures and PDFs). It needs the same
// MONGO_URI, REDIS_URL and S3_* as the server. Any number may run; each job
// goes to one of them. SIGTERM and SIGINT stop it gracefully: the running jobs
// get 20 seconds to finish, then Redis and Mongo close.
if (appRedis === undefined) {
  console.error("the worker needs REDIS_URL");
  process.exit(1);
}
if (bucket === undefined) {
  console.error("the worker needs S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY");
  process.exit(1);
}
startRenditionsWorker(appRedis, bucket);
console.log("renditions worker started");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await closeQueues({ grace: "20s" });
  } finally {
    try {
      await closeDatabases();
    } finally {
      process.exit(0);
    }
  }
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
