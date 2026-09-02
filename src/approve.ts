import { openDb } from "./db.ts";
import { approve } from "./governor.ts";

const pendingId = process.argv[2];
if (!pendingId) {
  console.error("Usage: npm run approve -- <pending_id>");
  process.exit(1);
}

const db = openDb();
approve(db, pendingId);
console.log(`Approved ${pendingId}. The agent may now call execute_approved once.`);
