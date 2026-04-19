import { NextResponse } from "next/server";
import { Client as SSHClient } from "ssh2";
import { requireSuperAdmin } from "../../../lib/superAdminAuth.js";
import { connectMongo, Tenant, TenantEvent } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

const VALID_HOST_RE = /^[a-zA-Z0-9.\-]+$/;
const VALID_USER_RE = /^[a-zA-Z0-9._-]+$/;
const VALID_DIR_RE = /^\/[a-zA-Z0-9._\-/]*$/;

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function sseEvent(name, payload) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseLines(chunk, onLine) {
  const text = chunk.toString("utf8");
  text.split(/\r?\n/).forEach((line) => {
    if (line.trim()) onLine(line);
  });
}

function connectSsh({ host, port, username, password, privateKey }) {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    client
      .on("ready", () => resolve(client))
      .on("error", reject)
      .connect({
        host,
        port,
        username,
        ...(password ? { password } : {}),
        ...(privateKey ? { privateKey } : {}),
        readyTimeout: 20000,
      });
  });
}

function runCommand(client, step, command, onLog) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    client.exec(command, { pty: true }, (err, stream) => {
      if (err) return reject(new Error(`Failed to start command: ${err.message}`));
      stream.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        parseLines(chunk, (line) => onLog({ step, type: "stdout", line }));
      });
      stream.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        parseLines(chunk, (line) => onLog({ step, type: "stderr", line }));
      });
      stream.on("close", (code) => {
        if (code === 0) return resolve({ stdout, stderr });
        return reject(new Error((stderr || stdout || "Command failed").trim()));
      });
    });
  });
}

async function loadTenantForSsh(tenantId) {
  return Tenant.findById(tenantId)
    .select("+remoteInstall.sshPassword +remoteInstall.sshPrivateKey remoteInstall")
    .lean();
}

async function runControlAction({ tenantId, action }) {
  await connectMongo();
  const tenant = await loadTenantForSsh(tenantId);
  if (!tenant) return { status: 404, body: { success: false, error: "Tenant not found" } };

  const remote = tenant.remoteInstall || {};
  if (!remote.sshHost || !remote.sshUser) {
    return { status: 400, body: { success: false, error: "Missing saved SSH connection details" } };
  }

  const client = await connectSsh({
    host: remote.sshHost,
    port: Number(remote.sshPort || 22),
    username: remote.sshUser,
    password: remote.sshAuthMethod === "password" ? remote.sshPassword : undefined,
    privateKey: remote.sshAuthMethod === "privateKey" ? remote.sshPrivateKey : undefined,
  });

  try {
    const installDir = shellEscape(remote.installDir || "/opt/ghostlayer");
    if (action === "restart") {
      const cmd = `cd ${installDir} && if [ -f agent.pid ]; then kill $(cat agent.pid) >/dev/null 2>&1 || true; fi && nohup npm run start > agent.log 2>&1 & echo $! > agent.pid && cat agent.pid`;
      const result = await runCommand(client, "restart", cmd, () => {});
      const pid = (result.stdout || "").trim().split(/\r?\n/).pop() || "";
      await Tenant.findByIdAndUpdate(tenantId, {
        $set: {
          "remoteInstall.pid": pid,
          "remoteInstall.status": "online",
          "remoteInstall.lastAttemptAt": new Date(),
        },
      });
      return { status: 200, body: { success: true, pid } };
    }

    if (action === "logs") {
      const cmd = `cd ${installDir} && (test -f agent.log && tail -n 100 agent.log || echo "agent.log not found")`;
      const result = await runCommand(client, "logs", cmd, () => {});
      return { status: 200, body: { success: true, logs: result.stdout || "" } };
    }

    return { status: 400, body: { success: false, error: "Unsupported action" } };
  } finally {
    client.end();
  }
}

