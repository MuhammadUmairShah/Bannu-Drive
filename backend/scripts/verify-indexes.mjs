// Certifies the DATABASE rules Bannu Drive's booking integrity depends on. Run it against your REAL MongoDB / Atlas:
//   MONGO_URI="mongodb+srv://..." npm run verify:indexes
// It (1) creates the application's indexes, (2) checks every declared index exists with the right options, and (3) PROVES
// the behaviour on a scratch collection (never your data): unique+sparse seat key, partial unique phone, unique googleId,
// one-current-document, unique idempotency/slot keys, TTL index. Exit code 1 if anything fails.
// On servers that do not implement partial indexes (e.g. FerretDB) the behaviour checks FAIL: that is the point.
import mongoose from "mongoose";
import "../shared/config/env.js";
import User from "../modules/users/user.model.js";
import Session from "../shared/auth/session.model.js";
import AuditLog from "../modules/audit/audit.model.js";
import { VerificationDocument, VerificationCase } from "../modules/verification/verification.model.js";
import { CoachBooking, CoachSchedule, CoachRoute, CoachOperator, Coach, CoachTripPoint } from "../modules/coach/coach.model.js";
import { CoachOrder, CoachPayment, CoachRefund } from "../modules/coach/coach.order.model.js";
import { CoachScan } from "../modules/coach/coach.scan.js";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
await mongoose.connect(process.env.MONGO_URI);
const info = await mongoose.connection.db.admin().serverInfo().catch(() => ({}));
console.log(`Server: MongoDB ${info.version || "?"}${info.ferretdb ? " (FerretDB)" : ""}\n`);

let fail = 0;
const ok = (name, cond, extra = "") => { if (!cond) fail++; console.log(`${cond ? "  PASS" : "  FAIL"}  ${name} ${cond ? "" : extra}`); };

// ---- 1+2: declared indexes exist ----
const models = [User, Session, AuditLog, VerificationDocument, VerificationCase, CoachBooking, CoachSchedule, CoachRoute, CoachOperator, Coach, CoachTripPoint, CoachOrder, CoachPayment, CoachRefund, CoachScan];
for (const M of models) {
  try { await M.createIndexes(); } catch (e) { fail++; console.log(`  FAIL  createIndexes ${M.modelName}: ${e.message}`); continue; }
  const have = await M.collection.indexes();
  const missing = M.schema.indexes().filter(([keys, opts]) => !have.some((h) => JSON.stringify(h.key) === JSON.stringify(keys) && !!h.unique === !!opts?.unique && !!h.sparse === !!opts?.sparse && (opts?.partialFilterExpression ? !!h.partialFilterExpression : true) && (opts?.expireAfterSeconds === undefined || h.expireAfterSeconds === opts.expireAfterSeconds)));
  ok(`${M.modelName}: ${M.schema.indexes().length} declared indexes present with the right options`, missing.length === 0, JSON.stringify(missing.map((m) => m[0])));
}

// ---- 3: behaviour, on scratch collections ----
const db = mongoose.connection.db;
const scratch = `__bd_verify_${Date.now()}`;
const dupe = async (fn) => { try { await fn(); return false; } catch (e) { return e.code === 11000 || /E11000|duplicate|UNIQUE/i.test(e.message); } };
const works = async (fn) => { try { await fn(); return true; } catch { return false; } };

