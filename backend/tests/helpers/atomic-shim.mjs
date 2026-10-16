// TEST-HARNESS ONLY. Never imported by application code.
//
// MongoDB guarantees that each single write operation (findOneAndUpdate, updateOne, insertOne...) is atomic per document.
// The MongoDB-compatible server used in the sandbox (FerretDB) does NOT: a conditional update that must have exactly one
// winner can have several (measured: 26-37 of 40 rounds). Without this shim, concurrency tests could not tell an application
// bug from a test-database artefact.
//
// The shim serialises individual WRITE operations through one queue, which emulates MongoDB's per-operation atomicity,
// while still letting separate requests interleave BETWEEN their steps (that is where real races live).
// It is slightly stricter than real MongoDB (updateMany is atomic per document there, not globally), so the final
// confirmation must still be run against real MongoDB / Atlas:  ATOMIC_SHIM=off  disables it.
import mongoose from "mongoose";

if (process.env.ATOMIC_SHIM !== "off") {
  const proto = mongoose.mongo.Collection.prototype;
  let tail = Promise.resolve();
  for (const name of ["findOneAndUpdate", "findOneAndDelete", "findOneAndReplace", "updateOne", "updateMany", "replaceOne", "insertOne", "insertMany", "deleteOne", "deleteMany", "bulkWrite"]) {
    const original = proto[name];
    if (typeof original !== "function" || original.__atomicShim) continue;
    const wrapped = function (...args) {
      const run = tail.then(() => original.apply(this, args));
      tail = run.catch(() => {}); // a failed write must not poison the queue
      return run;
    };
    wrapped.__atomicShim = true;
    proto[name] = wrapped;
  }
}
