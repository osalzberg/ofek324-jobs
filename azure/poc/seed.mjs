import { readFile } from "node:fs/promises";
import { connect, query } from "./client.mjs";
const c = await connect();
try {
  await query(c, await readFile(new URL("../seed.sql", import.meta.url), "utf8"));
  console.log("Synthetic examples ready: 3 accounts, 3 jobs, 2 profiles, 1 approved recommendation; no sessions or emails.");
} finally { c.close(); }
