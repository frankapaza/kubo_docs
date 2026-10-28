import { ConfigService } from "@nestjs/config";

import { ClientUsersBulkService } from "./client-users-bulk.service";
import { COLUMNA_CORREO, COLUMNA_NOMBRE } from "./domain/bulk-user-file";
import { decodeReview } from "./domain/bulk-users-review";

/** El archivo, en la forma más simple de las dos que se aceptan. */
function csv(filas: string[][]): Buffer {
  return Buffer.from(
    [[COLUMNA_NOMBRE, COLUMNA_CORREO], ...filas]
      .map((f) => f.join(","))
      .join("\r\n"),
    "utf8",
  );
}

interface Mundo {
  usuarios: {
    id: number;
    clientId: number;
    email: string;
    isActive: number;
    isAdmin: number;
  }[];
  invitacionesVivas: { clientId: number; email: string }[];
  clientes: { id: number; razonSocial: string; status: string }[];
}

function crearServicio(mundo: Mundo) {
  const clientUsers = {
    findByEmail: async (email: string) =>
      mundo.usuarios.find((u) => u.email === email) ?? null,
  };
  const invitations = {
    findLiveByEmail: async (email: string) =>
      mundo.invitacionesVivas.find((i) => i.email === email) ?? null,
  };
  const clients = {
    findByIdOrFail: async (id: number) => {
      const c = mundo.clientes.find((x) => x.id === id);
      if (!c) throw new Error("no existe");
      return c;
    },
  };
  const config = new ConfigService({ JWT_ACCESS_SECRET: "secreto-de-pruebas" });

  return new ClientUsersBulkService(
    clientUsers as never,
    invitations as never,
    clients as never,
    {} as never, // PortalInvitationsService: no se usa en la revisión
    config,
  );
}

function mundo(parcial: Partial<Mundo> = {}): Mundo {
  return {
    usuarios: [],
    invitacionesVivas: [],
    clientes: [{ id: 7, razonSocial: "ACME S.A.C.", status: "CLIENT" }],
    ...parcial,
  };
}

