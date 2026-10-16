// Vercel entry point
// Express REST API + Socket.IO on the same HTTP server.

import http from "http";

import app from "./app.js";
import { initSocket } from "./shared/realtime/socket.js";

// Create the HTTP server manually so Socket.IO can attach to it.
const server = http.createServer(app);

// Attach Socket.IO to the same server.
initSocket(server);

// Vercel handles the server lifecycle.
// Do NOT call server.listen() here.
export default server;