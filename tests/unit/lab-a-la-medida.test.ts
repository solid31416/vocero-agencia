import { afterEach, describe, expect, it } from "vitest";
import {
  CLAVES_TIPO,
  MAX_LINEA,
  MAX_LINEAS,
  clienteSchema,
  esClientePropio,
  normalizarGuion,
  personaParaElJuez,
  telefonoSintetico,
  type ClienteDto,
} from "@/lib/lab-a-la-medida";
import { PERSONAS } from "@/server/lab/personas";
import { armarPromptClientes, depurarClientes } from "@/server/lab/a-la-medida/prompt";
import { clientesDelRol, personaDeCliente } from "@/server/lab/a-la-medida/corrida";
import { labALaMedidaEnabled } from "@/server/lab/a-la-medida/flag";

/**
 * Módulo de la agencia — Laboratorio a la medida. Lo que importa: los 8 tipos
 * son las 8 personas de fábrica (el juez las conoce), lo que contesta la IA se
 * limpia antes de guardarse, y un cliente propio entra a la corrida como una
 * persona más, con teléfono sintético.
 */

const cliente = (over: Partial<ClienteDto> = {}): ClienteDto => ({
  id: "lpm_abc123",
  nombre: "Ana, dueña de una estética",
  tipo: "comprador_decidido",
  guion: ["Hola", "¿Cuánto el bot?"],
  activo: true,
  propio: false,
  ...over,
});

describe("tipos de cliente", () => {
  it("son exactamente las personas de fábrica", () => {
    expect([...CLAVES_TIPO].sort()).toEqual(PERSONAS.map((p) => p.key).sort());
  });
});

describe("normalizarGuion y clienteSchema", () => {
  it("quita vacíos, junta espacios y pone tope", () => {
    const largo = "x".repeat(MAX_LINEA + 50);
    const g = normalizarGuion(["  hola   qué tal ", "", "   ", largo, ...Array(20).fill("ok")]);
    expect(g[0]).toBe("hola qué tal");
    expect(g[1]).toHaveLength(MAX_LINEA);
    expect(g).toHaveLength(MAX_LINEAS);
  });

  it("rechaza un cliente sin mensajes o con un tipo inventado", () => {
    expect(clienteSchema.safeParse({ nombre: "X", tipo: "hostil", guion: ["", " "] }).success).toBe(false);
    expect(clienteSchema.safeParse({ nombre: "X", tipo: "vendedor", guion: ["hola"] }).success).toBe(false);
    expect(clienteSchema.safeParse({ nombre: " ", tipo: "hostil", guion: ["hola"] }).success).toBe(false);
  });

  it("acepta uno bien escrito", () => {
    const r = clienteSchema.safeParse({ nombre: " Pregunta por becas ", tipo: "fuera_de_kb", guion: ["¿Dan becas?", ""] });
    expect(r.success && r.data).toMatchObject({ nombre: "Pregunta por becas", guion: ["¿Dan becas?"] });
  });
});

describe("depurarClientes", () => {
  it("se queda con uno por tipo pedido, en orden, y descarta lo que no sirve", () => {
    const r = depurarClientes(
      {
        tipoNegocio: "  Escuela   primaria ",
        clientes: [
          { tipo: "hostil", nombre: "Molesto", guion: ["Escuela patito", "Inútiles"] },
          { tipo: "comprador_decidido", nombre: "Mamá", guion: ["Hola", "Quiero inscribir"] },
          { tipo: "comprador_decidido", nombre: "Duplicado", guion: ["a", "b"] },
          { tipo: "vendedor", nombre: "Inventado", guion: ["a", "b"] },
          { tipo: "sin_rumbo", nombre: "Corto", guion: ["ok"] },
          { tipo: "pide_humano", guion: ["Hola", "Quiero una persona"] },
        ],
      },
      ["comprador_decidido", "pide_humano", "sin_rumbo", "hostil"]
    );
    expect(r.tipoNegocio).toBe("Escuela primaria");
    expect(r.clientes.map((c) => c.tipo)).toEqual(["comprador_decidido", "pide_humano", "hostil"]);
    expect(r.clientes[0]!.nombre).toBe("Mamá");
    // Sin nombre, toma el del tipo.
    expect(r.clientes[1]!.nombre).toBe("Pide un humano");
  });
});

