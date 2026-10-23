import { openDatabase } from "../server/db.js";
import {
  initNotificationSchema,
  processNotifications,
} from "../server/notifications.js";

const db = openDatabase();
try {
  initNotificationSchema(db);
  const result = await processNotifications({ db });
  // Deliberately log only aggregate counters, never addresses, tokens or SMTP values.
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} catch {
  console.error(
    "Não foi possível processar a fila de notificações. Verifique o serviço e a configuração SMTP.",
  );
  process.exitCode = 1;
} finally {
  db.close();
}
