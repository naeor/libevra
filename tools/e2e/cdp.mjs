/** Minimal Chrome DevTools Protocol client for local E2E checks (Node 24 global WebSocket). */
import { writeFileSync } from "node:fs";

export async function openPage(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error(`no page target on ${port}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result ?? {});
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ""}`);
    }
    return result.result?.value;
  }

  async function navigate(url) {
    await send("Page.navigate", { url });
    await waitFor("document.readyState === 'complete'", 15000);
  }

  async function waitFor(expression, timeoutMs = 10000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await evaluate(expression).catch(() => false);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`waitFor timed out: ${expression}`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async function screenshot(path) {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(path, Buffer.from(data, "base64"));
    return path;
  }

  async function setViewport(width, height, mobile = false) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
  }

  async function setCookie(name, value) {
    await send("Network.enable");
    await send("Network.setCookie", {
      name,
      value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });
  }

  async function clearStorage() {
    await send("Storage.clearDataForOrigin", { origin: "http://127.0.0.1:5175", storageTypes: "all" });
  }

  async function setOffline(offline) {
    await send("Network.enable");
    await send("Network.emulateNetworkConditions", {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
    });
  }

  return { socket, send, evaluate, navigate, waitFor, screenshot, setViewport, setCookie, clearStorage, setOffline, close: () => socket.close() };
}

export async function apiLogin(base, username, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login ${username} failed: ${response.status}`);
  const cookies = response.headers.getSetCookie?.() ?? [];
  const session = cookies.map((value) => value.split(";")[0]).find((value) => value.startsWith("libellum_session="));
  if (!session) throw new Error("no session cookie");
  return session.slice("libellum_session=".length);
}

export async function api(base, path, { method = "GET", cookie, body, bookId } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = `libellum_session=${cookie}`;
  if (bookId) headers["x-libellum-book"] = bookId;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text === "" ? null : JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runCase(results, name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, status: "pass", evidence: evidence ?? null });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, status: "fail", error: error instanceof Error ? error.message : String(error) });
    process.stdout.write(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
