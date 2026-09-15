import { db } from './src/api/database';
import * as schema from './src/api/database/schema';
import { eq } from 'drizzle-orm';

const ap = await db.select().from(schema.autopilotConfig).where(eq(schema.autopilotConfig.enabled, true)).catch(() => []);
console.log('autopilot enabled:', ap.length);
const mm = await db.select().from(schema.moneyMakerConfig).where(eq(schema.moneyMakerConfig.enabled, true)).catch(() => []);
console.log('moneyMaker enabled:', mm.length);
