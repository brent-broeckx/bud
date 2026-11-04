import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { BudError } from "./core/types.js";
import type { AppView } from "./core/view.js";

export interface Dispatcher {
  dispatch(action: string, input: unknown): Promise<AppView>;
}
export interface Assets { html: string; js: string; css: string }

export async function serveCanvas(service: Dispatcher, assets: Assets): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const secret = randomBytes(24).toString("hex");
  let origin = "";
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'");
    const send = (status: number, body: string, type = "application/json") => {
      res.writeHead(status, { "Content-Type": `${type}; charset=utf-8` });
      res.end(body);
    };
    if (req.headers.host !== new URL(origin).host) { send(403, '{"message":"Invalid host."}'); return; }
    const url = new URL(req.url ?? "/", origin);
    const base = `/${secret}/`;
    if (!url.pathname.startsWith(base)) { send(404, '{"message":"Not found."}'); return; }
    const route = url.pathname.slice(base.length);
    if (req.method === "GET" && (route === "" || route === "app.js" || route === "app.css")) {
      send(200, route === "" ? assets.html : route === "app.js" ? assets.js : assets.css, route === "" ? "text/html" : route === "app.js" ? "application/javascript" : "text/css");
      return;
    }
    if (route !== "api" || req.method !== "POST") { send(404, '{"message":"Not found."}'); return; }
    if (req.headers.origin !== origin || req.headers["x-bud-request"] !== "1" || req.headers["content-type"]?.split(";")[0] !== "application/json") {
      send(403, '{"message":"Only the Bud canvas can call this endpoint."}'); return;
    }
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 48 * 1024) throw new BudError("request_size", "This request is too large.");
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let request: unknown;
      try { request = JSON.parse(body); } catch { throw new BudError("request_json", "The action body is not valid JSON."); }
      if (!request || typeof request !== "object" || !("action" in request) || typeof request.action !== "string") {
        throw new BudError("action", "An action name is required.");
      }
      const input = "input" in request ? request.input : {};
      const result = await service.dispatch(request.action, input);
      send(200, JSON.stringify(result));
    } catch (cause) {
      const known = cause instanceof BudError;
      if (!known) console.error("Bud action failed:", cause instanceof Error ? cause.message : "unknown failure");
      send(known ? 400 : 500, JSON.stringify({ code: known ? cause.code : "internal", message: known ? cause.message : "Bud couldn't save that change. Your previous profile is preserved; check extension logs." }));
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/${secret}/`,
    server,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })
  };
}
