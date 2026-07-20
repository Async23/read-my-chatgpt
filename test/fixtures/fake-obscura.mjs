#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";

const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("fake-obscura: missing --port");
  process.exit(2);
}

const storageIndex = process.argv.indexOf("--storage-dir");
const storageDir =
  storageIndex >= 0 ? process.argv[storageIndex + 1] : undefined;
let hangFirstRequest = false;
if (storageDir) {
  const markerPath = join(storageDir, ".fake-obscura-started");
  hangFirstRequest = !existsSync(markerPath);
  if (hangFirstRequest) writeFileSync(markerPath, "started\n");
}

const server = http.createServer((request, response) => {
  if (request.url !== "/json/version") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser`,
    }),
  );
});
const webSocketServer = new WebSocketServer({ server });

webSocketServer.on("connection", (socket) => {
  let storedBody = "";
  socket.on("message", (data) => {
    const command = JSON.parse(data.toString());
    let result;
    switch (command.method) {
      case "Target.createTarget":
        result = { targetId: "page-1" };
        break;
      case "Target.attachToTarget":
        result = { sessionId: "session-1" };
        break;
      case "Page.enable":
      case "Page.navigate":
      case "Target.closeTarget":
        result = {};
        break;
      case "Runtime.evaluate": {
        const expression = command.params?.expression ?? "";
        const isRequest = expression.includes("new XMLHttpRequest");
        if (hangFirstRequest && isRequest) return;
        const isDetail = expression.includes(
          "/backend-api/conversation/restart-me",
        );
        let value;
        if (isRequest) {
          storedBody = JSON.stringify(
            isDetail
              ? {
                  conversation_id: "restart-me",
                  current_node: null,
                  mapping: {},
                }
              : { items: [] },
          );
          value = JSON.stringify({
              status: 200,
              headers: { "content-type": "application/json" },
              bodyLength: storedBody.length,
            });
        } else if (expression.includes('.textContent||"").slice(')) {
          const match = expression.match(/\.slice\((\d+),(\d+)\)$/);
          value = match
            ? storedBody.slice(Number(match[1]), Number(match[2]))
            : "";
        } else if (expression.includes("element.remove()")) {
          storedBody = "";
          result = { result: { type: "boolean", value: true } };
          break;
        } else {
          value = JSON.stringify({
            title: "ChatGPT",
            challenge: false,
          });
        }
        result = { result: { type: "string", value } };
        break;
      }
      default:
        socket.send(
          JSON.stringify({
            id: command.id,
            error: { message: `Unsupported method: ${command.method}` },
          }),
        );
        return;
    }
    socket.send(JSON.stringify({ id: command.id, result }));
  });
});

server.listen(port, "127.0.0.1");

function shutdown() {
  for (const client of webSocketServer.clients) client.terminate();
  webSocketServer.close(() => {
    server.close(() => process.exit(0));
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
