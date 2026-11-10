/* ============================================================
   SITE PÚBLICO – RESERVAS COM API E BASE DE DADOS SQLITE
   ============================================================ */

/* ---------- 1. CONFIGURAÇÃO ---------- */
const TAXAS = { conferencia: 1500, laboratorio: 2500 }; // MT por hora
const NOMES = { conferencia: "Sala de Conferências", laboratorio: "Sala de Laboratório" };
const FECHO = 21; // hora de fecho
const CHAVE_RESERVAS_LEGADAS = "reservas";
const $ = id => document.getElementById(id);
const mt = v => v.toLocaleString("pt-PT", { minimumFractionDigits: 2 }) + " MT";
let tokenGerente = $("formGerente") ? sessionStorage.getItem("tokenGerente") : null;
let reservasCache = [];

/* ---------- 2. INTERFACE ---------- */
if ($("data")) $("data").min = new Date().toISOString().split("T")[0]; // não permite datas passadas

if ($("tipo")) $("tipo").addEventListener("change", () => {
  // serviços de servidor só aparecem para laboratório
  $("blocoServidor").style.display = $("tipo").value === "laboratorio" ? "block" : "none";
});
if ($("formGerente")) $("formGerente").addEventListener("submit", entrarComoGerente);
if ($("btnSairGerente")) $("btnSairGerente").addEventListener("click", terminarSessaoGerente);
if ($("btnExportarReservasAntigas")) $("btnExportarReservasAntigas").addEventListener("click", exportarReservasAntigas);
if ($("btnImportarReservasAntigas")) $("btnImportarReservasAntigas").addEventListener("click", importarReservasAntigas);
if ($("btnActualizarReservas")) $("btnActualizarReservas").addEventListener("click", atualizarReservas);
if ($("btnRelatorioReservas")) $("btnRelatorioReservas").addEventListener("click", descarregarRelatorioExcel);
if ($("btnRelatorioPdf")) $("btnRelatorioPdf").addEventListener("click", prepararRelatorioPdf);
if ($("listaReservas")) $("listaReservas").addEventListener("click", gerirAcaoReserva);

async function pedidoApi(caminho, opcoes = {}) {
  const cabecalhos = new Headers(opcoes.headers || {});
  if (opcoes.body) cabecalhos.set("Content-Type", "application/json");
  if (tokenGerente) cabecalhos.set("Authorization", "Bearer " + tokenGerente);
  let resposta;
  try {
    resposta = await fetch(caminho, { ...opcoes, headers: cabecalhos });
  } catch (_) {
    throw new Error(mensagemServidorIndisponivel());
  }
  const resultado = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 401 && tokenGerente) terminarSessaoGerente("Sessão expirada. Entre novamente.");
    throw new Error(resultado.erro || `Erro do servidor (${resposta.status}).`);
  }
  return resultado;
}

function mensagemServidorIndisponivel() {
  if (location.protocol === "file:") {
    return "Não foi possível contactar o servidor. Execute iniciar_servidor.bat e abra http://127.0.0.1:8000 (não abra index.html directamente).";
  }
  return "Não foi possível contactar o servidor. Confirme se iniciar_servidor.bat está em execução e abra http://127.0.0.1:8000.";
}

async function entrarComoGerente(evento) {
  evento.preventDefault();
  const botao = $("btnEntrarGerente");
  botao.disabled = true;
  $("gerenteMensagem").textContent = "A verificar a senha...";
  try {
    const resultado = await pedidoApi("/api/login", {
      method: "POST",
      body: JSON.stringify({ senha: $("senhaGerente").value })
    });
    tokenGerente = resultado.token;
    sessionStorage.setItem("tokenGerente", tokenGerente);
    $("formGerente").reset();
    $("painelGerente").hidden = false;
    $("btnSairGerente").hidden = false;
    $("gerenteMensagem").textContent = "Sessão do gerente iniciada.";
    try {
      await migrarReservasAntigas();
    } catch (erro) {
      $("gerenteMensagem").textContent = erro.message;
      $("gerenteMensagem").className = "aviso";
    }
    await atualizarReservas();
  } catch (erro) {
    $("gerenteMensagem").textContent = erro.message;
    $("gerenteMensagem").className = "aviso";
  } finally {
    botao.disabled = false;
  }
}

