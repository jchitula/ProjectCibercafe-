(function () {
/* ============================================================
   SISTEMA INTERNO – CAMADA 3: INTERFACE (liga o HTML ao Gestor)
   ============================================================ */
const gestor = new Gestor(5);                 // 5 máquinas no Cibercafé
const $ = id => document.getElementById(id);
const mt = v => v.toLocaleString("pt-PT", { minimumFractionDigits: 2 }) + " MT";
const aviso = t => $("msg").textContent = t;
const seg = ms => (ms / 1000).toFixed(0) + " s";
const utilizador = () => {
  const select = $("selUser");
  if (select.selectedIndex < 0) return undefined;
  const indice = Number(select.value);
  return Number.isInteger(indice) ? gestor.usuarios[indice] : undefined;
};

/* ---------- 1. REGISTAR USUÁRIO ---------- */
$("tipoUser").onchange = () =>
  $("camposAssoc").style.display = $("tipoUser").value === "associado" ? "grid" : "none";

$("formUser").onsubmit = e => {
  e.preventDefault();
  const n = $("nome").value, c = $("cartao").value;
  const u = $("tipoUser").value === "associado"
    ? new UsuarioAssociado(n, c, Number($("anos").value), $("cat").value)
    : new UsuarioCasual(n, c);
  aviso(gestor.registar(u));
  e.target.reset(); $("camposAssoc").style.display = "none";
  actualizar();
};

/* ---------- 2. MÁQUINAS E FILA ---------- */
function desenharMaquinas() {
  const linhas = gestor.maquinas.map(m =>
    `<tr><td>Máquina ${m.id}</td><td>${m.usuario ? m.usuario.nome : "<i>livre</i>"}</td></tr>`).join("");
  const fila = gestor.fila.map((f, i) => `<li>${i + 1}. ${f.usuario.nome}</li>`).join("") || "<li>Fila vazia</li>";
  $("painelMaquinas").innerHTML =
    `<table><tr><th>Máquina</th><th>Usuário</th></tr>${linhas}</table><h3>Fila de espera</h3><ul>${fila}</ul>`;
}

/* ---------- 3. OPERAÇÕES SOBRE USUÁRIO ---------- */
function desenharSelect() {
  const select = $("selUser");
  const selecionado = utilizador();
  select.replaceChildren();
  gestor.usuarios.forEach((u, indice) => {
    if (!u.ativo) return;
    const opcao = document.createElement("option");
    opcao.value = String(indice);
    opcao.textContent = `${u.nome} (${u.isAssociado() ? "associado " + u.categoria() : "casual"} · ${u.maquina ? "máq. " + u.maquina : "em espera"})`;
    select.append(opcao);
  });
  if (selecionado?.ativo) select.value = String(gestor.usuarios.indexOf(selecionado));
}
$("btnSubir").onclick = () => {
  const u = utilizador();
  if (!u?.isAssociado()) return aviso("Só associados têm categoria.");
  aviso(u.subir() ? `Categoria agora: ${u.categoria()}.` : "Já está na categoria máxima (ouro).");
  actualizar();
};
$("btnDescer").onclick = () => {
  const u = utilizador();
  if (!u?.isAssociado()) return aviso("Só associados têm categoria.");
  aviso(u.descer() ? `Categoria agora: ${u.categoria()}.` : "Já está na categoria mínima (bronze).");
  actualizar();
};
$("btnTotal").onclick = () => {
  const u = utilizador(); if (!u) return;
  const itens = u.servicos.map(s => `<li>${s.tipo} (máq. ${s.maquina}): ${mt(s.preco(u))}</li>`).join("");
  $("resUser").innerHTML = `<div class="ok"><b>${u.nome}</b><ul>${itens || "<li>Sem serviços</li>"}</ul>
    <b>Total a pagar: <span class="preco">${mt(u.total())}</span></b></div>`;
};
$("btnSair").onclick = () => {
  const u = utilizador(); if (!u) return;
  aviso(`${u.nome} terminou. Total pago: ${mt(u.total())}.`);
  gestor.libertar(u); actualizar();
};

/* ---------- 4. REGISTAR SERVIÇO ---------- */
const formularios = {
  nav: () => `<div class="linha"><div><label>Início</label><input type="time" id="f1" required></div>
    <div><label>Fim</label><input type="time" id="f2" required></div>
    <div><label>KB descarregados</label><input type="number" id="f3" min="0" value="0"></div></div>`,
  caf: () => `<div class="linha">` + MENU.map((p, i) =>
    `<div><label>${p.nome} (${p.preco} MT)</label><input type="number" min="0" value="0" data-i="${i}" class="qtd"></div>`).join("") + `</div>`,
  grav: () => `<div class="linha"><div><label>Velocidade</label><select id="f1">
    <option>8</option><option>12</option><option>16</option><option>24</option></select></div>
    <div><label>MB gravados</label><input type="number" id="f2" min="0" value="100"></div></div>`,
  imp: () => `<label>Texto a imprimir</label><textarea id="f1" rows="3"></textarea>
    <label>Tipo</label><select id="f2"><option value="jato">Jato (qualidade 1)</option><option value="laser">Laser (qualidade 2)</option></select>`
};
const desenharForm = () => $("camposServ").innerHTML = formularios[$("tipoServ").value]();
$("tipoServ").onchange = desenharForm;

$("btnServ").onclick = () => {
  const u = utilizador(); if (!u) return aviso("Seleccione um usuário.");
  if (!u.maquina) return aviso("Usuário em espera: ainda sem máquina.");
  const t = $("tipoServ").value; let s;
  if (t === "nav") {
    if (!$("f1").value || !$("f2").value) return aviso("Indique início e fim.");
    s = new Navegacao($("f1").value, $("f2").value, Number($("f3").value));
  } else if (t === "caf") {
    const pratos = [];
    document.querySelectorAll(".qtd").forEach(q => { for (let k = 0; k < Number(q.value); k++) pratos.push(MENU[q.dataset.i]); });
    if (!pratos.length) return aviso("Escolha pelo menos um prato.");
    s = new Cafeteria(pratos);
  } else if (t === "grav") {
    if (!u.isAssociado()) return aviso("Gravação de discos é só para associados.");
    s = new Gravacao(Number($("f1").value), Number($("f2").value));
  } else {
    s = new Impressao($("f1").value, $("f2").value);
  }
  s.maquina = u.maquina; u.adicionar(s);
  aviso(`${s.tipo} registado para ${u.nome}. Valor: ${mt(s.preco(u))}.`);
};

/* ---------- 5. RELATÓRIOS ---------- */
function desenharRelatorios() {
  const r = gestor.receitaPorTipo(), a = gestor.atendidos();
  const linhasReceita = Object.entries(r).map(([k, v]) => `<tr><td>${k}</td><td>${mt(v)}</td></tr>`).join("");
  const rank = gestor.rankingServicos().map(([k, v], i) => `<li>${i + 1}º ${k} (${v})</li>`).join("") || "<li>—</li>";
  $("relatorios").innerHTML = `
    <h3>Receita / lucro diário por serviço</h3><table><tr><th>Serviço</th><th>Receita</th></tr>${linhasReceita}</table>
    <h3>Prato mais consumido</h3><p>${gestor.pratoMaisPedido()}</p>
    <h3>Tempo de espera nas máquinas</h3>
    <p>Médio: ${seg(gestor.esperaMedia())} · Máximo (mais longo): ${seg(gestor.esperaMaxima())}</p>
    <h3>Ranking de serviços</h3><ol>${rank}</ol>
    <h3>Usuários atendidos</h3><p>Casuais: ${a.casuais} · Associados: ${a.associados}</p>
    <h3>Gasto médio por usuário</h3>
    <p>Associados: ${mt(gestor.gastoMedio(true))} · Casuais: ${mt(gestor.gastoMedio(false))}</p>`;
}
$("btnRel").onclick = desenharRelatorios;

$("btnSalvar").onclick = () => {                // descarrega associados.json
  const blob = new Blob([gestor.associadosParaJSON()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "associados.json"; a.click();
  aviso("Ficheiro associados.json gerado (sem os serviços do dia).");
};

/* ---------- ACTUALIZAÇÃO GERAL ---------- */
function actualizar() { desenharMaquinas(); desenharSelect(); desenharRelatorios(); }
desenharForm(); actualizar();
})();
