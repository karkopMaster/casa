import { Client } from "ssh2";
import type { DriverOlt, ConexionOlt, AutorizarParams, UbicacionOnt } from "./driver";
import { parsearAutofind, parsearOntInfo, parsearPotencia } from "../parsers";

// Prompts de Huawei: MA5800>  MA5800#  MA5800(config)#  MA5800(config-if-gpon-0/1)#
const PROMPT = /[>#]\s*$/;
const MORE = /-{2,}\s*More[^\n]*?-{2,}/i;
const PREGUNTA_CR = /\{\s*<cr>[^}]*\}\s*:\s*$/i;
const CONFIRMAR = /\(y\/n\)\s*\[[yn]\]\s*:\s*$/i;
const FALLO = /(^|\n)\s*(Failure|% Unknown command|% Parameter error|Parameter error|Error:)/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u0008+/g;

const T_CONEXION_MS = 15_000;
const T_COMANDO_MS = 20_000;
const T_TOTAL_MS = 90_000;

const soloEntero = (n: unknown, nombre: string): number => {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0 || v > 4096) throw new Error(`Valor inválido: ${nombre}`);
  return v;
};
const validarSn = (sn: string): string => {
  if (!/^[0-9A-Za-z]{16}$/.test(sn)) throw new Error("Serial (SN) inválido: deben ser 16 caracteres alfanuméricos");
  return sn.toUpperCase();
};
const validarTexto = (p: string, nombre: string): string => {
  if (!/^[\w.\- ]{1,64}$/.test(p)) throw new Error(`Valor inválido: ${nombre}`);
  return p;
};
const validarFallo = (salida: string, accion: string) => {
  if (FALLO.test(salida)) throw new Error(`La OLT rechazó la orden (${accion}). ${(salida.match(FALLO) ? salida.split("\n").find((l) => FALLO.test("\n" + l)) : "")?.trim() ?? ""}`);
};

export class HuaweiDriver implements DriverOlt {
  constructor(private config: ConexionOlt) {}

  /**
   * Ejecuta comandos de uno en uno, esperando el prompt de la OLT entre cada uno.
   * Tiene tiempo límite por comando y total; nunca deja la promesa colgada.
   */
  private executeCommands(commands: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      let terminado = false;
      let temporizadorCmd: NodeJS.Timeout | undefined;

      const terminar = (err?: Error) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(total);
        if (temporizadorCmd) clearTimeout(temporizadorCmd);
        try { conn.end(); } catch { /* ya cerrada */ }
        if (err) reject(err);
        else resolve(output);
      };
      const total = setTimeout(() => terminar(new Error('La OLT tardó demasiado en responder')), T_TOTAL_MS);

      conn.on('error', (e) => terminar(e));
      conn.on('timeout', () => terminar(new Error('Tiempo de espera de la conexión SSH agotado')));