async function terminarSessaoGerente(mensagem = "Sessão terminada.") {
  const token = tokenGerente;
  tokenGerente = null;
  sessionStorage.removeItem("tokenGerente");
  reservasCache = [];
  if ($("painelGerente")) $("painelGerente").hidden = true;
  if ($("btnSairGerente")) $("btnSairGerente").hidden = true;
  if ($("listaReservas")) $("listaReservas").replaceChildren();
  if ($("reservasMensagem")) $("reservasMensagem").textContent = "";
  if ($("gerenteMensagem")) {
    $("gerenteMensagem").textContent = mensagem;
    $("gerenteMensagem").className = "";
  }
  if (token) {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: "{}"
      });
    } catch (_) {
      if ($("gerenteMensagem")) {
        $("gerenteMensagem").textContent = `${mensagem} Não foi possível contactar o servidor para invalidar a sessão.`;
        $("gerenteMensagem").className = "aviso";
      }
    }
  }
}

async function migrarReservasAntigas() {
  let antigas;
  try {
    antigas = JSON.parse(localStorage.getItem(CHAVE_RESERVAS_LEGADAS) || "[]");
  } catch (erro) {
    throw new Error("Os dados antigos guardados neste navegador estão inválidos; não foram removidos.");
  }
  if (!Array.isArray(antigas) || !antigas.length) return;

  const resultado = await pedidoApi("/api/reservas/migrar", {
    method: "POST",
    body: JSON.stringify({ reservas: antigas })
  });
  localStorage.removeItem(CHAVE_RESERVAS_LEGADAS);
  $("gerenteMensagem").textContent = `${resultado.importadas} reserva(s) antigas transferidas para SQLite.`;
}

