// Static check: every .js file under the backend must import cleanly (catches wrong paths / missing exports).
// Needs no database. Run: npm run check
import { readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";

process.env.JWT_SECRET ||= "check-only-secret-check-only-secret";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:1/none";

const roots = ["shared", "modules"];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") && files.push(p);
  }
};
roots.forEach(walk);
files.push("app.js", "index.js");

let failed = 0;
for (const f of files) {
  try {
    await import(pathToFileURL(resolve(f)).href);
  } catch (e) {
    failed++;
    console.error(`FAIL ${f}: ${e.message}`);
  }
}
console.log(`${files.length - failed}/${files.length} modules import cleanly`);
process.exit(failed ? 1 : 0);
