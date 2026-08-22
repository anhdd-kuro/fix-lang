import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { keepAliveFetch } from "./httpKeepAlive";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("keepAliveFetch", () => {
  it("uses a fetch implementation compatible with its undici dispatcher", async () => {
    const server = createServer((_request, response) => {
      response.end("ok");
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    servers.push(server);

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP server address");
    }

    const response = await keepAliveFetch(`http://127.0.0.1:${String(address.port)}`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });
});
