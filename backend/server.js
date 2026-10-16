// Production / development entry point:
// Express + HTTP server + Socket.IO.
//
// Run with:
// npm start
//
// This is used for a normal long-running Node server
// such as local development, Render, Railway or VPS.

import http from "http";
import mongoose from "mongoose";

import { validateEnv } from "./shared/config/env.js";
import app from "./app.js";
import dbConnection from "./shared/config/dbconnection.js";
import { initSocket, closeSocket } from "./shared/realtime/socket.js";
import {
  startCoachSweeper,
  stopCoachSweeper,
} from "./modules/coach/coach.sweeper.js";

validateEnv();

const PORT = process.env.PORT || 5005;

const server = http.createServer(app);

// Attach Socket.IO
initSocket(server);

dbConnection()
  .then(() => {
    // Background job for seat holds / payment recovery.
    startCoachSweeper();

    server.listen(PORT, () => {
      console.log(
        `Backend running on port ${PORT} (REST + Socket.IO)`
      );

      console.log(
        `Health: http://localhost:${PORT}/health`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Server startup failed:",
      error.message
    );

    process.exit(1);
  });

// Graceful shutdown
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(
    `${signal} received, shutting down...`
  );

  const force = setTimeout(
    () => process.exit(1),
    10_000
  );

  force.unref();

  try {
    stopCoachSweeper();

    await closeSocket();

    await new Promise((resolve) => {
      server.close(resolve);
    });

    await mongoose.connection.close();

    process.exit(0);
  } catch (error) {
    console.error(
      "Shutdown error:",
      error.message
    );

    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("unhandledRejection", (reason) => {
  console.error(
    "Unhandled rejection:",
    reason
  );
});