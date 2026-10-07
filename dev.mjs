import { build, preview } from "vite";

// Use one build pipeline: initializing federation twice in the same process
// drops its exposed modules. Serve only after the watcher's first build succeeds.
const watcher = await build({ build: { watch: {} } });
let server;
try {
  await new Promise((resolve, reject) => {
    const ready = (event) => {
      if (event.code !== "END" && event.code !== "ERROR") return;
      watcher.off("event", ready);
      if (event.code === "ERROR") reject(event.error);
      else resolve();
    };
    watcher.on("event", ready);
  });
  server = await preview();
} catch (error) {
  await watcher.close();
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await watcher.close();
    server.httpServer.close();
    process.exit(0);
  });
}
