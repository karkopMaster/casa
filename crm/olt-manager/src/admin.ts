// CLI: crear usuario del panel y claves de API.
//   npx tsx src/admin.ts usuario <nombre> <clave>
//   npx tsx src/admin.ts apikey <nombre>      (imprime la clave UNA vez)
import crypto from "crypto";
import { db } from "./db";
import { hashClave, sha256 } from "./crypto";

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "usuario" && a && b) {
  if (b.length < 10) throw new Error("La clave debe tener al menos 10 caracteres");
  db.prepare("INSERT INTO usuarios (usuario, clave_hash) VALUES (?,?) ON CONFLICT(usuario) DO UPDATE SET clave_hash=excluded.clave_hash").run(a, hashClave(b));
  console.log(`Usuario ${a} listo.`);
} else if (cmd === "apikey" && a) {
  const k = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO api_keys (nombre, hash) VALUES (?,?)").run(a, sha256(k));
  console.log(`API key para "${a}" (guárdala, no se vuelve a mostrar):\n${k}`);
} else {
  console.log("Uso: admin.ts usuario <nombre> <clave> | admin.ts apikey <nombre>");
  process.exit(1);
}