function exportarReservasAntigas() {
  try {
    const antigas = JSON.parse(localStorage.getItem(CHAVE_RESERVAS_LEGADAS) || "[]");
    if (!Array.isArray(antigas) || !antigas.length) {
      $("gerenteMensagem").textContent = "Não há reservas antigas neste armazenamento do navegador.";
      return;
    }
    const ficheiro = new Blob([JSON.stringify(antigas, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(ficheiro);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reservas-antigas-${dataDoRelatorio()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("gerenteMensagem").textContent = `${antigas.length} reserva(s) exportada(s). Guarde o ficheiro para importar no servidor.`;
  } catch (erro) {
    $("gerenteMensagem").textContent = "Não foi possível exportar os dados antigos deste navegador.";
    $("gerenteMensagem").className = "aviso";
  }
}

async function importarReservasAntigas() {
  const ficheiro = $("ficheiroReservasAntigas").files[0];
  if (!ficheiro) {
    $("gerenteMensagem").textContent = "Escolha o ficheiro JSON das reservas antigas.";
    $("gerenteMensagem").className = "aviso";
    return;
  }
  if (ficheiro.size > 2 * 1024 * 1024) {
    $("gerenteMensagem").textContent = "O ficheiro excede o limite de 2 MB.";
    $("gerenteMensagem").className = "aviso";
    return;
  }
  try {
    const reservas = JSON.parse((await ficheiro.text()).replace(/^\uFEFF/, ""));
    const resultado = await pedidoApi("/api/reservas/migrar", {
      method: "POST",
      body: JSON.stringify({ reservas })
    });
    $("ficheiroReservasAntigas").value = "";
    $("gerenteMensagem").textContent = `${resultado.importadas} reserva(s) importada(s). Códigos já existentes foram ignorados.`;
    $("gerenteMensagem").className = "";
    await atualizarReservas();
  } catch (erro) {
    $("gerenteMensagem").textContent = erro.message || "O ficheiro não contém reservas JSON válidas.";
    $("gerenteMensagem").className = "aviso";
  }
}

async function atualizarReservas() {
  if (!tokenGerente) return;
  $("reservasMensagem").textContent = "A carregar reservas...";
  try {
    const resultado = await pedidoApi("/api/reservas");
    reservasCache = resultado.reservas;
    mostrarReservas();
  } catch (erro) {
    $("reservasMensagem").textContent = erro.message;
    $("reservasMensagem").className = "aviso";
  }
}

async function gerirAcaoReserva(evento) {
  const botao = evento.target.closest("[data-marcar-pago]");
  if (!botao || !tokenGerente) return;
  if (!window.confirm(`Confirma que recebeu presencialmente o pagamento da reserva ${botao.dataset.marcarPago}?`)) return;
  botao.disabled = true;
  try {
    await pedidoApi(`/api/reservas/${encodeURIComponent(botao.dataset.marcarPago)}/pagamento`, {
      method: "PATCH"
    });
    $("reservasMensagem").textContent = "Pagamento confirmado e estado actualizado.";
    await atualizarReservas();
  } catch (erro) {
    $("reservasMensagem").textContent = erro.message;
    $("reservasMensagem").className = "aviso";
    botao.disabled = false;
  }
}

async function descarregarRelatorioExcel() {
  await atualizarReservas();
  if (!tokenGerente || $("reservasMensagem").classList.contains("aviso")) return;
  gerarRelatorioExcel();
}

async function prepararRelatorioPdf() {
  if (!tokenGerente) return;
  const janela = window.open("", "_blank");
  if (!janela) {
    $("reservasMensagem").textContent = "Permita pop-ups para abrir o relatório PDF.";
    $("reservasMensagem").className = "aviso";
    return;
  }
  janela.document.write("<p>A carregar o relatório...</p>");
  await atualizarReservas();
  if (!tokenGerente || $("reservasMensagem").classList.contains("aviso")) {
    janela.close();
    return;
  }
  gerarRelatorioPdf(janela);
}

async function verificarServidor() {
  try {
    await pedidoApi("/api/saude");
    $("gerenteMensagem").textContent = "Servidor SQLite ligado. Entre com a senha do gerente para gerir reservas.";
  } catch (_) {
    $("gerenteMensagem").textContent = mensagemServidorIndisponivel();
    $("gerenteMensagem").className = "aviso";
  }
}

if ($("formGerente")) {
  if (tokenGerente) restaurarSessaoGerente();
  else verificarServidor();
}

async function restaurarSessaoGerente() {
  try {
    await pedidoApi("/api/sessao");
    $("painelGerente").hidden = false;
    $("btnSairGerente").hidden = false;
    $("gerenteMensagem").textContent = "Sessão do gerente activa.";
    await atualizarReservas();
  } catch (erro) {
    $("gerenteMensagem").textContent = erro.message;
    $("gerenteMensagem").className = "aviso";
  }
}

/* ---------- 3. SUBMISSÃO ---------- */
if ($("formReserva")) $("formReserva").addEventListener("submit", e => {
  e.preventDefault();
  const tipo = $("tipo").value, horas = Number($("duracao").value);
  const [h, m] = $("hora").value.split(":").map(Number);

  if (h + m / 60 + horas > FECHO) {
    alert("A reserva ultrapassa o horário de fecho (21:00).");
    return;
  }
  const servicos = tipo === "laboratorio"
    ? [...document.querySelectorAll(".srv:checked")].map(c => ({ nome: c.dataset.n, valor: Number(c.value) }))
    : [];
  const reserva = {
    bi: $("bi").value, entidade: $("entidade").value, tipo,
    data: $("data").value, hora: $("hora").value, horas,
    servicos: servicos.map(s => s.nome)
  };
  const botao = e.submitter || e.target.querySelector('button[type="submit"]');
  botao.disabled = true;
  fetch("/api/reservas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reserva)
  }).then(async resposta => {
    const resultado = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(resultado.erro || `Erro do servidor (${resposta.status}).`);
    mostrarConfirmacao(resultado.reserva);
    e.target.reset();
    if (tokenGerente) await atualizarReservas();
  }).catch(erro => {
    $("confirmacao").innerHTML = `<div class="aviso">${escaparHtml(erro.message)}. Confirme se o servidor está ligado e tente novamente.</div>`;
  }).finally(() => {
    botao.disabled = false;
  });
});

function mostrarReservas() {
  const lista = reservasCache;
  const destino = $("listaReservas");
  destino.replaceChildren();

  $("reservasMensagem").textContent = lista.length
    ? `${lista.length} reserva(s) na base de dados SQLite.`
    : "Ainda não existem reservas registadas.";
  $("reservasMensagem").className = "";

  if (!lista.length) return;

  const tabela = document.createElement("table");
  const cabecalho = document.createElement("thead");
  const linhaCabecalho = document.createElement("tr");
  ["Código", "Data", "Hora", "Sala", "Entidade", "BI", "Duração", "Serviços", "Preço", "Estado", "Acção"]
    .forEach(titulo => {
      const th = document.createElement("th");
      th.textContent = titulo;
      linhaCabecalho.append(th);
    });
  cabecalho.append(linhaCabecalho);
  tabela.append(cabecalho);

  const corpo = document.createElement("tbody");
  [...lista].reverse().forEach(reserva => {
    const linha = document.createElement("tr");
    const valores = [
      reserva.codigo, reserva.data, reserva.hora, NOMES[reserva.tipo] || reserva.tipo,
      reserva.entidade, reserva.bi, `${reserva.horas} h`,
      Array.isArray(reserva.servicos) && reserva.servicos.length ? reserva.servicos.join(", ") : "—",
      typeof reserva.preco === "number" ? mt(reserva.preco) : "—",
      reserva.estado, ""
    ];
    valores.forEach(valor => {
      const celula = document.createElement("td");
      celula.textContent = valor == null ? "" : String(valor);
      linha.append(celula);
    });
    const acao = linha.lastElementChild;
    if (reserva.estado !== "Pago") {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "btn-pago";
      botao.dataset.marcarPago = reserva.codigo;
      botao.textContent = "Confirmar pagamento";
      acao.append(botao);
    } else {
      acao.textContent = reserva.pago_em ? `Pago em ${reserva.pago_em}` : "Pagamento confirmado";
    }
    corpo.append(linha);
  });
  tabela.append(corpo);
  destino.append(tabela);
}

function dadosRelatorio() {
  const lista = reservasCache;
  return {
    lista,
    total: lista.reduce((soma, reserva) =>
      soma + (typeof reserva.preco === "number" ? reserva.preco : 0), 0),
    pendentes: lista.filter(reserva => /pendente/i.test(reserva.estado || "")).length,
    pagas: lista.filter(reserva => reserva.estado === "Pago").length,
    recebido: lista.reduce((soma, reserva) =>
      soma + (reserva.estado === "Pago" && typeof reserva.preco === "number" ? reserva.preco : 0), 0),
    horas: lista.reduce((soma, reserva) =>
      soma + (typeof reserva.horas === "number" ? reserva.horas : 0), 0),
    gerado: new Date().toLocaleString("pt-MZ")
  };
}

function dataDoRelatorio() {
  return new Date().toISOString().slice(0, 10);
}

function xmlSeguro(valor) {
  return String(valor == null ? "" : valor).replace(/[&<>"']/g, caractere => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[caractere]);
}

function colunaExcel(numero) {
  let nome = "";
  while (numero > 0) {
    const resto = (numero - 1) % 26;
    nome = String.fromCharCode(65 + resto) + nome;
    numero = Math.floor((numero - 1) / 26);
  }
  return nome;
}

function criarFolhaExcel(relatorio) {
  const linhas = [];
  const merges = [];
  const adicionarLinha = (numero, celulas, altura) => {
    linhas.push(`<row r="${numero}"${altura ? ` ht="${altura}" customHeight="1"` : ""}>${celulas.join("")}</row>`);
  };
  const texto = (referencia, valor, estilo) =>
    `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xmlSeguro(valor)}</t></is></c>`;
  const numero = (referencia, valor, estilo) =>
    `<c r="${referencia}" s="${estilo}" t="n"><v>${Number(valor) || 0}</v></c>`;
  const mesclar = intervalo => merges.push(`<mergeCell ref="${intervalo}"/>`);
  const secao = (linha, titulo) => {
    adicionarLinha(linha, [texto(`A${linha}`, titulo, 4)]);
    mesclar(`A${linha}:J${linha}`);
  };

  adicionarLinha(1, [texto("A1", "CIBERCAFÉ · Universidade Zambeze", 1)], 32);
  adicionarLinha(2, [texto("A2", "RELATÓRIO DE RESERVAS · Beira, Moçambique", 2)], 23);
  mesclar("A1:J1");
  mesclar("A2:J2");
  secao(4, "DADOS DO CIBERCAFÉ");
  adicionarLinha(5, [
    texto("A5", "Entidade", 3), texto("B5", "CIBERCAFÉ – Universidade Zambeze", 9),
    texto("G5", "Gerência", 3), texto("H5", "Jesso e Joao", 9)
  ]);
  mesclar("B5:F5"); mesclar("H5:J5");
  adicionarLinha(6, [
    texto("A6", "Endereço", 3), texto("B6", "Campus da Universidade Zambeze, Beira, Sofala", 9),
    texto("G6", "E-mail", 3), texto("H6", "jesso.chitula@unizambeze.ac.mz", 9)
  ]);
  mesclar("B6:F6"); mesclar("H6:J6");
  adicionarLinha(7, [
    texto("A7", "Telefone", 3), texto("B7", "+258 87 209 4660 / +258 84 269 8026", 9),
    texto("G7", "Horário", 3), texto("H7", "Seg.–Sex. 07:30–21:00 · Sáb. 08:00–18:00 · Dom. fechado", 9)
  ]);
  mesclar("B7:F7"); mesclar("H7:J7");
  secao(9, "SALAS E TAXAS (METICAIS)");
  adicionarLinha(10, [texto("A10", "Sala", 5), texto("B10", "Taxa / hora", 5), texto("C10", "Detalhes", 5)]);
  mesclar("C10:J10");
  adicionarLinha(11, [texto("A11", NOMES.conferencia, 6), numero("B11", TAXAS.conferencia, 7), texto("C11", "Inclui datashow e computador.", 6)]);
  adicionarLinha(12, [texto("A12", NOMES.laboratorio, 6), numero("B12", TAXAS.laboratorio, 7), texto("C12", "Servidor Web 300 MT/h · Ficheiros 200 MT/h · Correio 250 MT/h.", 6)]);
  mesclar("C11:J11"); mesclar("C12:J12");
  secao(14, "RESUMO DO RELATÓRIO");
  adicionarLinha(15, [
    texto("A15", "Gerado em", 3), texto("B15", relatorio.gerado, 8),
    texto("C15", "Reservas", 3), numero("D15", relatorio.lista.length, 8),
    texto("E15", "Pendentes", 3), numero("F15", relatorio.pendentes, 8),
    texto("G15", "Horas reservadas", 3), numero("H15", relatorio.horas, 8),
    texto("I15", "Pagas", 3), numero("J15", relatorio.pagas, 8)
  ]);
  adicionarLinha(16, [
    texto("A16", "Valor total previsto", 3), numero("B16", relatorio.total, 7),
    texto("C16", "Valor recebido", 3), numero("D16", relatorio.recebido, 7),
    texto("E16", "Por receber", 3), numero("F16", relatorio.total - relatorio.recebido, 7)
  ]);
  mesclar("G16:J16");
  secao(18, "DETALHES DAS RESERVAS");

  const titulos = ["Código", "Data", "Hora", "Sala", "Entidade", "BI", "Duração (h)", "Serviços", "Preço (MT)", "Estado"];
  adicionarLinha(19, titulos.map((titulo, indice) => texto(`${colunaExcel(indice + 1)}19`, titulo, 5)), 30);
  if (relatorio.lista.length) {
    relatorio.lista.forEach((reserva, indice) => {
      const linha = indice + 20;
      const valores = [
        reserva.codigo, reserva.data, reserva.hora, NOMES[reserva.tipo] || reserva.tipo,
        reserva.entidade, reserva.bi, reserva.horas,
        Array.isArray(reserva.servicos) ? reserva.servicos.join(", ") : "",
        reserva.preco, reserva.estado
      ];
      const celulas = valores.map((valor, coluna) => {
        const referencia = `${colunaExcel(coluna + 1)}${linha}`;
        if (coluna === 8 && typeof valor === "number") return numero(referencia, valor, 7);
        if (coluna === 6 && typeof valor === "number") return numero(referencia, valor, 6);
        return texto(referencia, valor, indice % 2 ? 10 : 6);
      });
      adicionarLinha(linha, celulas, 30);
    });
  } else {
    adicionarLinha(20, [texto("A20", "Ainda não existem reservas registadas.", 6)]);
    mesclar("A20:J20");
  }
  const ultimaLinha = Math.max(20, 19 + relatorio.lista.length);
  const notaLinha = ultimaLinha + 2;
  adicionarLinha(notaLinha, [texto(`A${notaLinha}`, "Nota: a reserva só entra em vigor após o pagamento presencial no Cibercafé.", 9)]);
  mesclar(`A${notaLinha}:J${notaLinha}`);
  adicionarLinha(notaLinha + 1, [texto(`A${notaLinha + 1}`, "Universidade Zambeze – Faculdade de Ciências e Tecnologia · 8º Grupo PRWE PL · UC: Programação Web · Docente: MSc. Eng.º Félix Macueia", 9)]);
  mesclar(`A${notaLinha + 1}:J${notaLinha + 1}`);

  const ultimaColuna = "J";
  const dimensao = `A1:${ultimaColuna}${notaLinha + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="${dimensao}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="19" topLeftCell="A20" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="22"/><cols>
<col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>
<col min="3" max="3" width="13" customWidth="1"/><col min="4" max="4" width="25" customWidth="1"/>
<col min="5" max="6" width="26" customWidth="1"/><col min="7" max="7" width="15" customWidth="1"/>
<col min="8" max="8" width="34" customWidth="1"/><col min="9" max="9" width="18" customWidth="1"/>
<col min="10" max="10" width="34" customWidth="1"/></cols>
<sheetData>${linhas.join("")}</sheetData>${relatorio.lista.length ? `<autoFilter ref="A19:J${ultimaLinha}"/>` : ""}
<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>
<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

function criarEstilosExcel() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;MT&quot;"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="Aptos"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Aptos Display"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font>
<font><b/><color rgb="FF12332F"/><name val="Aptos"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF007168"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF12332F"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3F1EE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD5E0DE"/></left><right style="thin"><color rgb="FFD5E0DE"/></right>
<top style="thin"><color rgb="FFD5E0DE"/></top><bottom style="thin"><color rgb="FFD5E0DE"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function zipSemCompressao(arquivos) {
  const codificar = new TextEncoder();
  const partes = [];
  const centrais = [];
  let deslocamento = 0;
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | Math.floor(agora.getSeconds() / 2);
  const data = ((Math.max(1980, agora.getFullYear()) - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const escrever16 = (vista, offset, valor) => vista.setUint16(offset, valor, true);
  const escrever32 = (vista, offset, valor) => vista.setUint32(offset, valor >>> 0, true);

  for (const [nome, conteudo] of arquivos) {
    const nomeBytes = codificar.encode(nome);
    const dados = codificar.encode(conteudo);
    const crc = crc32(dados);
    const cabecalho = new Uint8Array(30 + nomeBytes.length);
    const vista = new DataView(cabecalho.buffer);
    escrever32(vista, 0, 0x04034B50); escrever16(vista, 4, 20); escrever16(vista, 6, 0x0800);
    escrever16(vista, 8, 0); escrever16(vista, 10, hora); escrever16(vista, 12, data);
    escrever32(vista, 14, crc); escrever32(vista, 18, dados.length); escrever32(vista, 22, dados.length);
    escrever16(vista, 26, nomeBytes.length); escrever16(vista, 28, 0); cabecalho.set(nomeBytes, 30);
    partes.push(cabecalho, dados);

    const central = new Uint8Array(46 + nomeBytes.length);
    const vistaCentral = new DataView(central.buffer);
    escrever32(vistaCentral, 0, 0x02014B50); escrever16(vistaCentral, 4, 20); escrever16(vistaCentral, 6, 20);
    escrever16(vistaCentral, 8, 0x0800); escrever16(vistaCentral, 10, 0);
    escrever16(vistaCentral, 12, hora); escrever16(vistaCentral, 14, data);
    escrever32(vistaCentral, 16, crc); escrever32(vistaCentral, 20, dados.length); escrever32(vistaCentral, 24, dados.length);
    escrever16(vistaCentral, 28, nomeBytes.length); escrever16(vistaCentral, 30, 0); escrever16(vistaCentral, 32, 0);
    escrever16(vistaCentral, 34, 0); escrever16(vistaCentral, 36, 0); escrever32(vistaCentral, 38, 0);
    escrever32(vistaCentral, 42, deslocamento); central.set(nomeBytes, 46);
    centrais.push(central);
    deslocamento += cabecalho.length + dados.length;
  }

  const tamanhoCentral = centrais.reduce((soma, parte) => soma + parte.length, 0);
  const fim = new Uint8Array(22);
  const vistaFim = new DataView(fim.buffer);
  escrever32(vistaFim, 0, 0x06054B50); escrever16(vistaFim, 4, 0); escrever16(vistaFim, 6, 0);
  escrever16(vistaFim, 8, arquivos.length); escrever16(vistaFim, 10, arquivos.length);
  escrever32(vistaFim, 12, tamanhoCentral); escrever32(vistaFim, 16, deslocamento); escrever16(vistaFim, 20, 0);
  return new Blob([...partes, ...centrais, fim], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function ficheiroExcel(relatorio) {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Relatório de reservas" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  const raiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const relsWorkbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipSemCompressao([
    ["[Content_Types].xml", tipos], ["_rels/.rels", raiz],
    ["xl/workbook.xml", workbook], ["xl/_rels/workbook.xml.rels", relsWorkbook],
    ["xl/styles.xml", criarEstilosExcel()], ["xl/worksheets/sheet1.xml", criarFolhaExcel(relatorio)]
  ]);
}

function gerarRelatorioExcel() {
  const relatorio = dadosRelatorio();
  if (!relatorio) return;
  const blob = ficheiroExcel(relatorio);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-reservas-${dataDoRelatorio()}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function gerarRelatorioPdf(janela) {
  const relatorio = dadosRelatorio();
  const linhas = relatorio.lista.length
    ? relatorio.lista.map(reserva => `<tr>
      <td>${escaparHtml(reserva.codigo)}</td><td>${escaparHtml(reserva.data)}</td><td>${escaparHtml(reserva.hora)}</td>
      <td>${escaparHtml(NOMES[reserva.tipo] || reserva.tipo)}</td><td>${escaparHtml(reserva.entidade)}</td>
      <td>${escaparHtml(reserva.bi)}</td><td>${escaparHtml(reserva.horas)} h</td>
      <td>${escaparHtml(Array.isArray(reserva.servicos) && reserva.servicos.length ? reserva.servicos.join(", ") : "—")}</td>
      <td class="valor">${escaparHtml(typeof reserva.preco === "number" ? mt(reserva.preco) : "—")}</td>
      <td>${escaparHtml(reserva.estado)}</td></tr>`).join("")
    : `<tr><td colspan="10" class="vazio">Ainda não existem reservas registadas.</td></tr>`;
  const logo = new URL("img/uzlogo.png", document.baseURI).href;
  const documento = `<!doctype html><html lang="pt-MZ"><head><meta charset="UTF-8">
    <title>Relatório de reservas · Cibercafé</title><style>
    @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}
    body{font-family:Arial,Segoe UI,sans-serif;color:#222;margin:0;font-size:10px}
    .topo{display:flex;align-items:center;gap:15px;border-bottom:5px solid #fce100;background:#007168;color:#fff;padding:14px 18px}
    .topo img{width:55px;height:55px;object-fit:contain;background:#fff;border-radius:4px;padding:3px}
    h1{font-size:21px;margin:0} .topo p{margin:3px 0 0;font-size:12px}
    h2{color:#12332f;font-size:16px;margin:16px 0 8px}
    .dados{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 16px;background:#f4f7f6;padding:10px;border-left:4px solid #007168}
    .resumo{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}.indicador{background:#e3f1ee;padding:8px 10px;border-radius:4px}
    .indicador b{display:block;color:#12332f;font-size:14px}.indicador span{font-size:9px;color:#444}
    table{width:100%;border-collapse:collapse;font-size:9px;table-layout:fixed}
    th{background:#007168;color:#fff;text-align:left}th,td{border:1px solid #d5e0de;padding:5px;overflow-wrap:anywhere;vertical-align:top}
    tbody tr:nth-child(even){background:#f4f7f6}.valor{text-align:right;white-space:nowrap}.vazio{text-align:center;padding:15px}
    .nota{margin-top:12px;padding:8px;border-left:4px solid #fce100;background:#fff8d6}
    .rodape{margin-top:12px;padding-top:6px;border-top:1px solid #d5e0de;color:#555;font-size:8px}
    .acoes{margin:12px 0}button{background:#007168;color:white;border:0;border-radius:4px;padding:8px 14px;cursor:pointer}
    @media print{.acoes{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>
    <div class="topo"><img src="${escaparHtml(logo)}" alt="Universidade Zambeze">
      <div><h1>CIBERCAFÉ</h1><p>Universidade Zambeze · Beira, Moçambique</p></div></div>
    <h2>Relatório de reservas de salas</h2>
    <div class="dados">
      <div><b>Endereço:</b> Campus da Universidade Zambeze, Beira, Sofala</div>
      <div><b>Telefone:</b> +258 87 209 4660 / +258 84 269 8026</div>
      <div><b>E-mail:</b> jesso.chitula@unizambeze.ac.mz</div>
      <div><b>Gerência:</b> Jesso e Joao</div>
      <div><b>Horário:</b> Seg.–Sex. 07:30–21:00 · Sáb. 08:00–18:00 · Domingo fechado</div>
      <div><b>Taxas:</b> Conferências ${mt(TAXAS.conferencia)}/h · Laboratório ${mt(TAXAS.laboratorio)}/h</div>
      <div><b>Serviços do laboratório:</b> Web 300 MT/h · Ficheiros 200 MT/h · Correio 250 MT/h</div>
      <div><b>Gerado em:</b> ${escaparHtml(relatorio.gerado)}</div>
      <div><b>Pagamento:</b> Presencial no Cibercafé</div>
    </div>
    <div class="resumo">
      <div class="indicador"><b>${relatorio.lista.length}</b><span>Total de reservas</span></div>
      <div class="indicador"><b>${relatorio.pendentes}</b><span>Pendentes de pagamento</span></div>
      <div class="indicador"><b>${relatorio.pagas}</b><span>Pagas</span></div>
      <div class="indicador"><b>${relatorio.horas} h</b><span>Horas reservadas</span></div>
      <div class="indicador"><b>${escaparHtml(mt(relatorio.total))}</b><span>Valor total previsto</span></div>
      <div class="indicador"><b>${escaparHtml(mt(relatorio.recebido))}</b><span>Valor recebido</span></div>
    </div>
    <table><thead><tr><th>Código</th><th>Data</th><th>Hora</th><th>Sala</th><th>Entidade</th>
      <th>BI</th><th>Duração</th><th>Serviços</th><th>Preço</th><th>Estado</th></tr></thead>
      <tbody>${linhas}</tbody></table>
    <div class="nota"><b>Nota:</b> a reserva só entra em vigor após o pagamento presencial no Cibercafé.</div>
    <div class="rodape">Universidade Zambeze – Faculdade de Ciências e Tecnologia · 8º Grupo PRWE PL · UC: Programação Web · Docente: MSc. Eng.º Félix Macueia<br>Relatório gerado localmente no navegador.</div>
    <div class="acoes"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div>
    <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));</scr` + `ipt>
    </body></html>`;
  janela.document.open();
  janela.document.write(documento);
  janela.document.close();
}

/* ---------- 6. CONFIRMAÇÃO ---------- */
function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, caractere => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[caractere]);
}

function mostrarConfirmacao(r) {
  $("confirmacao").innerHTML = `
    <div class="ok"><h3>Reserva registada!</h3>
    Código: <b>${escaparHtml(r.codigo)}</b><br>
    ${escaparHtml(NOMES[r.tipo])} · ${escaparHtml(r.data)} às ${escaparHtml(r.hora)} · ${escaparHtml(r.horas)} h<br>
    Entidade: ${escaparHtml(r.entidade)} (BI ${escaparHtml(r.bi)})<br>
    ${r.servicos.length ? "Servidor: " + r.servicos.map(escaparHtml).join(", ") + "<br>" : ""}
    <b>Preço a pagar: <span class="preco">${mt(r.preco)}</span></b><br>
    Estado: ${escaparHtml(r.estado)}. Apresente o código no Cibercafé para efectuar o pagamento.</div>`;
  $("confirmacao").scrollIntoView({ behavior: "smooth" });
}

if ($("listaReservas")) mostrarReservas();
