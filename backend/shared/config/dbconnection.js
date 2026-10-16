// config/db.js
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

let connectionPromise = null;

const dbConnection = async () => {
  // Pehle se connected hai to kuch mat karo
  if (mongoose.connection.readyState === 1) return;

  // Pehli dafa connect karo, baaki requests isi ka intezar karengi
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGO_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
    });
  }

  try {
    await connectionPromise;
  } catch (error) {
    connectionPromise = null; // agli request dobara try kare
    throw error;
  }
};

export default dbConnection;