      conn.on('ready', () => {
        conn.shell({ term: 'vt100', cols: 200, rows: 50 }, (err, stream) => {
          if (err) return terminar(err);

          // Cola: primero desactivar paginación, luego los comandos del usuario, al final salir.
          // 'scroll' solo funciona en modo privilegiado, por eso va tras el primer 'enable'.
          const cola: string[] = [];
          let paginacionOff = false;
          const lista = [...commands];
          let i = 0;
          let esperandoPrompt = false;
          let tail = '';

          const armarTimeoutCmd = () => {
            if (temporizadorCmd) clearTimeout(temporizadorCmd);
            temporizadorCmd = setTimeout(() => terminar(new Error('Un comando de la OLT no respondió a tiempo')), T_COMANDO_MS);
          };
          const siguiente = () => {
            if (terminado) return;
            if (cola.length === 0) {
              if (i < lista.length) {
                const cmd = lista[i++];
                cola.push(cmd);
                if (!paginacionOff && cmd.trim() === 'enable') cola.push('scroll');
                if (!paginacionOff && cmd.trim() === 'enable') paginacionOff = true;
              } else {
                stream.write('quit\n');
                // Cierra cuando la OLT cierre el canal; si no, a los 2 s.
                setTimeout(() => terminar(), 2000);
                return;
              }
            }
            const cmd = cola.shift() as string;
            esperandoPrompt = true;
            tail = '';
            armarTimeoutCmd();
            stream.write(`${cmd}\n`);
          };

          stream.on('data', (data: Buffer) => {
            const txt = data.toString().replace(ANSI, '');
            output += txt;
            tail = (tail + txt).slice(-300);

            if (MORE.test(tail)) { stream.write(' '); tail = ''; return; }
            if (PREGUNTA_CR.test(tail)) { stream.write('\n'); tail = ''; return; }
            if (CONFIRMAR.test(tail)) { stream.write('y\n'); tail = ''; return; }
            if (esperandoPrompt && PROMPT.test(tail)) {
              esperandoPrompt = false;
              siguiente();
            }
          });
          stream.on('close', () => terminar());
          stream.stderr?.on('data', () => { /* la OLT no usa stderr */ });

          // El primer prompt llega solo al abrir la sesión.
          esperandoPrompt = true;
          armarTimeoutCmd();
        });
      }).connect({
        host: this.config.host,
        port: this.config.port || 22,
        username: this.config.username,
        password: this.config.password,
        readyTimeout: T_CONEXION_MS,
        keepaliveInterval: 10_000,
      });
    });
  }

  async pendientes() {
    return parsearAutofind(await this.executeCommands(["enable", "config", "display ont autofind all"]));
  }

  async listarOnts(frame: number, slot: number, port: number) {
    const f = soloEntero(frame, "frame"), s = soloEntero(slot, "slot"), p = soloEntero(port, "port");
    return parsearOntInfo(await this.executeCommands(["enable", "config", `display ont info ${f}/${s}/${p} all`]));
  }

  async potencia(u: UbicacionOnt) {
    const f = soloEntero(u.frame, "frame"), s = soloEntero(u.slot, "slot"), p = soloEntero(u.port, "port"), o = soloEntero(u.ontId, "ontId");
    // Huawei exige modo interface para optical-info.
    return parsearPotencia(await this.executeCommands(["enable", "config", `interface gpon ${f}/${s}`, `display ont optical-info ${p} ${o}`, "quit"]));
  }

  async autorizar(a: AutorizarParams) {
    const f = soloEntero(a.frame, "frame"), s = soloEntero(a.slot, "slot"), p = soloEntero(a.port, "port"), o = soloEntero(a.ontId, "ontId");
    const sn = validarSn(a.sn);
    const line = validarTexto(a.lineProfile, "lineProfile"), srv = validarTexto(a.srvProfile, "srvProfile");
    const desc = a.descripcion ? ` desc "${validarTexto(a.descripcion.replace(/[^\w.\- ]/g, " ").trim() || "onu", "descripcion")}"` : "";
    const r = await this.executeCommands([
      "enable", "config", `interface gpon ${f}/${s}`,
      `ont add ${p} ${o} sn-auth ${sn} omci ont-lineprofile-name "${line}" ont-srvprofile-name "${srv}"${desc}`,
      "quit",
    ]);
    validarFallo(r, "autorizar ONU");
  }

  private async enInterfaz(u: UbicacionOnt, cmd: (p: number, o: number) => string, accion: string) {
    const f = soloEntero(u.frame, "frame"), s = soloEntero(u.slot, "slot"), p = soloEntero(u.port, "port"), o = soloEntero(u.ontId, "ontId");
    validarFallo(await this.executeCommands(["enable", "config", `interface gpon ${f}/${s}`, cmd(p, o), "quit"]), accion);
  }
  activar(u: UbicacionOnt) { return this.enInterfaz(u, (p, o) => `ont activate ${p} ${o}`, "activar ONU"); }
  desactivar(u: UbicacionOnt) { return this.enInterfaz(u, (p, o) => `ont deactivate ${p} ${o}`, "desactivar ONU"); }
  reiniciar(u: UbicacionOnt) { return this.enInterfaz(u, (p, o) => `ont reset ${p} ${o}`, "reiniciar ONU"); }
  eliminar(u: UbicacionOnt) { return this.enInterfaz(u, (p, o) => `ont delete ${p} ${o}`, "eliminar ONU"); }

  async siguienteOntId(frame: number, slot: number, port: number) {
    const usados = new Set((await this.listarOnts(frame, slot, port)).map((o) => o.ontId));
    for (let i = 0; i < 128; i++) if (!usados.has(i)) return i;
    throw new Error("El puerto PON está lleno (128 ONU)");
  }
}
