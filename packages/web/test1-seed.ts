// Seed un user + session de test pour le run e2e /test1.
import { db } from "./src/api/database/index";
import * as schema from "./src/api/database/schema";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";

const userId = randomUUID();
const token = randomUUID() + randomUUID();

const existing = await db.select().from(schema.users).get();
console.log("users existants:", existing ? "oui" : "non");

// passwordHash format: check schema quickly — on met un hash scrypt plausible
const salt = randomBytes(16).toString("hex");
const hash = scryptSync("test1-password", salt, 64).toString("hex");

await db.insert(schema.users).values({
  id: userId,
  email: "test1-e2e@local.dev",
  name: "Test1 E2E",
  passwordHash: `${salt}:${hash}`,
  plan: "pro",
} as any);

await db.insert(schema.sessions).values({
  id: token,
  userId,
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
} as any);

console.log("TOKEN=" + token);
console.log("USER_ID=" + userId);