describe("review — veredictos, uno por fila", () => {
  it("una fila limpia se va a invitar, y el correo sale normalizado", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([["Ana Pérez", "  ANA@X.COM "]]),
    );

    expect(r.rows).toEqual([
      {
        line: 2,
        fullName: "Ana Pérez",
        email: "ana@x.com",
        verdict: "SE_INVITARA",
        reason: null,
      },
    ]);
    expect(r.totals).toEqual({ willInvite: 1, willReinvite: 0, rejected: 0 });
    expect(r.clientName).toBe("ACME S.A.C.");
  });

  it("rechaza el correo mal escrito, el nombre vacío y lo que se pasa de largo — con el motivo", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ["Ana", "no-es-un-correo"],
        ["", "b@x.com"],
        ["N".repeat(181), "c@x.com"],
      ]),
    );

    expect(r.rows.map((f) => f.verdict)).toEqual([
      "RECHAZADA",
      "RECHAZADA",
      "RECHAZADA",
    ]);
    expect(r.rows[0].reason).toMatch(/correo/i);
    expect(r.rows[1].reason).toMatch(/nombre/i);
    expect(r.rows[2].reason).toMatch(/180/);
  });

  it("el repetido dentro del archivo se detecta con el correo YA normalizado, y dice en qué fila estaba", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ["Ana Pérez", "ana@x.com"],
        ["Ana P.", "ANA@X.COM"],
      ]),
    );

    expect(r.rows[0].verdict).toBe("SE_INVITARA");
    expect(r.rows[1].verdict).toBe("RECHAZADA");
    expect(r.rows[1].reason).toMatch(/fila 2/);
  });

  it("quien ya es usuario activo de esta empresa se rechaza: su contraseña no se toca", async () => {
    const m = mundo({
      usuarios: [
        { id: 1, clientId: 7, email: "ana@x.com", isActive: 1, isAdmin: 0 },
      ],
    });
    const r = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));

    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].reason).toMatch(/ya es usuario/i);
  });

  it("quien está desactivado y no es administrador se invita: al aceptar recupera su acceso", async () => {
    const m = mundo({
      usuarios: [
        { id: 1, clientId: 7, email: "ana@x.com", isActive: 0, isAdmin: 0 },
      ],
    });
    const r = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));

    expect(r.rows[0].verdict).toBe("SE_INVITARA");
    expect(r.rows[0].reason).toMatch(/recuperará su acceso/i);
  });

  it("un administrador desactivado NO se toca: la carga no toca administradores en ninguna dirección", async () => {
    const m = mundo({
      usuarios: [
        { id: 1, clientId: 7, email: "jefe@x.com", isActive: 0, isAdmin: 1 },
      ],
    });
    const r = await crearServicio(m).review(7, csv([["Jefe", "jefe@x.com"]]));

    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].reason).toMatch(/administrador/i);
  });

  it("quien ya es de otra empresa se rechaza SIN nombrarla — excepción de la decisión 10", async () => {
    // El nombre de la empresa 9 ('OTRA S.A.') está en el mundo para comprobar
    // justo lo contrario de lo que comprobaba esta prueba antes: que NO
    // aparece en el motivo. Este informe sale del panel hacia un correo al
    // cliente, y ese correo no lo lee ningún ADMIN.
    const m = mundo({
      usuarios: [
        { id: 1, clientId: 9, email: "ana@x.com", isActive: 1, isAdmin: 0 },
      ],
      clientes: [
        { id: 7, razonSocial: "ACME S.A.C.", status: "CLIENT" },
        { id: 9, razonSocial: "OTRA S.A.", status: "CLIENT" },
      ],
    });
    const r = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));

    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].reason).toMatch(/otra empresa/i);
    expect(r.rows[0].reason).not.toContain("OTRA S.A.");
  });

  it("quien ya tiene invitación viva en esta empresa se REINVITA, y se avisa de que el enlace anterior muere", async () => {
    const m = mundo({
      invitacionesVivas: [{ clientId: 7, email: "ana@x.com" }],
    });
    const r = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));

    expect(r.rows[0].verdict).toBe("SE_REINVITARA");
    expect(r.rows[0].reason).toMatch(/dejará de funcionar/i);
  });

  it("una invitación viva de OTRA empresa se rechaza, y la ajena no se toca", async () => {
    const m = mundo({
      invitacionesVivas: [{ clientId: 9, email: "ana@x.com" }],
    });
    const r = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));

    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].reason).toMatch(/otra empresa/i);
  });

  it("una empresa que dejó de ser cliente tumba el archivo entero antes de mirar ninguna fila", async () => {
    const m = mundo({
      clientes: [{ id: 7, razonSocial: "ACME", status: "FORMER_CLIENT" }],
    });

    await expect(
      crearServicio(m).review(7, csv([["Ana", "ana@x.com"]])),
    ).rejects.toThrow(/dejó de ser cliente/i);
  });

  it("un prospecto SÍ puede recibir invitaciones, igual que en R4", async () => {
    const m = mundo({
      clientes: [{ id: 7, razonSocial: "ACME", status: "PROSPECT" }],
    });
    const r = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));

    expect(r.rows[0].verdict).toBe("SE_INVITARA");
  });
});

describe("review — el bloque firmado que sale", () => {
  it("lleva SOLO las filas aprobadas, con la empresa dentro, y va firmado", async () => {
    const m = mundo({
      usuarios: [
        { id: 1, clientId: 7, email: "ya@x.com", isActive: 1, isAdmin: 0 },
      ],
    });
    const r = await crearServicio(m).review(
      7,
      csv([
        ["Ana", "ana@x.com"],
        ["Ya", "ya@x.com"],
      ]),
    );

    const payload = decodeReview(r.revision)!;
    expect(payload.clientId).toBe(7);
    expect(payload.rows).toEqual([
      { line: 2, fullName: "Ana", email: "ana@x.com" },
    ]);
    expect(r.mac).toHaveLength(64);
  });

  it("un archivo sin ninguna fila aprobada NO devuelve bloque: no hay nada que confirmar", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([["Ana", "no-es-un-correo"]]),
    );

    expect(r.totals.rejected).toBe(1);
    expect(r.revision).toBe("");
    expect(r.mac).toBe("");
  });
});

