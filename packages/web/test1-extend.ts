import { db } from "./src/api/database/index";
import * as schema from "./src/api/database/schema";
import { eq } from "drizzle-orm";

const token = "43ac936f-d701-40a3-8a37-f0b253aa6de484e1fbac-9ed6-421d-bf6e-e543290b3aa2";
await db.update(schema.sessions)
  .set({ expiresAt: new Date(Date.now() + 24 * 3600 * 1000) } as any)
  .where(eq(schema.sessions.id, token));
console.log("session prolongée +24h");
