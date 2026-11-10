/* ============================================================
   SISTEMA INTERNO – CAMADA 1: MODELOS (classes e regras de preço)
   ============================================================ */
const CATEGORIAS = ["bronze", "prata", "ouro"];

/* ---------- USUÁRIOS ---------- */
class Usuario {
  constructor(nome, cartao) {
    this.nome = nome; this.cartao = cartao;
    this.maquina = null;      // nº da máquina atribuída
    this.servicos = [];       // serviços do dia
    this.ativo = true;
  }
  isAssociado() { return false; }
  categoria() { return null; }
  adicionar(servico) { this.servicos.push(servico); }
  total() { return this.servicos.reduce((s, sv) => s + sv.preco(this), 0); }
}

class UsuarioCasual extends Usuario {}

class UsuarioAssociado extends Usuario {
  constructor(nome, cartao, anos, categoria) {
    super(nome, cartao);
    this.anos = anos; this.cat = categoria;
  }
  isAssociado() { return true; }
  categoria() { return this.cat; }
  subir()  { const i = CATEGORIAS.indexOf(this.cat); if (i < 2) this.cat = CATEGORIAS[i + 1]; return i < 2; }
  descer() { const i = CATEGORIAS.indexOf(this.cat); if (i > 0) this.cat = CATEGORIAS[i - 1]; return i > 0; }
  paraFicheiro() { return { nome: this.nome, cartao: this.cartao, anos: this.anos, categoria: this.cat }; }
}

/* ---------- SERVIÇOS (cada um calcula o seu preço) ---------- */
class Servico {
  constructor(tipo) { this.tipo = tipo; this.hora = new Date(); this.maquina = null; }
}

class Navegacao extends Servico {
  constructor(inicio, fim, kb) { super("Navegação"); this.inicio = inicio; this.fim = fim; this.kb = kb; }
  horas() {
    const [h1, m1] = this.inicio.split(":").map(Number), [h2, m2] = this.fim.split(":").map(Number);
    return Math.max(0, (h2 + m2 / 60) - (h1 + m1 / 60));
  }
  preco(u) { return this.horas() * (u.isAssociado() ? 1 : 1.5) + this.kb * 2; }
}

class Cafeteria extends Servico {
  constructor(pratos) { super("Cafeteria"); this.pratos = pratos; } // [{nome, preco}]
  preco(u) { return this.pratos.reduce((s, p) => s + p.preco, 0) * (u.isAssociado() ? 1 : 1.5); }
}

class Gravacao extends Servico {
  constructor(velocidade, mb) { super("Gravação de Discos"); this.velocidade = velocidade; this.mb = mb; }
  preco(u) {
    const semTaxa = u.isAssociado() && ["prata", "ouro"].includes(u.categoria());
    return (semTaxa ? 0 : this.velocidade / 16) + this.mb / 700;
  }
}

class Impressao extends Servico {
  constructor(texto, tipoImp) { super("Impressão"); this.texto = texto; this.tipoImp = tipoImp; }
  palavras() { return this.texto.trim() ? this.texto.trim().split(/\s+/).length : 0; }
  preco(u) {
    const qualidade = this.tipoImp === "laser" ? 2 : 1;
    const semQual = u.isAssociado() && u.categoria() === "ouro";
    return this.palavras() * (1.5 + (semQual ? 0 : qualidade));
  }
}
