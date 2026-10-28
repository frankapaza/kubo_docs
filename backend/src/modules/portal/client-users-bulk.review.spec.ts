import { ConfigService } from "@nestjs/config";

import { ClientUsersBulkService } from "./client-users-bulk.service";
import { COLUMNA_CORREO, COLUMNA_NOMBRE } from "./domain/bulk-user-file";
import {
  decodeReview,
  deriveReviewKey,
  reviewMac,
} from "./domain/bulk-users-review";

const SECRETO_DE_PRUEBAS = "secreto-de-pruebas";

/**
 * Lo que un usuario o una invitación de verdad llevan dentro y que NUNCA debe
 * salir en el informe. Los dobles lo devuelven de verdad, para que la valla de
 * «no se escapa nada» pueda fallar: con objetos limpios no había nada que
 * escapar.
 */
const SENSIBLES = [
  "SECRETO-EN-CLARO-DE-LA-INVITACION",
  "HUELLA-DEL-SECRETO-DE-LA-INVITACION",
  "HASH-DE-CONTRASENA-CIFRADA",
];

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
  invitacionesVivas: { clientId: number; email: string; expiresAt?: Date }[];
  clientes: { id: number; razonSocial: string; status: string }[];
}

const LEJANO = new Date("2999-01-01T00:00:00Z");

function crearServicio(mundo: Mundo, secreto: string = SECRETO_DE_PRUEBAS) {
  const clientUsers = {
    findByEmail: async (email: string) => {
      const u = mundo.usuarios.find((x) => x.email === email);
      return u ? { ...u, passwordHash: SENSIBLES[2], fullName: "Nombre BD" } : null;
    },
  };
  const invitations = {
    // Respeta el instante de frescura, como el repositorio real: solo
    // devuelve la que aún no caducó en `now`.
    findLiveByEmail: async (email: string, now: Date) => {
      const i = mundo.invitacionesVivas.find((x) => x.email === email);
      if (!i || (i.expiresAt ?? LEJANO).getTime() <= now.getTime()) return null;
      return {
        ...i,
        id: 1,
        secret: SENSIBLES[0],
        secretFingerprint: SENSIBLES[1],
        expiresAt: i.expiresAt ?? LEJANO,
      };
    },
  };
  const clients = {
    findByIdOrFail: async (id: number) => {
      const c = mundo.clientes.find((x) => x.id === id);
      if (!c) throw new Error("no existe");
      return c;
    },
  };
  const config = new ConfigService({ JWT_ACCESS_SECRET: secreto });

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

  it("el correo de 181 caracteres se rechaza, no entra en el bloque; el de 180 pasa", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ["Largo", `${"a".repeat(175)}@x.com`],
        ["Justo", `${"b".repeat(174)}@x.com`],
      ]),
    );

    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].reason).toMatch(/correo.*180/i);
    expect(r.rows[1].verdict).toBe("SE_INVITARA");
    expect(decodeReview(r.revision)!.rows.map((f) => f.fullName)).toEqual([
      "Justo",
    ]);
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
    expect(r.totals).toEqual({ willInvite: 0, willReinvite: 1, rejected: 0 });
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
    // Firmado de verdad: es el MAC de ESTE bloque con la clave derivada del
    // secreto del servidor, no una constante ni una clave escrita en el código.
    expect(r.mac).toBe(
      reviewMac(deriveReviewKey(SECRETO_DE_PRUEBAS), r.revision),
    );
  });

  it("la firma depende del secreto del servidor: con otro secreto, otra firma", async () => {
    const archivo = csv([["Ana", "ana@x.com"]]);
    const a = await crearServicio(mundo(), "un-secreto").review(7, archivo);
    const b = await crearServicio(mundo(), "otro-secreto").review(7, archivo);

    expect(a.mac).toBe(reviewMac(deriveReviewKey("un-secreto"), a.revision));
    expect(b.mac).toBe(reviewMac(deriveReviewKey("otro-secreto"), b.revision));
    expect(a.mac).not.toBe(b.mac);
  });

  it("la etiqueta de caducidad sale en hora de Lima, media hora después de la emisión", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-15T15:00:00Z"));
    try {
      const r = await crearServicio(mundo()).review(
        7,
        csv([["Ana", "ana@x.com"]]),
      );
      expect(r.expiresAtLabel).toBe("10:30");
      expect(decodeReview(r.revision)!.issuedAt).toBe(
        new Date("2026-01-15T15:00:00Z").getTime(),
      );
    } finally {
      jest.useRealTimers();
    }
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
        { id: 2, clientId: 7, email: "ya@x.com", isActive: 1, isAdmin: 0 },
        { id: 3, clientId: 7, email: "jefe@x.com", isActive: 1, isAdmin: 1 },
        { id: 4, clientId: 7, email: "baja@x.com", isActive: 0, isAdmin: 0 },
      ],
      invitacionesVivas: [
        { clientId: 9, email: "luis@x.com" },
        { clientId: 7, email: "propia@x.com" },
      ],
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
        ["Ya", "ya@x.com"],
        ["Jefe", "jefe@x.com"],
        ["Baja", "baja@x.com"],
        ["Propia", "propia@x.com"],
      ]),
    );

    // Se mira el JSON ENTERO de la respuesta, no campos sueltos: así la valla
    // sigue en pie el día que alguien añada un campo.
    const json = JSON.stringify(r);
    expect(json).not.toContain("OTRA");
    for (const sensible of SENSIBLES) expect(json).not.toContain(sensible);
    expect(json).not.toContain("Nombre BD");
    // Y el bloque, ya decodificado, tampoco.
    expect(JSON.stringify(decodeReview(r.revision))).not.toContain("HASH");
  });

  it("la invitación se busca con el instante actual: una caducada no cuenta como viva", async () => {
    const m = mundo({
      invitacionesVivas: [
        {
          clientId: 7,
          email: "ana@x.com",
          expiresAt: new Date("2026-01-15T14:00:00Z"),
        },
      ],
    });
    jest.useFakeTimers().setSystemTime(new Date("2026-01-15T15:00:00Z"));
    try {
      // Caducó hace una hora: no hay invitación viva, es una invitación nueva.
      const despues = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));
      expect(despues.rows[0].verdict).toBe("SE_INVITARA");
      expect(despues.rows[0].reason).toBeNull();

      // Una hora antes de caducar, sí estaba viva.
      jest.setSystemTime(new Date("2026-01-15T13:00:00Z"));
      const antes = await crearServicio(m).review(7, csv([["Ana", "ana@x.com"]]));
      expect(antes.rows[0].verdict).toBe("SE_REINVITARA");
    } finally {
      jest.useRealTimers();
    }
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

