import dotenv from "dotenv";
import dns from "dns";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import userModel from "../modules/users/user.model.js";
import { isValidEmail, isValidPhone } from "../shared/utils/validators.js";

dotenv.config();

// DNS for MongoDB Atlas SRV (same as app.js)
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const { MONGO_URI, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD } = process.env;

async function main() {
  if (!MONGO_URI) throw new Error("MONGO_URI is missing");
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PHONE || !ADMIN_PASSWORD) {
    throw new Error("Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE and ADMIN_PASSWORD in .env first");
  }
  if (!isValidEmail(ADMIN_EMAIL)) throw new Error("ADMIN_EMAIL is not a valid email");
  if (!isValidPhone(ADMIN_PHONE)) throw new Error("ADMIN_PHONE is not a valid phone number");
  if (ADMIN_PASSWORD.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters");

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  if (await userModel.exists({ role: "admin" })) {
    throw new Error("An admin already exists. Nothing was changed.");
  }

  await userModel.create({
    name: ADMIN_NAME.trim(),
    email: ADMIN_EMAIL.trim().toLowerCase(),
    phone: ADMIN_PHONE.trim(),
    password: await bcrypt.hash(ADMIN_PASSWORD, 10),
    role: "admin",
    isVerified: true
  });

  console.log(`Admin created: ${ADMIN_EMAIL}. You can remove ADMIN_PASSWORD from .env now.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());