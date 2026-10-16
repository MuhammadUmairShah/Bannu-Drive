// Serverless (Vercel) entry: REST API ONLY. Socket.IO cannot run on serverless functions.
// For realtime seats, notifications and live tracking deploy `server.js` on a persistent host.
import app from "./app.js";

export default app;
