import { describe, it, expect } from "vitest";
import { normalizarTitular, isCargoTitularEducacao } from "./titular";

const rodrigo = { nome: "Rodrigo Ramalho de Almeida", cargo: "Secretário Municipal de Educação, Ciência e Tecnologia", email: null, telefone: "(22) 2350-6072" };
const luciana = { nome: "Luciana de Azevedo Leite Vieira", cargo: "Chefe de Gabinete", email: null, telefone: null };

describe("normalizarTitular", () => {
  it("promove o secretário de Educação que estava na equipe", () => {
    const r = normalizarTitular({ secretario: null, cargo: null, equipe: [luciana, rodrigo] });
    expect(r.secretario).toBe("Rodrigo Ramalho de Almeida");
    expect(r.equipe.map((m) => m.nome)).toEqual(["Luciana de Azevedo Leite Vieira"]);
  });
  it("não apaga o secretário anterior quando a nova busca não traz titular", () => {
    const r = normalizarTitular({ secretario: null, cargo: null, equipe: [luciana], secretarioAnterior: "Rodrigo Ramalho de Almeida", cargoAnterior: "Secretário" });
    expect(r.secretario).toBe("Rodrigo Ramalho de Almeida");
  });
  it("não promove adjunto nem ex-secretário", () => {
    expect(isCargoTitularEducacao("Secretário Adjunto de Educação")).toBe(false);
    expect(isCargoTitularEducacao("Ex-Secretário Municipal de Educação")).toBe(false);
  });
  it("não promove quando há dois titulares diferentes", () => {
    const outro = { ...rodrigo, nome: "Maria Souza Lima" };
    expect(normalizarTitular({ secretario: null, cargo: null, equipe: [rodrigo, outro] }).secretario).toBeNull();
  });
});
