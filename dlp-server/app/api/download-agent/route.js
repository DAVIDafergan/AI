import { spawn } from "child_process";
import { access } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuredAgentDir = process.env.GHOSTLAYER_AGENT_SOURCE_DIR;
  const defaultAgentDir = path.resolve(process.cwd(), "../ghostlayer-local-agent");
  const agentDir = configuredAgentDir ? path.resolve(configuredAgentDir) : defaultAgentDir;
  if (configuredAgentDir && path.basename(agentDir) !== "ghostlayer-local-agent") {
    return new Response("Invalid configured agent source directory", { status: 400 });
  }
  try {
    await access(agentDir);
  } catch {
    return new Response("Agent source directory not found", { status: 404 });
  }

  const tar = spawn("tar", ["-czf", "-", "-C", agentDir, "."], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stream = new ReadableStream({
    start(controller) {
      tar.stdout.on("data", (chunk) => controller.enqueue(chunk));
      tar.stdout.on("end", () => controller.close());
      tar.stderr.on("data", () => {});
      tar.on("error", () => controller.error(new Error("Failed to create archive")));
      tar.on("close", (code) => {
        if (code !== 0) controller.error(new Error("Failed to create archive"));
      });
    },
    cancel() {
      if (!tar.killed) tar.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="ghostlayer-local-agent.tar.gz"',
      "Cache-Control": "no-store",
    },
  });
}
