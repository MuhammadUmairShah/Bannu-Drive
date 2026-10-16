// Tests the REAL src/utils/api.js interceptor (silent refresh + retry) against a fake server adapter. No browser needed.
import { build } from "esbuild";
import { pathToFileURL } from "url";
import path from "path";

// Minimal browser-ish globals the module touches
globalThis.window = new EventTarget();
globalThis.window.location = { pathname: "/customer", assign() {} };
globalThis.Event = Event;

const out = path.resolve("tests/.auth-bundle.mjs");
await build({
  entryPoints: ["src/utils/api.js"], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent",
  external: ["axios"], define: { "import.meta.env.VITE_API_URL": '"http://api.test"' }
});
const { default: api, SESSION_ENDED_EVENT } = await import(pathToFileURL(out).href);
const { AxiosError } = await import("axios");

let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "  PASS" : "  FAIL"}  ${n} ${c ? "" : x}`); };

// ---- scripted fake server ----
let accessValid = false, refreshMode = "ok", calls = [];
const reply = (config, status, data) => {
  const response = { data, status, statusText: "", headers: {}, config };
  if (status < 400) return Promise.resolve(response);
  return Promise.reject(new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST", config, null, response));
};
api.defaults.adapter = async (config) => {
  calls.push(config.url);
  await new Promise((r) => setTimeout(r, 5));
  if (config.url === "/user/refresh") {
    if (refreshMode === "ok") { accessValid = true; return reply(config, 200, { success: true }); }
    if (refreshMode === "ended") return reply(config, 401, { success: false, code: "SESSION_ENDED" });
    return Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config));
  }
  if (config.url === "/user/login") return reply(config, 401, { success: false, message: "Invalid email or password" });
  if (config.url === "/ride/offers") return reply(config, 401, { success: false, code: "AUTH_EXPIRED" }); // always fails
  return accessValid ? reply(config, 200, { success: true, url: config.url }) : reply(config, 401, { success: false, code: "AUTH_EXPIRED" });
};
const reset = (o = {}) => { accessValid = o.accessValid ?? false; refreshMode = o.refreshMode ?? "ok"; calls = []; };
const refreshCount = () => calls.filter((c) => c === "/user/refresh").length;
const ended = []; window.addEventListener(SESSION_ENDED_EVENT, () => ended.push(1));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. expired access -> refresh -> original request replayed
reset();
let r = await api.get("/user/profile");
check("expired access cookie is refreshed silently and the request is replayed", r.status === 200 && calls.join() === "/user/profile,/user/refresh,/user/profile", calls.join());

// 2. many parallel requests share one refresh
await wait(1100); reset();
const all = await Promise.all([1, 2, 3, 4, 5].map((i) => api.get(`/ride/mine/${i}`)));
check("5 parallel 401s trigger exactly ONE refresh (no refresh storm)", refreshCount() === 1 && all.every((x) => x.status === 200), `refreshes=${refreshCount()}`);

// 3. a refresh that is definitively rejected ends the session
await wait(1100); reset({ refreshMode: "ended" }); ended.length = 0;
let err; try { await api.get("/user/profile"); } catch (e) { err = e; }
check("refresh rejected -> original error propagates + session-ended event fires", !!err && ended.length >= 1);

// 4. a network failure during refresh must NOT log the person out
await wait(1100); reset({ refreshMode: "network" }); ended.length = 0;
try { await api.get("/user/profile"); } catch (e) { err = e; }
check("network blip during refresh does NOT end the session", ended.length === 0);

// 5. wrong password is a normal 401, never a refresh
await wait(1100); reset(); ended.length = 0;
try { await api.post("/user/login", {}); } catch (e) { err = e; }
check("login 401 never triggers refresh or logout", refreshCount() === 0 && ended.length === 0 && err.response.status === 401);

// 6. no infinite loop: a request that keeps failing is retried only once
await wait(1100); reset();
try { await api.get("/ride/offers"); } catch (e) { err = e; }
check("a request is replayed at most once (no refresh loop)", calls.filter((c) => c === "/ride/offers").length === 2 && refreshCount() === 1, calls.join());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
