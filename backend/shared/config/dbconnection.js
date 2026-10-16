// config/db.js
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

let connectionPromise = null;

const dbConnection = async () => {
  // Already connected
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // Connection already in progress
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create a new connection
  connectionPromise = mongoose.connect(process.env.MONGO_URI, {
    bufferCommands: false,

    // Connection pool
    maxPoolSize: 10,
    minPoolSize: 1,

    // Keep connections reusable
    maxIdleTimeMS: 30000,

    // Don't wait too long if MongoDB is unavailable
    serverSelectionTimeoutMS: 8000,

    // Faster initial connection behavior
    connectTimeoutMS: 8000,

    // TCP socket timeout
    socketTimeoutMS: 45000,
  });

  try {
    await connectionPromise;

    return mongoose.connection;
  } catch (error) {
    // Allow next request to retry
    connectionPromise = null;

    console.error("MongoDB connection failed:", error.message);

    throw error;
  }
};

// Reset cached promise if MongoDB disconnects
mongoose.connection.on("disconnected", () => {
  connectionPromise = null;
});

// Reset cached promise if connection error occurs
mongoose.connection.on("error", () => {
  if (mongoose.connection.readyState !== 1) {
    connectionPromise = null;
  }
});

export default dbConnection;