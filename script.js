(function(){
  "use strict";

  var CURSOS_DISPONIVEIS = [
    { codigo: 1, nome: "Tecnologias de Produção de Biocombustíveis" },
    { codigo: 2, nome: "Design de Animação e Multimídia" },
    { codigo: 3, nome: "Serviço Social (Pós-laboral / Noturno)" },
    { codigo: 4, nome: "Agronomia" },
    { codigo: 5, nome: "Design de Comunicação" },
    { codigo: 6, nome: "Enfermagem Veterinária" },
    { codigo: 7, nome: "Engenharia Informática" },
    { codigo: 8, nome: "Equinicultura" },
    { codigo: 9, nome: "Gestão" },
    { codigo: 10, nome: "Serviço Social" },
    { codigo: 11, nome: "Turismo" },
    { codigo: 12, nome: "Enfermagem" },
    { codigo: 13, nome: "Higiene Oral" },
    { codigo: 14, nome: "Gestão de Publicidade e Marketing" },
    { codigo: 15, nome: "Jornalismo e Comunicação" },
    { codigo: 16, nome: "Educação Básica" },
    { codigo: 17, nome: "Gestão (Pós-laboral / Noturno)" }
  ];
  var TURNOS_DISPONIVEIS = ["Diurno", "Noturno"];

  var STORAGE_KEY = "alunos-data";
  var state = { alunos: [], loaded: false, query: "", risco: "", turno: "", curso: "", ordenacao: { campo: null, direcao: "asc" } };
  var elementoComFocoAntesDoModal = null;

  var alunosService = {
    listar: function(){
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;

      var alunosSalvos = JSON.parse(raw);
      if(!Array.isArray(alunosSalvos)) return null;

      return alunosSalvos.filter(function(aluno){
        return aluno && typeof aluno === "object" && typeof aluno.nome === "string" && typeof aluno.curso === "string";
      });
    },
    salvar: function(alunos){
      localStorage.setItem(STORAGE_KEY, JSON.stringify(alunos));
      return true;
    }
  };

  /* ---------------- utilidades ---------------- */

  function gerarId(){
    return "al_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8);
  }

  function escapeHtml(str){
    return String(str == null ? "" : str).replace(/[&<>"']/g, function(c){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
    });
  }

  function normalizarTexto(str){
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function cursoPorCodigo(codigo){
    return CURSOS_DISPONIVEIS.find(function(curso){ return curso.codigo === Number(codigo); }) || null;
  }

  function opcoesCurso(codigoSelecionado, nomeLegado){
    var selecionado = Number(codigoSelecionado) || "";
    var opcoes = '<option value="">Selecione o curso</option>';
    if(nomeLegado && !cursoPorCodigo(selecionado)){
      opcoes += '<option value="legacy" selected>' + escapeHtml(nomeLegado) + ' (cadastro existente)</option>';
    }
    return opcoes + CURSOS_DISPONIVEIS.map(function(curso){
      return '<option value="' + curso.codigo + '"' + (curso.codigo === selecionado ? ' selected' : '') + '>' + escapeHtml(curso.nome) + '</option>';
    }).join("");
  }

  var ESTADOS_CIVIS = [
    { codigo: 1, nome: "Solteiro(a)" },
    { codigo: 2, nome: "Casado(a)" },
    { codigo: 3, nome: "Viúvo(a)" },
    { codigo: 4, nome: "Divorciado(a)" },
    { codigo: 5, nome: "União estável" },
    { codigo: 6, nome: "Separado(a) judicialmente" }
  ];

  function opcoesEstadoCivil(codigoSelecionado){
    return '<option value="">Não informado</option>' + ESTADOS_CIVIS.map(function(item){
      return '<option value="' + item.codigo + '"' + (Number(codigoSelecionado) === item.codigo ? ' selected' : '') + '>' + item.nome + '</option>';
    }).join("");
  }

  function opcoesSimNao(valor){
    var selecionado = valor === true ? "1" : (valor === false ? "0" : "");
    return '<option value="">Não informado</option>' +
      '<option value="1"' + (selecionado === "1" ? ' selected' : '') + '>Sim</option>' +
      '<option value="0"' + (selecionado === "0" ? ' selected' : '') + '>Não</option>';
  }

  function renderCamposIngresso(prefixo, aluno){
    aluno = aluno || {};
    var cursoSelecionado = Number(aluno.cursoCodigo) || "";
    var turnoSelecionado = aluno.turnoCodigo == null ? "" : String(aluno.turnoCodigo);
    var cursoOptions = opcoesCurso(cursoSelecionado, aluno.curso);
    var turnoOptions = '<option value="">Selecione o período</option>' +
      '<option value="1"' + (turnoSelecionado === "1" ? ' selected' : '') + '>Diurno</option>' +
      '<option value="0"' + (turnoSelecionado === "0" ? ' selected' : '') + '>Noturno</option>';

    if(aluno.turno && turnoSelecionado === ""){
      turnoOptions += '<option value="legacy" selected>' + escapeHtml(aluno.turno) + ' (cadastro existente)</option>';
    }

    return '<fieldset class="form-section">' +
      '<legend>Dados de ingresso</legend>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="' + prefixo + '-curso">Curso</label><select id="' + prefixo + '-curso" required>' + cursoOptions + '</select><span class="field-hint">Código conforme o catálogo demonstrativo do notebook.</span></div>' +
        '<div class="field"><label for="' + prefixo + '-data">Data de matrícula</label><input id="' + prefixo + '-data" type="date" value="' + escapeHtml(aluno.dataMatricula || hojeISO()) + '" required /></div>' +
        '<div class="field"><label for="' + prefixo + '-idade">Idade na matrícula</label><input id="' + prefixo + '-idade" type="number" min="16" max="100" step="1" value="' + (aluno.idadeIngresso == null ? "" : aluno.idadeIngresso) + '" required /></div>' +
        '<div class="field"><label for="' + prefixo + '-turno">Período do curso</label><select id="' + prefixo + '-turno" required>' + turnoOptions + '</select><span class="field-hint">Mapeado para diurno/noturno, como no dataset.</span></div>' +
        '<div class="field"><label for="' + prefixo + '-ordem">Ordem da candidatura</label><input id="' + prefixo + '-ordem" type="number" min="0" step="1" value="' + (aluno.ordemCandidatura == null ? "" : aluno.ordemCandidatura) + '" /></div>' +
        '<div class="field"><label for="' + prefixo + '-modo">Modo de ingresso (código provisório)</label><input id="' + prefixo + '-modo" type="number" min="0" step="1" value="' + (aluno.modoIngressoCodigo == null ? "" : aluno.modoIngressoCodigo) + '" /><span class="field-hint">Confirmar os códigos com a equipe do modelo antes de integrar.</span></div>' +
        '<div class="field"><label for="' + prefixo + '-qualificacao">Escolaridade anterior (código provisório)</label><input id="' + prefixo + '-qualificacao" type="number" min="0" step="1" value="' + (aluno.qualificacaoAnteriorCodigo == null ? "" : aluno.qualificacaoAnteriorCodigo) + '" /><span class="field-hint">Confirmar os códigos com a equipe do modelo antes de integrar.</span></div>' +
        '<div class="field"><label for="' + prefixo + '-civil">Estado civil</label><select id="' + prefixo + '-civil">' + opcoesEstadoCivil(aluno.estadoCivilCodigo) + '</select></div>' +
      '</div>' +
    '</fieldset>' +
    '<fieldset class="form-section">' +
      '<legend>Situação financeira</legend>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="' + prefixo + '-bolsa">Bolsa de estudos</label><select id="' + prefixo + '-bolsa">' + opcoesSimNao(aluno.bolsista) + '</select></div>' +
        '<div class="field"><label for="' + prefixo + '-devedor">Possui dívida</label><select id="' + prefixo + '-devedor">' + opcoesSimNao(aluno.devedor) + '</select></div>' +
        '<div class="field"><label for="' + prefixo + '-mensalidade">Mensalidades em dia</label><select id="' + prefixo + '-mensalidade">' + opcoesSimNao(aluno.mensalidadeEmDia) + '</select></div>' +
      '</div>' +
    '</fieldset>' +
    '<p class="form-note">Os códigos de ingresso/escolaridade são provisórios. A previsão permanece pendente até a integração segura com a API.</p>';
  }

  function renderCamposAcademicos(prefixo, aluno){
    aluno = aluno || {};
    return '<fieldset class="form-section">' +
      '<legend>Acompanhamento acadêmico</legend>' +
      '<p class="form-section-note">Atualize estes indicadores após o início das aulas. Eles ainda não são enviados à API.</p>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="' + prefixo + '-freq">Frequência (%)</label><input id="' + prefixo + '-freq" type="number" min="0" max="100" step="0.1" value="' + (aluno.frequencia == null ? "" : aluno.frequencia) + '" /></div>' +
        '<div class="field"><label for="' + prefixo + '-media">Média acadêmica (0–10)</label><input id="' + prefixo + '-media" type="number" min="0" max="10" step="0.1" value="' + (aluno.media == null ? "" : aluno.media) + '" /></div>' +
        '<div class="field"><label for="' + prefixo + '-reprovadas">Disciplinas reprovadas</label><input id="' + prefixo + '-reprovadas" type="number" min="0" step="1" value="' + (aluno.disciplinasReprovadas == null ? "" : aluno.disciplinasReprovadas) + '" /><span class="field-hint">Campo ilustrativo do payload descrito no README do backend.</span></div>' +
      '</div>' +
    '</fieldset>';
  }

  function lerDadosAcademicos(prefixo){
    function numero(campo){
      var valor = document.getElementById(prefixo + "-" + campo).value;
      return valor === "" ? null : Number(valor);
    }
    return {
      frequencia: numero("freq"),
      media: numero("media"),
      disciplinasReprovadas: numero("reprovadas")
    };
  }

  function lerDadosIngresso(prefixo, alunoAnterior){
    function valor(campo){ return document.getElementById(prefixo + "-" + campo).value; }
    function codigo(campo){ return valor(campo) === "" ? null : Number(valor(campo)); }
    function simNao(campo){ return valor(campo) === "" ? null : valor(campo) === "1"; }

    var cursoValue = valor("curso");
    var curso = cursoValue === "legacy" ? null : cursoPorCodigo(cursoValue);
    var turnoValue = valor("turno");
    var turnoCodigo = turnoValue === "legacy" ? null : codigo("turno");

    return {
      cursoCodigo: curso ? curso.codigo : (alunoAnterior ? alunoAnterior.cursoCodigo || null : null),
      curso: curso ? curso.nome : (alunoAnterior ? alunoAnterior.curso : ""),
      dataMatricula: valor("data"),
      idadeIngresso: Number(valor("idade")),
      turnoCodigo: turnoCodigo == null && alunoAnterior ? alunoAnterior.turnoCodigo || null : turnoCodigo,
      turno: turnoCodigo === 1 ? "Diurno" : (turnoCodigo === 0 ? "Noturno" : (alunoAnterior ? alunoAnterior.turno : "")),
      ordemCandidatura: codigo("ordem"),
      modoIngressoCodigo: codigo("modo"),
      qualificacaoAnteriorCodigo: codigo("qualificacao"),
      estadoCivilCodigo: codigo("civil"),
      bolsista: simNao("bolsa"),
      devedor: simNao("devedor"),
      mensalidadeEmDia: simNao("mensalidade")
    };
  }

  function formatarData(iso){
    if(!iso) return "—";
    var partes = iso.split("-");
    if(partes.length !== 3) return iso;
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  function hojeISO(){
    var d = new Date();
    var m = String(d.getMonth()+1).padStart(2,"0");
    var day = String(d.getDate()).padStart(2,"0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  var toastTimer = null;
  function mostrarToast(msg, tipo){
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (tipo === "erro" ? " danger" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.hidden = true; }, 2800);
  }

  /* ---------------- resultado da API de previsão ---------------- */

  function obterPrevisao(aluno){
    var previsao = aluno && aluno.predicao;
    if(!previsao || typeof previsao !== "object") return null;
    var nivel = previsao.nivel || previsao.risk_level || previsao.riskLevel || null;
    var probabilidade = previsao.probabilidadeEvasao;
    if(probabilidade == null) probabilidade = previsao.dropout_probability;
    if(probabilidade == null) probabilidade = previsao.dropoutProbability;
    probabilidade = probabilidade == null ? null : Number(probabilidade);
    if(probabilidade != null && (!isFinite(probabilidade) || probabilidade < 0 || probabilidade > 1)) probabilidade = null;
    var nivelNormalizado = { LOW:"low", MEDIUM:"mid", MID:"mid", HIGH:"high", low:"low", mid:"mid", high:"high" }[nivel] || null;
    if(!nivelNormalizado && probabilidade == null && typeof previsao.dropoutPrediction !== "boolean") return null;
    return {
      nivel: nivelNormalizado,
      probabilidade: probabilidade,
      evasaoPrevista: typeof previsao.dropoutPrediction === "boolean" ? previsao.dropoutPrediction : null,
      versaoModelo: previsao.modelVersion || previsao.versaoModelo || null,
      geradaEm: previsao.geradaEm || previsao.generated_at || null
    };
  }

  var NIVEL_LABEL = { low: "Risco baixo", mid: "Risco médio", high: "Risco alto" };

  /* ---------------- armazenamento ---------------- */

  function carregarDados(){
    try{
      var alunosSalvos = alunosService.listar();
      if(alunosSalvos){
        state.alunos = atualizarExemplosConhecidos(alunosSalvos);
        if(state.alunos !== alunosSalvos) salvarDados();
        return;
      }
    }catch(err){
      console.error("Erro ao carregar dados", err);
    }
    // primeira vez usando a página (ou dado corrompido/indisponível): começa com exemplos
    state.alunos = gerarAlunosExemplo();
    salvarDados();
  }

  function atualizarExemplosConhecidos(alunos){
    var nomesExemplo = {
      "Fernanda Alves Costa": true,
      "João Pedro Martins": true,
      "Mariana Ribeiro Santos": true,
      "Cauã Victor Camargo": true
    };
    var migrado = false;
    var alunosAtualizados = alunos.map(function(aluno){
      var perfil = dadosIngressoExemplo(aluno.nome);
      if(!nomesExemplo[aluno.nome] || !perfil || aluno.versaoDemo === 3) return aluno;
      migrado = true;
      return Object.assign({}, aluno, perfil);
    });
    return migrado ? alunosAtualizados : alunos;
  }

  function salvarDados(){
    try{
      return alunosService.salvar(state.alunos);
    }catch(err){
      console.error("Erro ao salvar dados", err);
      mostrarToast("Não foi possível salvar as alterações.", "erro");
      return false;
    }
  }

  function gerarAlunosExemplo(){
    return [
      Object.assign({ id: gerarId(), nome:"Fernanda Alves Costa", email:"fernanda.costa@escola.com", dataMatricula:"2024-01-22", frequencia:52, media:4.2, status:"ativo" }, dadosIngressoExemplo("Fernanda Alves Costa")),
      Object.assign({ id: gerarId(), nome:"João Pedro Martins", email:"joao.martins@escola.com", dataMatricula:"2022-03-01", frequencia:68, media:5.5, status:"ativo" }, dadosIngressoExemplo("João Pedro Martins")),
      Object.assign({ id: gerarId(), nome:"Mariana Ribeiro Santos", email:"mariana.santos@escola.com", dataMatricula:"2024-05-06", frequencia:88, media:7.8, status:"ativo" }, dadosIngressoExemplo("Mariana Ribeiro Santos")),
      Object.assign({ id: gerarId(), nome:"Cauã Victor Camargo", email:"caua.camargo@escola.com", dataMatricula:hojeISO(), frequencia:100, media:10.0, status:"ativo" }, dadosIngressoExemplo("Cauã Victor Camargo"))
    ];
  }

  function dadosIngressoExemplo(nome){
    var perfis = {
      "Fernanda Alves Costa": {
        cursoCodigo:1, curso:"Tecnologias de Produção de Biocombustíveis", idadeIngresso:19,
        turnoCodigo:1, turno:"Diurno", ordemCandidatura:1, modoIngressoCodigo:1,
        qualificacaoAnteriorCodigo:1, estadoCivilCodigo:1, bolsista:false, devedor:true, mensalidadeEmDia:false, disciplinasReprovadas:4, versaoDemo:3
      },
      "João Pedro Martins": {
        cursoCodigo:7, curso:"Engenharia Informática", idadeIngresso:24,
        turnoCodigo:0, turno:"Noturno", ordemCandidatura:2, modoIngressoCodigo:39,
        qualificacaoAnteriorCodigo:3, estadoCivilCodigo:2, bolsista:false, devedor:true, mensalidadeEmDia:false, disciplinasReprovadas:2, versaoDemo:3
      },
      "Mariana Ribeiro Santos": {
        cursoCodigo:16, curso:"Educação Básica", idadeIngresso:21,
        turnoCodigo:1, turno:"Diurno", ordemCandidatura:1, modoIngressoCodigo:16,
        qualificacaoAnteriorCodigo:1, estadoCivilCodigo:2, bolsista:true, devedor:false, mensalidadeEmDia:true, disciplinasReprovadas:1, versaoDemo:3
      },
      "Cauã Victor Camargo": {
        cursoCodigo:9, curso:"Gestão", idadeIngresso:18,
        turnoCodigo:1, turno:"Diurno", ordemCandidatura:3, modoIngressoCodigo:1,
        qualificacaoAnteriorCodigo:1, estadoCivilCodigo:1, bolsista:false, devedor:false, mensalidadeEmDia:true, disciplinasReprovadas:0, versaoDemo:3
      }
    };
    return perfis[nome];
  }

  /* ---------------- renderização: lista ---------------- */

  function alunosFiltrados(){
    var q = normalizarTexto(state.query.trim());
    var ativos = state.alunos.filter(function(a){ return a.status === "ativo"; });
    return ativos.filter(function(a){
      var correspondeBusca = !q || normalizarTexto(a.nome).indexOf(q) !== -1 || normalizarTexto(a.curso).indexOf(q) !== -1;
      var previsao = obterPrevisao(a);
      var correspondeRisco = !state.risco || (previsao && previsao.nivel === state.risco);
      var correspondeTurno = !state.turno || (a.turno || "Não informado") === state.turno;
      var correspondeCurso = !state.curso || a.curso === state.curso;
      return correspondeBusca && correspondeRisco && correspondeTurno && correspondeCurso;
    });
  }

  function alunosOrdenados(lista){
    var campo = state.ordenacao.campo;
    if(!campo) return lista;

    var direcao = state.ordenacao.direcao === "asc" ? 1 : -1;
    var ordemRisco = { low: 1, mid: 2, high: 3 };
    return lista.map(function(aluno, indice){ return { aluno: aluno, indice: indice }; }).sort(function(a, b){
      var valorA;
      var valorB;
      if(campo === "nome"){
        valorA = normalizarTexto(a.aluno.nome);
        valorB = normalizarTexto(b.aluno.nome);
      }else if(campo === "dataMatricula"){
        valorA = a.aluno.dataMatricula || "";
        valorB = b.aluno.dataMatricula || "";
      }else if(campo === "frequencia"){
        valorA = a.aluno.frequencia == null ? null : Number(a.aluno.frequencia);
        valorB = b.aluno.frequencia == null ? null : Number(b.aluno.frequencia);
      }else{
        var previsaoA = obterPrevisao(a.aluno);
        var previsaoB = obterPrevisao(b.aluno);
        valorA = previsaoA && previsaoA.nivel ? ordemRisco[previsaoA.nivel] : null;
        valorB = previsaoB && previsaoB.nivel ? ordemRisco[previsaoB.nivel] : null;
      }

      if(valorA == null || valorA === "") return valorB == null || valorB === "" ? a.indice - b.indice : 1;
      if(valorB == null || valorB === "") return -1;
      if(valorA < valorB) return -1 * direcao;
      if(valorA > valorB) return 1 * direcao;
      return a.indice - b.indice;
    }).map(function(item){ return item.aluno; });
  }

  function direcaoInicialOrdenacao(campo){
    return campo === "nome" ? "asc" : "desc";
  }

  function atualizarIndicadoresOrdenacao(){
    document.querySelectorAll(".sort-button").forEach(function(botao){
      var th = botao.closest("th");
      var campo = botao.getAttribute("data-sort");
      var ativo = campo === state.ordenacao.campo;
      var direcao = ativo ? state.ordenacao.direcao : direcaoInicialOrdenacao(campo);
      var indicador = botao.querySelector(".sort-indicator");
      th.setAttribute("aria-sort", ativo ? (state.ordenacao.direcao === "asc" ? "ascending" : "descending") : "none");
      indicador.textContent = ativo ? (state.ordenacao.direcao === "asc" ? "↑" : "↓") : "↕";
      botao.setAttribute("aria-label", "Ordenar por " + botao.firstChild.textContent.trim() + (direcao === "asc" ? ", ordem crescente" : ", ordem decrescente"));
    });
  }

  function renderStats(){
    var ativos = state.alunos.filter(function(a){ return a.status === "ativo"; });
    var counts = { low:0, mid:0, high:0, pendente:0, previstas:0 };
    ativos.forEach(function(a){
      var previsao = obterPrevisao(a);
      if(!previsao){ counts.pendente++; return; }
      counts.previstas++;
      if(counts[previsao.nivel] !== undefined) counts[previsao.nivel]++;
    });

    var el = document.getElementById("stats-row");
    el.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + ativos.length + '</div><div class="stat-label">Alunos ativos</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + counts.previstas + '</div><div class="stat-label">Previsões da API</div></div>' +
      '<div class="stat-card high"><div class="stat-value">' + counts.high + '</div><div class="stat-label">Alto risco retornado</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + counts.pendente + '</div><div class="stat-label">Aguardando API</div></div>';
  }

  function preencherFiltros(){
    var filtroTurno = document.getElementById("filtro-turno");
    var filtroCurso = document.getElementById("filtro-curso");
    var turnosSalvos = state.alunos.map(function(aluno){ return aluno.turno; }).filter(Boolean);
    var turnos = TURNOS_DISPONIVEIS.slice();
    turnosSalvos.forEach(function(turno){ if(turnos.indexOf(turno) === -1) turnos.push(turno); });
    filtroTurno.innerHTML = '<option value="">Todos</option>' +
      '<option value="Não informado">Não informado</option>' +
      turnos.map(function(turno){ return '<option value="' + escapeHtml(turno) + '">' + escapeHtml(turno) + '</option>'; }).join("");
    var cursosSalvos = state.alunos.map(function(aluno){ return aluno.curso; }).filter(Boolean);
    var cursos = CURSOS_DISPONIVEIS.map(function(curso){ return curso.nome; });
    cursosSalvos.forEach(function(curso){ if(cursos.indexOf(curso) === -1) cursos.push(curso); });
    filtroCurso.innerHTML = '<option value="">Todos</option>' + cursos.map(function(curso){
      return '<option value="' + escapeHtml(curso) + '">' + escapeHtml(curso) + '</option>';
    }).join("");
  }

  function renderLista(){
    renderStats();

    var tbody = document.getElementById("students-tbody");
    var emptyState = document.getElementById("empty-state");
    var lista = alunosOrdenados(alunosFiltrados());
    atualizarIndicadoresOrdenacao();
    var totalAtivos = state.alunos.filter(function(a){ return a.status === "ativo"; }).length;

    if(totalAtivos === 0){
      tbody.innerHTML = "";
      document.getElementById("students-table").style.display = "none";
      emptyState.hidden = false;
      return;
    }
    document.getElementById("students-table").style.display = "";
    emptyState.hidden = true;

    if(lista.length === 0){
      tbody.innerHTML = '<tr><td colspan="5" style="padding:32px; text-align:center; color:var(--ink-soft);">Nenhum resultado para essa busca.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map(function(a){
      var previsao = obterPrevisao(a);
      var riscoNivel = previsao && NIVEL_LABEL[previsao.nivel] ? previsao.nivel : "pending";
      var riscoTexto = riscoNivel === "pending" ? "Aguardando API" : NIVEL_LABEL[riscoNivel];
      return (
        '<tr>' +
          '<td class="cell-name" data-label="Aluno">' +
            '<button data-id="' + a.id + '" class="js-abrir-detalhe">' + escapeHtml(a.nome) + '</button>' +
            '<div class="cell-sub">' + escapeHtml(a.curso) + ' &middot; ' + escapeHtml(a.turno || "Turno não informado") + '</div>' +
          '</td>' +
          '<td class="cell-mono" data-label="Matriculado desde">' + formatarData(a.dataMatricula) + '</td>' +
          '<td class="cell-mono" data-label="Frequência">' + (a.frequencia == null ? "—" : a.frequencia + "%") + '</td>' +
          '<td data-label="Previsão da IA"><span class="pill ' + riscoNivel + '">' + riscoTexto + '</span></td>' +
          '<td data-label="Ações">' +
            '<div class="cell-actions">' +
              '<button class="btn-icon js-editar" data-id="' + a.id + '" title="Editar" aria-label="Editar aluno">✎</button>' +
              '<button class="btn-icon js-excluir" data-id="' + a.id + '" title="Excluir" aria-label="Excluir aluno">🗑</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join("");
  }

  /* ---------------- renderização: detalhe ---------------- */

  function abrirDetalhe(id){
    var aluno = state.alunos.find(function(a){ return a.id === id; });
    if(!aluno) return;

    document.getElementById("view-list").hidden = true;
    document.getElementById("view-detail").hidden = false;
    renderDetalhe(aluno);
  }

  function renderDetalhe(aluno){
    var previsao = obterPrevisao(aluno);
    var el = document.getElementById("detail-content");
    var statusPrevisao = previsao && previsao.nivel
      ? NIVEL_LABEL[previsao.nivel]
      : (previsao && previsao.evasaoPrevista === true ? "Evasão prevista" : (previsao && previsao.evasaoPrevista === false ? "Sem evasão prevista" : "Previsão recebida"));
    var probabilidadeTexto = previsao && previsao.probabilidade != null
      ? (previsao.probabilidade * 100).toFixed(1).replace(".", ",") + "% de probabilidade estimada"
      : "A API ainda não retornou uma probabilidade.";
    var previsaoHtml = previsao
      ? '<div class="prediction-result"><span class="pill ' + (previsao.nivel || "pending") + '">' + escapeHtml(statusPrevisao) + '</span><p>' + escapeHtml(probabilidadeTexto) + '</p>' + (previsao.versaoModelo ? '<small>Modelo ' + escapeHtml(previsao.versaoModelo) + '</small>' : '') + (previsao.geradaEm ? '<small>Atualizada em ' + escapeHtml(previsao.geradaEm) + '</small>' : '') + '</div>'
      : '<div class="prediction-pending"><strong>Aguardando previsão</strong><p>A matrícula foi salva. O MVP ainda não está conectado à API de predição.</p></div>';

    el.innerHTML =
      '<div class="detail-grid">' +
        '<div class="card">' +
          '<div class="profile-row">' +
            '<div>' +
              '<p class="profile-name">' + escapeHtml(aluno.nome) + '</p>' +
              '<p class="profile-meta">' + escapeHtml(aluno.curso) + ' &middot; ' + escapeHtml(aluno.turno || "Turno não informado") + ' &middot; matriculado em <strong>' + formatarData(aluno.dataMatricula) + '</strong></p>' +
              '<p class="profile-meta">' + escapeHtml(aluno.email) + '</p>' +
            '</div>' +
          '</div>' +
          '<p class="profile-meta">Idade na matrícula: <strong>' + (aluno.idadeIngresso == null ? "—" : aluno.idadeIngresso) + '</strong></p>' +
          '<p class="profile-meta">Código do curso: <strong>' + (aluno.cursoCodigo == null ? "—" : aluno.cursoCodigo) + '</strong></p>' +
              '<div class="academic-summary"><h3>Acompanhamento acadêmico</h3>' +
                '<p>Frequência <strong>' + (aluno.frequencia == null ? "Pendente" : Number(aluno.frequencia).toFixed(1).replace(".", ",") + "%") + '</strong></p>' +
                '<p>Média <strong>' + (aluno.media == null ? "Pendente" : Number(aluno.media).toFixed(1).replace(".", ",") + " / 10") + '</strong></p>' +
                '<p>Disciplinas reprovadas <strong>' + (aluno.disciplinasReprovadas == null ? "Pendente" : aluno.disciplinasReprovadas) + '</strong></p>' +
              '</div>' +
          '<div class="form-actions" style="justify-content:flex-start; margin-top:24px;">' +
            '<button class="btn btn-secondary js-editar" data-id="' + aluno.id + '">Editar dados</button>' +
            '<button class="btn btn-danger js-excluir" data-id="' + aluno.id + '">Excluir aluno</button>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<h2>Previsão de evasão</h2>' +
          previsaoHtml +
        '</div>' +
      '</div>';
  }

  /* ---------------- modais ---------------- */

  function abrirModal(html){
    elementoComFocoAntesDoModal = document.activeElement;
    document.getElementById("modal-box").innerHTML = html;
    document.getElementById("modal-overlay").hidden = false;
    var primeiroControle = document.querySelector("#modal-box input, #modal-box select, #modal-box button");
    if(primeiroControle) primeiroControle.focus();
  }
  function fecharModal(){
    document.getElementById("modal-overlay").hidden = true;
    document.getElementById("modal-box").innerHTML = "";
    if(elementoComFocoAntesDoModal && document.contains(elementoComFocoAntesDoModal)){
      elementoComFocoAntesDoModal.focus();
    }
    elementoComFocoAntesDoModal = null;
  }

  function abrirModalNovoAluno(){
    abrirModal(
      '<h2 id="modal-title">Matricular aluno</h2>' +
      '<p class="modal-sub">Cadastre os dados de ingresso. Frequência, notas e reprovações são acompanhadas depois do início das aulas.</p>' +
      '<form id="form-novo-aluno">' +
        '<div class="form-grid single">' +
          '<div class="field"><label for="f-nome">Nome completo</label><input id="f-nome" required /></div>' +
          '<div class="field"><label for="f-email">E-mail</label><input id="f-email" type="email" required /></div>' +
        '</div>' +
        renderCamposIngresso("f", null) +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
          '<button type="submit" class="btn btn-primary">Matricular</button>' +
        '</div>' +
      '</form>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("form-novo-aluno").addEventListener("submit", function(e){
      e.preventDefault();
      var ingresso = lerDadosIngresso("f", null);
      var novo = {
        id: gerarId(),
        nome: document.getElementById("f-nome").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        cursoCodigo: ingresso.cursoCodigo,
        curso: ingresso.curso,
        dataMatricula: ingresso.dataMatricula,
        idadeIngresso: ingresso.idadeIngresso,
        turnoCodigo: ingresso.turnoCodigo,
        turno: ingresso.turno,
        ordemCandidatura: ingresso.ordemCandidatura,
        modoIngressoCodigo: ingresso.modoIngressoCodigo,
        qualificacaoAnteriorCodigo: ingresso.qualificacaoAnteriorCodigo,
        estadoCivilCodigo: ingresso.estadoCivilCodigo,
        bolsista: ingresso.bolsista,
        devedor: ingresso.devedor,
        mensalidadeEmDia: ingresso.mensalidadeEmDia,
        frequencia: null,
        media: null,
        disciplinasReprovadas: null,
        predicao: null,
        status: "ativo"
      };
      state.alunos.push(novo);
      if(!salvarDados()){
        state.alunos.pop();
        return;
      }
      renderLista();
      fecharModal();
      mostrarToast("Aluno matriculado com sucesso.");
    });
  }

  function abrirModalEditar(id){
    var aluno = state.alunos.find(function(a){ return a.id === id; });
    if(!aluno) return;

    abrirModal(
      '<h2 id="modal-title">Editar aluno</h2>' +
      '<p class="modal-sub">Atualize os dados cadastrais, de ingresso e os indicadores acadêmicos disponíveis.</p>' +
      '<form id="form-editar-aluno">' +
        '<fieldset class="form-section form-section-first"><legend>Dados cadastrais</legend><div class="form-grid">' +
          '<div class="field"><label for="e-nome">Nome completo</label><input id="e-nome" value="' + escapeHtml(aluno.nome) + '" required /></div>' +
          '<div class="field"><label for="e-email">E-mail</label><input id="e-email" type="email" value="' + escapeHtml(aluno.email) + '" required /></div>' +
        '</div></fieldset>' +
        renderCamposIngresso("e", aluno) +
        renderCamposAcademicos("e", aluno) +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
          '<button type="submit" class="btn btn-primary">Salvar alterações</button>' +
        '</div>' +
      '</form>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("form-editar-aluno").addEventListener("submit", function(e){
      e.preventDefault();
      aluno.nome = document.getElementById("e-nome").value.trim();
      aluno.email = document.getElementById("e-email").value.trim();
      var ingresso = lerDadosIngresso("e", aluno);
      Object.keys(ingresso).forEach(function(chave){ aluno[chave] = ingresso[chave]; });
      var academicos = lerDadosAcademicos("e");
      Object.keys(academicos).forEach(function(chave){ aluno[chave] = academicos[chave]; });
      aluno.predicao = null;

      if(!salvarDados()) return;
      renderLista();
      fecharModal();
      mostrarToast("Dados atualizados.");
      if(!document.getElementById("view-detail").hidden){
        renderDetalhe(aluno);
      }
    });
  }

  function abrirModalExcluir(id){
    var aluno = state.alunos.find(function(a){ return a.id === id; });
    if(!aluno) return;

    abrirModal(
      '<h2 id="modal-title">Excluir cadastro</h2>' +
      '<p class="modal-sub">Tem certeza de que deseja excluir o registro de <strong>' + escapeHtml(aluno.nome) + '</strong>? Essa ação não pode ser desfeita.</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
        '<button type="button" class="btn btn-danger" id="btn-confirmar-excluir">Excluir</button>' +
      '</div>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("btn-confirmar-excluir").addEventListener("click", function(){
      var alunosAnteriores = state.alunos;
      state.alunos = state.alunos.filter(function(a){ return a.id !== id; });
      if(!salvarDados()){
        state.alunos = alunosAnteriores;
        return;
      }
      fecharModal();
      mostrarToast("Aluno excluído.");
      document.getElementById("view-detail").hidden = true;
      document.getElementById("view-list").hidden = false;
      renderLista();
    });
  }

  /* ---------------- eventos globais ---------------- */

  document.getElementById("btn-new-student").addEventListener("click", abrirModalNovoAluno);
  document.getElementById("btn-empty-new").addEventListener("click", abrirModalNovoAluno);

  document.getElementById("btn-back").addEventListener("click", function(){
    document.getElementById("view-detail").hidden = true;
    document.getElementById("view-list").hidden = false;
    renderLista();
  });

  document.getElementById("search-input").addEventListener("input", function(e){
    state.query = e.target.value;
    renderLista();
  });

  document.getElementById("filtro-risco").addEventListener("change", function(e){
    state.risco = e.target.value;
    renderLista();
  });
  document.getElementById("filtro-turno").addEventListener("change", function(e){
    state.turno = e.target.value;
    renderLista();
  });
  document.getElementById("filtro-curso").addEventListener("change", function(e){
    state.curso = e.target.value;
    renderLista();
  });
  document.getElementById("btn-limpar-filtros").addEventListener("click", function(){
    state.query = "";
    state.risco = "";
    state.turno = "";
    state.curso = "";
    document.getElementById("search-input").value = "";
    document.getElementById("filtro-risco").value = "";
    document.getElementById("filtro-turno").value = "";
    document.getElementById("filtro-curso").value = "";
    renderLista();
  });

  document.querySelectorAll(".sort-button").forEach(function(botao){
    botao.addEventListener("click", function(){
      var campo = botao.getAttribute("data-sort");
      state.ordenacao.direcao = state.ordenacao.campo === campo
        ? (state.ordenacao.direcao === "asc" ? "desc" : "asc")
        : direcaoInicialOrdenacao(campo);
      state.ordenacao.campo = campo;
      renderLista();
    });
  });

  document.getElementById("modal-overlay").addEventListener("click", function(e){
    if(e.target.id === "modal-overlay") fecharModal();
  });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && !document.getElementById("modal-overlay").hidden) fecharModal();
  });

  document.addEventListener("click", function(e){
    var abrir = e.target.closest(".js-abrir-detalhe");
    if(abrir){ abrirDetalhe(abrir.getAttribute("data-id")); return; }

    var editar = e.target.closest(".js-editar");
    if(editar){ abrirModalEditar(editar.getAttribute("data-id")); return; }

    var excluir = e.target.closest(".js-excluir");
    if(excluir){ abrirModalExcluir(excluir.getAttribute("data-id")); return; }
  });

  /* ---------------- inicialização ---------------- */

  carregarDados();
  preencherFiltros();
  state.loaded = true;
  renderLista();

})();
