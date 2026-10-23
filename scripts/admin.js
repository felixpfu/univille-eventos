import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { openDatabase, transaction } from "../server/db.js";
import { hashPassword, publicUser } from "../server/security.js";
import { emailField, textField, passwordField } from "../server/domain.js";

export async function createAdministrator({
  dbPath,
  email,
  name,
  password,
  replace = false,
}) {
  email = emailField(email);
  name = textField(name, "Nome completo", 160, true);
  password = passwordField(password);
  const encoded = await hashPassword(password);
  const db = openDatabase(dbPath);
  try {
    return transaction(db, () => {
      const existing = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(email);
      if (existing && !replace)
        throw new Error(
          "E-mail já cadastrado. Use --replace para redefinir explicitamente essa conta como administrador.",
        );
      const id = existing?.id || randomUUID();
      if (existing) {
        db.prepare(
          "UPDATE users SET name=?,passwordHash=?,role='admin',active=1 WHERE id=?",
        ).run(name, encoded, id);
        db.prepare("DELETE FROM sessions WHERE userId=?").run(id);
      } else
        db.prepare(
          "INSERT INTO users(id,name,email,passwordHash,role,active,createdAt) VALUES (?,?,?,?,'admin',1,?)",
        ).run(id, name, email, encoded, new Date().toISOString());
      db.prepare(
        "INSERT INTO auditLog(actorId,action,entityId,createdAt) VALUES (?,?,?,?)",
      ).run(
        id,
        existing ? "admin.reset.cli" : "admin.created.cli",
        id,
        new Date().toISOString(),
      );
      return publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
    });
  } finally {
    db.close();
  }
}
async function hiddenPassword() {
  process.stdout.write("Senha (mínimo 12 caracteres; não será exibida): ");
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const cleanup = () => {
      process.stdin.off("data", input);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const input = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Operação cancelada."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b")
          value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", input);
  });
}
async function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  if (args.includes("--password"))
    throw new Error(
      "Não informe senhas em argumentos. Use a entrada padrão ou o prompt protegido.",
    );
  let email = readArg("--email");
  let name = readArg("--name");
  let password;
  if (process.stdin.isTTY) {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (!email) email = await prompt.question("E-mail do administrador: ");
    if (!name) name = await prompt.question("Nome completo: ");
    prompt.close();
    password = await hiddenPassword();
  } else {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 16384) throw new Error("Entrada muito longa.");
    }
    if (!email || !name) {
      const data = JSON.parse(input);
      email = data.email;
      name = data.name;
      password = data.password;
    } else password = input.replace(/\r?\n$/, "");
  }
  const user = await createAdministrator({
    email,
    name,
    password,
    replace: args.includes("--replace"),
  });
  console.log(
    `Administrador configurado: ${user.email}. Banco em DATA_DIR/events.sqlite (DATA_DIR padrão: ./data).`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
