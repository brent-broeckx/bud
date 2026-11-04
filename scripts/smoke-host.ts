import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const cliPath = process.argv[2];
if (!cliPath) throw new Error("Usage: npx tsx scripts\\smoke-host.ts <absolute Copilot executable path>");
const directory = await mkdtemp(join(tmpdir(), "bud-host-smoke-"));
const isolatedEnv = { COPILOT_HOME: directory, BUD_DATA_DIR: join(directory, "bud-profile") };
const resolved: string[] = [];
const runtimeEnv = Object.fromEntries(
  Object.entries({ ...process.env, ...isolatedEnv }).filter((entry): entry is [string, string] => entry[1] !== undefined)
);
const client = new CopilotClient({
  connection: RuntimeConnection.forStdio({ path: cliPath, env: runtimeEnv }),
  workingDirectory: process.cwd(), baseDirectory: directory, useLoggedInUser: false,
  logLevel: "error",
  // The runtime does not append the entrypoint, so launch it explicitly with this Node binary.
  extensionLaunchProvider: {
    resolve: async ({ id, modulePath }) => {
      resolved.push(`${id} -> ${modulePath}`);
      if (!/\.(mjs|cjs|js)$/i.test(modulePath)) return {};
      return { launch: { executable: process.execPath, args: [modulePath], env: { ...isolatedEnv } } };
    }
  }
});
try {
  await client.start();
  const status = await client.getStatus();
  console.log(`Runtime ${cliPath}: version=${status.version} protocol=${status.protocolVersion}`);
  const session = await client.createSession({
    model: "gpt-6.1-sol", workingDirectory: process.cwd(), enableConfigDiscovery: true,
    requestCanvasRenderer: true, requestExtensions: true,
    extensionSdkPath: resolve("node_modules", "@github", "copilot-sdk", "dist"),
    onPermissionRequest: () => ({ kind: "denied-no-approval-rule-and-could-not-request-from-user" })
  });
  try {
    let bud: Awaited<ReturnType<typeof session.rpc.canvas.list>>["canvases"][number] | undefined;
    for (const deadline = Date.now() + 20_000; !bud && Date.now() < deadline;) {
      bud = (await session.rpc.canvas.list()).canvases.find(canvas => canvas.canvasId === "bud");
      if (!bud) await new Promise(done => setTimeout(done, 250));
    }
    if (!bud) {
      const extensions = await session.rpc.extensions.list().catch((error: unknown) => ({ error: String(error) }));
      assert.fail(`The Copilot runtime did not discover Bud within 20s. Launch requests: ${JSON.stringify(resolved)}; extensions: ${JSON.stringify(extensions)}`);
    }
    const expectedEntry = resolve(".github", "extensions", "bud", "extension.mjs").toLowerCase();
    assert.ok(resolved.some(entry => entry.toLowerCase().endsWith(expectedEntry)),
      `Bud was not launched from the project entrypoint. Launch requests: ${JSON.stringify(resolved)}`);
    console.log(`Launched via provider: ${resolved.join("; ")}; canvas extensionId=${bud.extensionId}`);
    const opened = await session.rpc.canvas.open({ extensionId: bud.extensionId, canvasId: "bud", instanceId: "bud-smoke" });
    assert.ok(opened.url, "The host did not receive a canvas URL.");
    assert.equal((await fetch(opened.url)).status, 200);
    const profile = await session.rpc.canvas.action.invoke({ instanceId: "bud-smoke", actionName: "get_profile", input: {} });
    assert.ok(JSON.stringify(profile).includes("equipped"), "The agent action did not return a profile.");
    await session.rpc.canvas.close({ instanceId: "bud-smoke" });
    console.log("PASS: real Copilot runtime discovered Bud, opened its renderer, invoked get_profile, and closed it. No model prompt was sent.");
  } finally { await session.disconnect(); }
} finally {
  await client.stop();
  await rm(directory, { recursive: true, force: true });
}