export async function POST(request) {
  const body = await request.json();
  if (body?.action === "restart" || body?.action === "logs") {
    try {
      await requireSuperAdmin(request);
      const result = await runControlAction({ tenantId: body.tenantId, action: body.action });
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status || 500 });
    }
  }

  try {
    await requireSuperAdmin(request);
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, payload) => controller.enqueue(encoder.encode(sseEvent(event, payload)));
      let ssh = null;
      let tenantId = body?.tenantId;
      let lastStep = "validation";

      try {
        await connectMongo();
        const {
          tenantId: inTenantId,
          sshHost,
          sshPort = 22,
          sshUser,
          sshPassword,
          sshPrivateKey,
          installDir = "/opt/ghostlayer",
          tenantApiKey,
        } = body || {};
        tenantId = inTenantId;

        if (!tenantId || !sshHost || !sshUser) throw new Error("tenantId, sshHost and sshUser are required");
        if (!VALID_HOST_RE.test(sshHost)) throw new Error("Invalid SSH host");
        if (!VALID_USER_RE.test(sshUser)) throw new Error("Invalid SSH username");
        if (!VALID_DIR_RE.test(installDir)) throw new Error("Invalid install directory");
        if (!sshPassword && !sshPrivateKey) throw new Error("Provide either sshPassword or sshPrivateKey");

        const tenant = await Tenant.findById(tenantId).lean();
        if (!tenant) throw new Error("Tenant not found");
        if (!tenant.apiKey) throw new Error("Tenant has no API key");
        if (!tenantApiKey) throw new Error("tenantApiKey is required for remote provisioning");

        const serverUrl = process.env.GHOSTLAYER_SERVER_URL || process.env.DLP_SERVER_URL || new URL(request.url).origin;
        const remoteAgentUrl = `http://${sshHost}:4000`;
        const authMethod = sshPrivateKey ? "privateKey" : "password";

        await Tenant.findByIdAndUpdate(tenantId, {
          $set: {
            "remoteInstall.sshHost": sshHost,
            "remoteInstall.sshPort": Number(sshPort || 22),
            "remoteInstall.sshUser": sshUser,
            "remoteInstall.sshAuthMethod": authMethod,
            ...(sshPassword ? { "remoteInstall.sshPassword": sshPassword } : {}),
            ...(sshPrivateKey ? { "remoteInstall.sshPrivateKey": sshPrivateKey } : {}),
            "remoteInstall.installDir": installDir,
            "remoteInstall.status": "installing",
            "remoteInstall.agentUrl": remoteAgentUrl,
            "remoteInstall.lastAttemptAt": new Date(),
            "remoteInstall.lastError": { step: "", error: "", timestamp: null },
          },
        });

        send("log", { step: "ssh_connect", level: "info", line: `Connecting to ${sshHost}:${sshPort}...` });
        lastStep = "ssh_connect";
        ssh = await connectSsh({
          host: sshHost,
          port: Number(sshPort || 22),
          username: sshUser,
          password: authMethod === "password" ? sshPassword : undefined,
          privateKey: authMethod === "privateKey" ? sshPrivateKey : undefined,
        });
        send("log", { step: "ssh_connect", level: "success", line: "✓ SSH connection established" });

        const escapedDir = shellEscape(installDir);
        const escapedServerUrl = shellEscape(serverUrl);
        const steps = [
          {
            step: "check_node",
            title: "Check Node.js",
            command:
              "node --version || (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs)",
          },
          { step: "create_install_dir", title: "Create install directory", command: `mkdir -p ${escapedDir}` },
          {
            step: "download_agent",
            title: "Download agent",
            command: `cd ${escapedDir} && curl -sSL ${escapedServerUrl}/api/download-agent | tar -xz`,
          },
          { step: "npm_install", title: "Install dependencies", command: `cd ${escapedDir} && npm install --production` },
          {
            step: "write_config",
            title: "Write config",
            command: `cd ${escapedDir} && cat > .env <<'EOF'\nDLP_SERVER_URL=${serverUrl}\nDLP_API_KEY=${tenantApiKey}\nNODE_ENV=production\nEOF`,
          },
          {
            step: "start_service",
            title: "Start background service",
            command: `cd ${escapedDir} && nohup npm run start > agent.log 2>&1 & echo $! > agent.pid && cat agent.pid`,
          },
          {
            step: "verify_health",
            title: "Verify agent health",
            command: "sleep 3 && curl -s http://localhost:4000/api/health",
          },
        ];

        let pid = "";
        for (const item of steps) {
          lastStep = item.title;
          send("log", { step: item.step, level: "info", line: `▶ ${item.title}` });
          const result = await runCommand(ssh, item.step, item.command, (lineEvent) =>
            send("log", { step: lineEvent.step, level: lineEvent.type === "stderr" ? "error" : "info", line: lineEvent.line })
          );
          if (item.step === "start_service") {
            pid = (result.stdout || "").trim().split(/\r?\n/).pop() || "";
          }
          send("log", { step: item.step, level: "success", line: `✓ ${item.title} completed` });
        }

        await Tenant.findByIdAndUpdate(tenantId, {
          $set: {
            agentUrl: remoteAgentUrl,
            "remoteInstall.agentUrl": remoteAgentUrl,
            "remoteInstall.pid": pid,
            "remoteInstall.status": "online",
            "remoteInstall.lastPing": new Date(),
            "remoteInstall.lastError": { step: "", error: "", timestamp: null },
          },
        });

        send("done", { success: true, agentUrl: remoteAgentUrl, pid });
      } catch (err) {
        if (tenantId) {
          const errorPayload = {
            eventType: "agent_provision_error",
            severity: "high",
            tenantId,
            step: lastStep,
            error: err.message,
            timestamp: new Date().toISOString(),
          };
          await Tenant.findByIdAndUpdate(tenantId, {
            $set: {
              "remoteInstall.status": "error",
              "remoteInstall.lastError": {
                step: lastStep,
                error: err.message,
                timestamp: new Date(),
              },
              "remoteInstall.lastAttemptAt": new Date(),
            },
          }).catch(() => {});
          await TenantEvent.create({
            tenantId,
            eventType: "agent_provision_error",
            severity: "high",
            details: { step: lastStep, error: err.message },
            timestamp: new Date(),
          }).catch(() => {});
          send("error", errorPayload);
        } else {
          send("error", { eventType: "agent_provision_error", severity: "high", step: lastStep, error: err.message, timestamp: new Date().toISOString() });
        }
        send("done", { success: false, error: err.message, step: lastStep });
      } finally {
        if (ssh) ssh.end();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
