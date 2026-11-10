/* ============================================================
   SISTEMA INTERNO – CAMADA 2: GESTOR (máquinas, fila, estatísticas)
   ============================================================ */
class Gestor {
  constructor(numMaquinas) {
    this.maquinas = Array.from({ length: numMaquinas }, (_, i) => ({ id: i + 1, usuario: null }));
    this.usuarios = [];   // todos os usuários do dia
    this.fila = [];       // [{usuario, chegada}]
    this.esperas = [];    // tempos de espera concluídos (ms)
  }

  /* ---------- MÁQUINAS E FILA ---------- */
  registar(usuario) {
    this.usuarios.push(usuario);
    const livres = this.maquinas.filter(m => !m.usuario);
    if (livres.length) {                                  // atribuição aleatória
      const m = livres[Math.floor(Math.random() * livres.length)];
      m.usuario = usuario; usuario.maquina = m.id;
      return `Máquina ${m.id} atribuída a ${usuario.nome}.`;
    }
    this.fila.push({ usuario, chegada: Date.now() });
    return `Todas ocupadas. ${usuario.nome} está na fila (posição ${this.fila.length}).`;
  }

  libertar(usuario) {
    usuario.ativo = false;
    this.fila = this.fila.filter(f => f.usuario !== usuario);
    const m = this.maquinas.find(x => x.usuario === usuario);
    if (!m) return;
    m.usuario = null;
    if (this.fila.length) {                               // chama o próximo da fila
      const prox = this.fila.shift();
      this.esperas.push(Date.now() - prox.chegada);
      m.usuario = prox.usuario; prox.usuario.maquina = m.id;
    }
  }

  /* ---------- ESPERAS ---------- */
  _todasEsperas() { return [...this.esperas, ...this.fila.map(f => Date.now() - f.chegada)]; }
  esperaMaxima() { return Math.max(0, ...this._todasEsperas()); }
  esperaMedia() { const e = this._todasEsperas(); return e.length ? e.reduce((a, b) => a + b, 0) / e.length : 0; }

  /* ---------- ESTATÍSTICAS ---------- */
  _servicos() { return this.usuarios.flatMap(u => u.servicos.map(s => ({ s, u }))); }

  receitaPorTipo() {
    const r = { "Navegação": 0, "Cafeteria": 0, "Gravação de Discos": 0, "Impressão": 0 };
    this._servicos().forEach(({ s, u }) => r[s.tipo] += s.preco(u));
    return r;
  }
  pratoMaisPedido() {
    const c = {};
    this._servicos().filter(x => x.s.tipo === "Cafeteria")
      .forEach(x => x.s.pratos.forEach(p => c[p.nome] = (c[p.nome] || 0) + 1));
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return top ? `${top[0]} (${top[1]}x)` : "—";
  }
  rankingServicos() {
    const c = {};
    this._servicos().forEach(({ s }) => c[s.tipo] = (c[s.tipo] || 0) + 1);
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }
  atendidos() {
    const a = this.usuarios.filter(u => u.isAssociado()).length;
    return { associados: a, casuais: this.usuarios.length - a };
  }
  gastoMedio(associado) {
    const g = this.usuarios.filter(u => u.isAssociado() === associado);
    return g.length ? g.reduce((s, u) => s + u.total(), 0) / g.length : 0;
  }

  /* ---------- FICHEIRO (apenas associados, sem serviços do dia) ---------- */
  associadosParaJSON() {
    return JSON.stringify(this.usuarios.filter(u => u.isAssociado()).map(u => u.paraFicheiro()), null, 2);
  }
}
