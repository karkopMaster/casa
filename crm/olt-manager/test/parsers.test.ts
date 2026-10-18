import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearAutofind, parsearOntInfo, parsearPotencia, clasificarSenal } from "../src/parsers";

test("autofind", () => {
  const txt = `
  ----------------------------------------------------------------------------
  Number              : 1
  F/S/P               : 0/1/3
  Ont SN              : 48575443a1b2c3d4 (HWTC-A1B2C3D4)
  Ont EquipmentID     : HG8310M
  ----------------------------------------------------------------------------
  Number              : 2
  F/S/P               : 0/2/0
  Ont SN              : 4857544300000001 (HWTC-00000001)
  Ont EquipmentID     :
  ----------------------------------------------------------------------------`;
  const r = parsearAutofind(txt);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { frame: 0, slot: 1, port: 3, sn: "48575443A1B2C3D4", equipo: "HG8310M" });
  assert.equal(r[1].port, 0);
});

test("ont info", () => {
  const txt = `
  F/S/P   ONT         SN         Control     Run      Config   Match    Protect
          ID                     flag        state    state    state    side
  ---------------------------------------------------------------------------
  0/1/0    0  48575443A1B2C3D4  active      online   normal   match    no
  0/1/0    7  48575443A1B2C3D5  deactivated offline  initial  initial  no`;
  const r = parsearOntInfo(txt);
  assert.equal(r.length, 2);
  assert.equal(r[1].ontId, 7);
  assert.equal(r[1].control, "deactivated");
  assert.equal(r[0].run, "online");
});

test("potencia", () => {
  const txt = `
  Rx optical power(dBm)                  : -20.45
  Tx optical power(dBm)                  : 2.31
  OLT Rx ONT optical power(dBm)          : -21.10`;
  const p = parsearPotencia(txt);
  assert.deepEqual(p, { rxOnu: -20.45, txOnu: 2.31, rxOlt: -21.1 });
  assert.equal(parsearPotencia("-").rxOnu, null);
});

test("clasificar señal", () => {
  assert.equal(clasificarSenal(-20), "Very good");
  assert.equal(clasificarSenal(-26), "Warning");
  assert.equal(clasificarSenal(-30), "Critical");
  assert.equal(clasificarSenal(null), "N/A");
});