describe("review — nombres con espacio en blanco y con caracteres de control", () => {
  it("colapsa espacios, tabuladores y saltos de línea a uno solo y recorta", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([['"  Ana \t\n  Pérez  "', "ana@x.com"]]),
    );
    expect(r.rows[0].verdict).toBe("SE_INVITARA");
    expect(r.rows[0].fullName).toBe("Ana Pérez");
  });

  it("un carácter de control dentro del nombre rechaza la fila, la nombra y dice qué pasa", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ["Ana\u0007Pérez", "ana@x.com"],
        ["Luis Gómez", "luis@x.com"],
      ]),
    );
    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].line).toBe(2);
    expect(r.rows[0].reason).toMatch(/control/i);
    expect(r.rows[1].verdict).toBe("SE_INVITARA");
    // Y no viaja en el bloque firmado.
    expect(decodeReview(r.revision)!.rows.map((f) => f.fullName)).toEqual(["Luis Gómez"]);
  });

  it("los invisibles de ancho cero se quitan: no son de control, y tampoco son el nombre de nadie", async () => {
    // Pegado desde una web o un PDF. Sin esto se guardaban dos «Ana Pérez»
    // que se leen igual y no son iguales para nadie salvo para quien compara
    // cadenas.
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ["Ana\u200bPérez", "ana@x.com"],
        ["\ufeffLuis \u200d Gómez\u2060", "luis@x.com"],
      ]),
    );

    expect(r.rows[0].verdict).toBe("SE_INVITARA");
    expect(r.rows[0].fullName).toBe("AnaPérez");
    expect(r.rows[1].verdict).toBe("SE_INVITARA");
    expect(r.rows[1].fullName).toBe("Luis Gómez");
    // Y lo que viaja firmado va ya limpio: lo que se aprueba es lo que se
    // invita, sin un invisible escondido entre medias.
    expect(decodeReview(r.revision)!.rows.map((f) => f.fullName)).toEqual([
      "AnaPérez",
      "Luis Gómez",
    ]);
  });

  it("un nombre que SOLO son invisibles es un nombre que falta", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([["\u200b\u200c\u200d", "ana@x.com"]]),
    );
    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].reason).toMatch(/falta el nombre/i);
  });

  it("el eco de una fila rechazada se trunca con puntos suspensivos", async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([["N".repeat(5000), "ana@x.com"]]),
    );
    expect(r.rows[0].verdict).toBe("RECHAZADA");
    expect(r.rows[0].fullName.length).toBeLessThan(300);
    expect(r.rows[0].fullName.endsWith("…")).toBe(true);
  });
});
