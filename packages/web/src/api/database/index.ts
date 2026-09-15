import "./url"; // doit rester le premier import : normalise DATABASE_URL

export { db } from "./__client";
export { client } from "./client";
export { ensureRuntimeTables } from "./runtime-tables";