console.log("\nBehaviour checks (scratch collections, dropped afterwards):");
try {
  // seat key: unique + sparse -> many docs WITHOUT a key allowed, a second doc WITH the same key refused
  const seats = db.collection(`${scratch}_seats`);
  await seats.createIndex({ activeSeatKey: 1 }, { unique: true, sparse: true });
  await seats.insertOne({ n: 1 }); await seats.insertOne({ n: 2 }); await seats.insertOne({ n: 3 });
  ok("activeSeatKey: many records without a key are allowed (cancelled/expired seats)", (await seats.countDocuments({})) === 3);
  await seats.insertOne({ activeSeatKey: "S1:05" });
  ok("activeSeatKey: a second record with the same key is REFUSED (no double booking)", await dupe(() => seats.insertOne({ activeSeatKey: "S1:05" })));
  await seats.updateOne({ activeSeatKey: "S1:05" }, { $unset: { activeSeatKey: 1 } });
  ok("activeSeatKey: after the key is released the seat can be taken again", await works(() => seats.insertOne({ activeSeatKey: "S1:05" })));
  ok("activeSeatKey: an UPDATE that would create a duplicate key is refused too (late-payment recovery)", await dupe(() => seats.updateOne({ n: 1 }, { $set: { activeSeatKey: "S1:05" } })));

  // concurrent seat race
  const race = db.collection(`${scratch}_race`);
  await race.createIndex({ activeSeatKey: 1 }, { unique: true, sparse: true });
  const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => race.insertOne({ activeSeatKey: "SCHED:10", who: i })));
  ok("25 truly concurrent inserts for one seat: exactly ONE wins", results.filter((r) => r.status === "fulfilled").length === 1, `winners=${results.filter((r) => r.status === "fulfilled").length}`);

  // atomic claim (the whole state machine depends on this)
  const claim = db.collection(`${scratch}_claim`);
  let bad = 0;
  for (let round = 0; round < 25; round++) {
    const { insertedId } = await claim.insertOne({ status: "HOLD" });
    const res = await Promise.all(Array.from({ length: 10 }, () => claim.findOneAndUpdate({ _id: insertedId, status: "HOLD" }, { $set: { status: "CONFIRMED" } })));
    if (res.filter((r) => (r?.value ?? r) && (r?.value ?? r).status === "HOLD").length !== 1) bad++;
  }
  ok("atomic claim: 10 concurrent findOneAndUpdate on one order -> exactly one winner, 25 rounds", bad === 0, `${bad} bad rounds`);

  // partial unique phone: empty phones may repeat (Google sign-ups), real phones may not
  const users = db.collection(`${scratch}_users`);
  await users.createIndex({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string", $gt: "" } } });
  ok("phone (partial unique): several users with an EMPTY phone are allowed", await works(async () => { await users.insertOne({ phone: "" }); await users.insertOne({ phone: "" }); await users.insertOne({}); }));
  await users.insertOne({ phone: "03001234567" });
  ok("phone (partial unique): a duplicate REAL phone is refused", await dupe(() => users.insertOne({ phone: "03001234567" })));

  // googleId
  const g = db.collection(`${scratch}_g`);
  await g.createIndex({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });
  await g.insertOne({}); await g.insertOne({});
  await g.insertOne({ googleId: "g-1" });
  ok("googleId (partial unique): users without Google are unlimited, one Google identity maps to ONE user", (await g.countDocuments({})) === 3 && (await dupe(() => g.insertOne({ googleId: "g-1" }))));

  // one current verification document per type
  const docs = db.collection(`${scratch}_docs`);
  await docs.createIndex({ owner: 1, type: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
  await docs.insertOne({ owner: 1, type: "CNIC", isCurrent: false }); await docs.insertOne({ owner: 1, type: "CNIC", isCurrent: false });
  await docs.insertOne({ owner: 1, type: "CNIC", isCurrent: true });
  ok("verification documents: unlimited old versions, exactly ONE current per type", await dupe(() => docs.insertOne({ owner: 1, type: "CNIC", isCurrent: true })));

  // idempotency key + open-order slots
  const orders = db.collection(`${scratch}_orders`);
  await orders.createIndex({ idemKey: 1 }, { unique: true, sparse: true });
  await orders.createIndex({ slotKey: 1 }, { unique: true, sparse: true });
  await orders.insertOne({ idemKey: "u1:k1", slotKey: "u1:1" });
  ok("idempotency key: the same request id cannot create a second order", await dupe(() => orders.insertOne({ idemKey: "u1:k1" })));
  ok("open-order slots: a customer's slot cannot be taken twice; orders without a slot are unlimited", (await dupe(() => orders.insertOne({ slotKey: "u1:1" }))) && (await works(async () => { await orders.insertOne({}); await orders.insertOne({}); })));

  // TTL index accepted
  const ttl = db.collection(`${scratch}_ttl`);
  ok("TTL index (expired holds / position history are erased automatically) is accepted", await works(() => ttl.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 })));
} catch (e) {
  fail++; console.log(`  FAIL  behaviour checks aborted: ${e.message}`);
} finally {
  for (const c of await db.listCollections({ name: new RegExp(`^${scratch}`) }).toArray()) await db.collection(c.name).drop().catch(() => {});
}

console.log(fail ? `\n${fail} CHECK(S) FAILED: do not go live on this database until they pass.` : "\nAll database integrity checks passed on this server.");
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
