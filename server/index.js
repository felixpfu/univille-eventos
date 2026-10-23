import { createApp } from "./app.js";
const app = createApp();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT inválida.");
const server = app.listen(port, host, () =>
  console.log(
    `Univille Eventos disponível em http://${host}:${port}${process.env.BASE_PATH || ""}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => {
      app.locals.db.close();
      process.exit(0);
    });
  });
