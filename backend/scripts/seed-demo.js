// Usage: npm run seed-demo      (optional: DEMO_OPERATOR_PASSWORD in .env)
// Creates the DEMO coach operator "Adil Coaches - DEMO", a 40-seat coach, the routes
// Bannu -> Peshawar and Bannu -> Islamabad, and the next 14 days of departures.
// Safe to run repeatedly. These are demo records only, not real partners of Bannu Drive.
import dotenv from "dotenv";
import mongoose from "mongoose";
import { seedDemo, DEMO_EMAIL } from "../modules/coach/coach.demo.js";

dotenv.config();

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing");
  await mongoose.connect(process.env.MONGO_URI);

  const result = await seedDemo(process.env.DEMO_OPERATOR_PASSWORD || undefined);
  console.log(result.created ? "Demo operator created." : "Demo operator already existed.");
  console.log(`Schedules created this run: ${result.schedulesCreated}`);
  if (result.created) {
    console.log(`Login (role: Operator):  ${DEMO_EMAIL}  /  ${result.password}`);
    console.log("Save this password now; it is not shown again.");
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
