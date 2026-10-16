// Production / development entry point: Express + HTTP server + Socket.IO.
// Run with: npm start   (host on Render / Railway / a VPS: sockets need a long-running process)
import http from "http";
import mongoose from "mongoose";

import { validateEnv } from "./shared/config/env.js";
import app from "./app.js";
import dbConnection from "./shared/config/dbconnection.js";
import { initSocket, closeSocket } from "./shared/realtime/socket.js";
import { startCoachSweeper, stopCoachSweeper } from "./modules/coach/coach.sweeper.js";

validateEnv();

const PORT = process.env.PORT || 5005;
const server = http.createServer(app);

initSocket(server);

dbConnection()
  .then(() => {
    startCoachSweeper(); // expires seat holds, recovers lost payment callbacks
    server.listen(PORT, () => {
      console.log(`Backend running on port ${PORT} (REST + Socket.IO)`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });
  })
  .catch((error) => {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  });

// Graceful shutdown so deploys do not cut requests off mid-way
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);

  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();

  try {
    stopCoachSweeper();
    await closeSocket();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("Shutdown error:", error.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
