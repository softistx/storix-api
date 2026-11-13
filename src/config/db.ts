import { connectMongo } from "@softistx/mongo";
import { env } from "./env";

// ONE MongoClient for the whole process (connectMongo shares it per URI), never
// one per workspace. A1 opens the core database on it (`defineMongo` needs at
// least one collection: the translations), E1 the workspaces' databases; none
// of them closes it: `closeDatabases` below does.
export const connection = await connectMongo(env.MONGO_URI, {
  appName: "storix-api",
});

// Whether MongoDB answers a ping within a second (GET /ready).
export async function mongoAnswers(): Promise<boolean> {
  try {
    const answer = await connection.client
      .db("admin")
      .command({ ping: 1 }, { timeoutMS: 1_000 });
    return answer["ok"] === 1;
  } catch {
    return false;
  }
}

// The shutdown: the shared client, last.
export async function closeDatabases() {
  await connection.close();
}
