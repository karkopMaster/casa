import { Client } from 'ssh2';
import { HuaweiOltConfig } from '../types/olt.interface';

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
  if (!/^[0-9A-Za-z]{16}$/.test(sn)) throw new Error('Serial (SN) inválido: deben ser 16 caracteres alfanuméricos');
  return sn.toUpperCase();
};
const validarPerfil = (p: string, nombre: string): string => {
  if (!/^[\w.\- ]{1,64}$/.test(p)) throw new Error(`Perfil inválido: ${nombre}`);
  return p;
};

export class HuaweiOltService {
  private config: HuaweiOltConfig;

  constructor(config: HuaweiOltConfig) {
    this.config = config;
  }

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

  /** Busca ONUs no autorizadas (estado autofind). */
  async getAutofindOnus(): Promise<string> {
    return this.executeCommands(['enable', 'config', 'display ont autofind all']);
  }

  /** Autoriza una ONT Huawei en un puerto específico. Valida todo antes de tocar la OLT. */
  async authorizeOnu(params: {
    frame: number;
    slot: number;
    port: number;
    ontId: number;
    sn: string;
    lineProfile: string;
    srvProfile: string;
  }): Promise<boolean> {
    const frame = soloEntero(params.frame, 'frame');
    const slot = soloEntero(params.slot, 'slot');
    const port = soloEntero(params.port, 'port');
    const ontId = soloEntero(params.ontId, 'ontId');
    const sn = validarSn(params.sn);
    const lineProfile = validarPerfil(params.lineProfile, 'lineProfile');
    const srvProfile = validarPerfil(params.srvProfile, 'srvProfile');

    const result = await this.executeCommands([
      'enable',
      'config',
      `interface gpon ${frame}/${slot}`,
      `ont add ${port} ${ontId} sn-auth ${sn} omci ont-lineprofile-name "${lineProfile}" ont-srvprofile-name "${srvProfile}"`,
      'quit',
    ]);
    return !FALLO.test(result);
  }

  /** Consulta la potencia óptica (Rx/Tx) de una ONT. Va en modo config/interface, como exige Huawei. */
  async getOntSignal(frame: number, slot: number, port: number, ontId: number): Promise<string> {
    const f = soloEntero(frame, 'frame');
    const s = soloEntero(slot, 'slot');
    const p = soloEntero(port, 'port');
    const o = soloEntero(ontId, 'ontId');
    return this.executeCommands([
      'enable',
      'config',
      `interface gpon ${f}/${s}`,
      `display ont optical-info ${p} ${o}`,
      'quit',
    ]);
  }
}
