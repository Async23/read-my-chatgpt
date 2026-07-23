import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { DirectChatGPTTransport } from "../src/transport/direct-transport.js";

test("direct transport downloads bounded same-origin asset bytes", async (t) => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const server = http.createServer((request, response) => {
    requests.push({
      url: request.url ?? "",
      authorization:
        typeof request.headers.authorization === "string"
          ? request.headers.authorization
          : undefined,
    });
    const body = Buffer.from([137, 80, 78, 71]);
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(body.byteLength),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const transport = new DirectChatGPTTransport("secret-token", baseUrl);
  const result = await transport.getBinary(`${baseUrl}/signed/image`, 4);

  assert.equal(result.status, 200);
  assert.equal(result.headers["content-type"], "image/png");
  assert.deepEqual([...result.body], [137, 80, 78, 71]);
  assert.deepEqual(requests, [
    { url: "/signed/image", authorization: "Bearer secret-token" },
  ]);

  await assert.rejects(
    () => transport.getBinary(`${baseUrl}/signed/image`, 3),
    /exceeds the 3 byte limit/,
  );
});

test("direct transport rejects unsafe cross-origin asset URLs", async () => {
  const transport = new DirectChatGPTTransport(
    "secret-token",
    "https://chatgpt.com",
  );

  await assert.rejects(
    () => transport.getBinary("http://example.com/asset", 10),
    /unsafe asset download URL/,
  );
  await assert.rejects(
    () => transport.getBinary("https://127.0.0.1/asset", 10),
    /unsafe asset download URL/,
  );
  await assert.rejects(
    () => transport.getBinary("https://user@example.com/asset", 10),
    /unsafe asset download URL/,
  );
});
