// One-off, idempotent migration for the Phase 2/3 release. Safe to run several times.
//   npm run migrate:auth
// What it does:
//   1. Replaces the old UNIQUE index on users.phone with a PARTIAL unique index, so Google sign-ups
//      (which have no phone yet) do not collide with each other.
//   2. Creates the indexes of the new collections (sessions, audit logs, verification documents/cases).
// It never deletes data.
import mongoose from "mongoose";
import "../shared/config/env.js";

import User from "../modules/users/user.model.js";
import Session from "../shared/auth/session.model.js";
import AuditLog from "../modules/audit/audit.model.js";
import { VerificationDocument, VerificationCase } from "../modules/verification/verification.model.js";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

await mongoose.connect(process.env.MONGO_URI);

const users = mongoose.connection.collection("users");
const indexes = await users.indexes().catch(() => []);
const oldPhone = indexes.find((i) => i.name === "phone_1" && !i.partialFilterExpression);

if (oldPhone) {
  await users.dropIndex("phone_1");
  console.log("Dropped the old non-partial phone_1 index");
} else {
  console.log("phone_1 index already up to date (or not created yet)");
}

for (const model of [User, Session, AuditLog, VerificationDocument, VerificationCase]) {
  await model.createIndexes();
  console.log(`Indexes ready: ${model.collection.name}`);
}

await mongoose.disconnect();
console.log("Migration finished.");