describe("review — lo que el brief añade a la receta", () => {
  it("una fila con celdas de más sale con el motivo que la explica, y conserva su contenido", async () => {
    // «Pérez, Ana» sin entrecomillar: la coma desplaza las columnas.
    const r = await crearServicio(mundo()).review(
      7,
      Buffer.from(
        [`${COLUMNA_NOMBRE},${COLUMNA_CORREO}`, "Pérez, Ana,ana@x.com"].join(
          "\r\n",
        ),
        "utf8",
      ),
    );

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].reason).toMatch(/coma/i);
    expect(r.rows[0].reason).toMatch(/fila 2/);
    expect(r.rows[0].fullName).toBe("Pérez");
    expect(r.revision).toBe("");
  });

  it("una fila mala no tumba las buenas, y las buenas son las únicas que viajan en el bloque", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ["Ana", "ana@x.com"],
        ["Mala", "no-es-correo"],
        ["Luis", "luis@x.com"],
      ]),
    );

    expect(r.rows.map((f) => f.verdict)).toEqual([
      "SE_INVITARA",
      "RECHAZADA",
      "SE_INVITARA",
    ]);
    expect(decodeReview(r.revision)!.rows.map((f) => f.email)).toEqual([
      "ana@x.com",
      "luis@x.com",
    ]);
  });

  it("un correo repetido cuya primera aparición fue rechazada por forma no marca a la segunda", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ["Ana", ""],
        ["Ana", "ana@x.com"],
      ]),
    );

    expect(r.rows.map((f) => f.verdict)).toEqual(["RECHAZADA", "SE_INVITARA"]);
  });

  it("revisar no manda nada ni crea ninguna invitación: el servicio de invitaciones ni se toca", async () => {
    const tocado: string[] = [];
    const espia = new Proxy(
      {},
      { get: (_t, p) => (tocado.push(String(p)), undefined) },
    );
    const svc = new ClientUsersBulkService(
      { findByEmail: async () => null } as never,
      { findLiveByEmail: async () => null } as never,
      {
        findByIdOrFail: async () => ({
          id: 7,
          razonSocial: "ACME",
          status: "CLIENT",
        }),
      } as never,
      espia as never,
      new ConfigService({ JWT_ACCESS_SECRET: "s" }),
    );

    await svc.review(7, csv([["Ana", "ana@x.com"]]));

    expect(tocado).toEqual([]);
  });

  it("ningún motivo ni el bloque nombran a la otra empresa, ni dejan salir secretos", async () => {
    const m = mundo({
      usuarios: [
        { id: 1, clientId: 9, email: "ana@x.com", isActive: 1, isAdmin: 0 },
      ],
      invitacionesVivas: [{ clientId: 9, email: "luis@x.com" }],
      clientes: [
        { id: 7, razonSocial: "ACME S.A.C.", status: "CLIENT" },
        { id: 9, razonSocial: "OTRA S.A.", status: "CLIENT" },
      ],
    });
    const r = await crearServicio(m).review(
      7,
      csv([
        ["Ana", "ana@x.com"],
        ["Luis", "luis@x.com"],
      ]),
    );

    expect(JSON.stringify(r)).not.toContain("OTRA");
  });

  it("el identificador de la empresa llega como cadena desde la base y aun así se reconoce como propia", async () => {
    const m = mundo({
      usuarios: [
        {
          id: 1,
          clientId: "7" as never,
          email: "ana@x.com",
          isActive: 1,
          isAdmin: 0,
        },
      ],
    });
    const r = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));

    expect(r.rows[0].reason).toMatch(/ya es usuario/i);
  });
});
