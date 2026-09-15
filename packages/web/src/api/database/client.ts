import "./url"; // normalise DATABASE_URL avant toute création de client
import { createClient } from "@libsql/client";

/** Client libSQL brut — pour le SQL direct (CREATE TABLE, ALTER TABLE, ...). */
export const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
  intMode: "number",
});