describe("armarPromptClientes", () => {
  it("lleva el negocio, el conocimiento, los tipos y lo que hay que evitar", () => {
    const { system, user } = armarPromptClientes({
      tipos: ["fuera_de_kb"],
      tipoNegocio: "Peluquería",
      quienes: "mamás que piden cita",
      nombreAgente: "Sofi",
      instrucciones: "Agenda citas",
      conocimiento: "P: ¿Cuánto el corte?\nR: $150",
      evitar: ["¿Hacen extensiones?"],
    });
    expect(system).toContain("JSON");
    expect(system).toContain("Nada de ferreterías");
    expect(user).toContain("TIPO DE NEGOCIO: Peluquería");
    expect(user).toContain("mamás que piden cita");
    expect(user).toContain("$150");
    expect(user).toContain("fuera_de_kb");
    expect(user).not.toContain("hostil");
    expect(user).toContain("¿Hacen extensiones?");
  });

  it("sin tipo de negocio, le pide deducirlo", () => {
    const { user } = armarPromptClientes({
      tipos: CLAVES_TIPO,
      tipoNegocio: "",
      quienes: "",
      nombreAgente: "Dani",
      instrucciones: "",
      conocimiento: "",
    });
    expect(user).toContain("dedúcelo");
    expect(user).not.toContain("QUIÉNES LE ESCRIBEN");
  });
});

describe("cliente propio en la corrida", () => {
  it("filtra por el rol, pero los escritos a mano entran siempre", () => {
    const lista = [
      cliente({ id: "lpm_1", tipo: "hostil" }),
      cliente({ id: "lpm_2", tipo: "comprador_decidido" }),
      cliente({ id: "lpm_3", tipo: "hostil", propio: true }),
    ];
    expect(clientesDelRol(lista, ["comprador_decidido"]).map((c) => c.id)).toEqual(["lpm_2", "lpm_3"]);
  });

  it("se vuelve persona con teléfono sintético y el tipo para el juez", () => {
    const p = personaDeCliente(cliente());
    expect(esClientePropio(p.key)).toBe(true);
    expect(p.script).toEqual(["Hola", "¿Cuánto el bot?"]);
    expect(p.contactName).toBe("[Prueba] Ana, dueña de una estética");
    expect(p.description).toBe(personaParaElJuez("comprador_decidido", "Ana, dueña de una estética"));
    expect(p.description).toContain("comprador_decidido");
  });

  it("el teléfono es estable, de 13 dígitos y no choca con los de fábrica", () => {
    const t = telefonoSintetico("lpm_abc123");
    expect(t).toBe(telefonoSintetico("lpm_abc123"));
    expect(t).toMatch(/^5210001\d{6}$/);
    expect(PERSONAS.map((p) => p.phone)).not.toContain(t);
    expect(telefonoSintetico("lpm_otro")).not.toBe(t);
  });
});

describe("bandera LAB_A_LA_MEDIDA", () => {
  const original = process.env.LAB_A_LA_MEDIDA;
  afterEach(() => {
    if (original === undefined) delete process.env.LAB_A_LA_MEDIDA;
    else process.env.LAB_A_LA_MEDIDA = original;
  });

  it("apagada por defecto, `on` la enciende", () => {
    delete process.env.LAB_A_LA_MEDIDA;
    expect(labALaMedidaEnabled()).toBe(false);
    process.env.LAB_A_LA_MEDIDA = "on";
    expect(labALaMedidaEnabled()).toBe(true);
  });
});
