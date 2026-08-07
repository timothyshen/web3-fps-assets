import { loadConfig, loadDotEnv } from "./config.js";
import { openDb } from "./db.js";
import { createChainContext } from "./chain/client.js";
import { createAppContext } from "./context.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const chain = createChainContext(config);
  const ctx = createAppContext(config, db, chain);
  const app = await buildApp(ctx);

  if (config.jwtSecret === "dev-only-jwt-secret-change-me") {
    app.log.warn("JWT_SECRET is the dev default — fine for local demo only.");
  }
  if (config.internalServiceToken === "dev-internal-service-token") {
    app.log.warn("INTERNAL_SERVICE_TOKEN is the dev default — fine for local demo only.");
  }

  ctx.attestation.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    ctx.attestation.stop();
    await app.close().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { operator: chain.operator.address, rpc: config.rpcUrl, chainId: config.chainId },
    "asset backend up",
  );
}

main().catch((error: unknown) => {
  console.error("[fatal]", error instanceof Error ? error.message : error);
  process.exit(1);
});
