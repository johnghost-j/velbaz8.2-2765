import { db } from "./src/api/database/index";
import * as schema from "./src/api/database/schema";

const users = await db.select().from(schema.users);
console.log("users:", users.length, users.map((u: any) => u.email));
const sessions = await db.select().from(schema.sessions);
console.log("sessions:", sessions.length);
for (const s of sessions as any[]) {
  console.log("  token:", String(s.id).slice(0, 20), "… userId:", s.userId, "expires:", s.expiresAt, "expiré?", new Date(s.expiresAt) < new Date());
}
