(function(){
  "use strict";

  var CURSOS_DISPONIVEIS = [
    "Administração", "Análise e Desenvolvimento de Sistemas",
    "Arquitetura e Urbanismo", "Ciência da Computação", "Design Gráfico", "Direito",
    "Enfermagem", "Engenharia Ambiental", "Engenharia Civil",
    "Engenharia de Computação", "Engenharia de Produção", "Engenharia de Software",
    "Engenharia Elétrica", "Engenharia Mecânica", "Engenharia Química", "Marketing",
    "Pedagogia", "Psicologia", "Sistemas de Informação"
  ];
  var TURNOS_DISPONIVEIS = ["Manhã", "Tarde", "Noite", "Integral"];

  var STORAGE_KEY = "alunos-data";
  var state = { alunos: [], loaded: false, query: "", risco: "", turno: "", curso: "" };
  var limparAutocompleteAtual = null;
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

  function ativarAutocompleteCurso(inputId, listaId){
    if(limparAutocompleteAtual) limparAutocompleteAtual();

    var input = document.getElementById(inputId);
    var lista = document.getElementById(listaId);
    var indiceAtivo = -1;

    function renderizarSugestoes(){
      var termo = normalizarTexto(input.value.trim());
      var cursos = CURSOS_DISPONIVEIS.filter(function(curso){
        return !termo || normalizarTexto(curso).indexOf(termo) !== -1;
      });

      if(!cursos.length){
        lista.innerHTML = '<li class="sem-resultado">Nenhum curso encontrado — o texto digitado será mantido.</li>';
      }else{
        lista.innerHTML = cursos.map(function(curso, index){
          return '<li id="' + listaId + '-opcao-' + index + '" role="option" data-valor="' + escapeHtml(curso) + '">' + escapeHtml(curso) + '</li>';
        }).join("");
      }

      indiceAtivo = -1;
      lista.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function fecharSugestoes(){
      lista.hidden = true;
      indiceAtivo = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function confirmarSugestao(){
      var sugestoes = lista.querySelectorAll("li[data-valor]");
      if(indiceAtivo < 0 || !sugestoes[indiceAtivo]) return;
      input.value = sugestoes[indiceAtivo].getAttribute("data-valor");
      fecharSugestoes();
    }

    input.addEventListener("focus", function(){
      if(!input.value.trim()) renderizarSugestoes();
    });
    input.addEventListener("input", renderizarSugestoes);
    input.addEventListener("keydown", function(e){
      var sugestoes = lista.querySelectorAll("li[data-valor]");
      if(e.key === "ArrowDown" || e.key === "ArrowUp"){
        if(lista.hidden || !sugestoes.length) return;
        e.preventDefault();
        indiceAtivo = e.key === "ArrowDown"
          ? (indiceAtivo + 1) % sugestoes.length
          : (indiceAtivo - 1 + sugestoes.length) % sugestoes.length;
        Array.prototype.forEach.call(sugestoes, function(item, index){
          item.classList.toggle("ativo", index === indiceAtivo);
          item.setAttribute("aria-selected", index === indiceAtivo ? "true" : "false");
        });
        input.setAttribute("aria-activedescendant", sugestoes[indiceAtivo].id);
      }else if(e.key === "Enter" && !lista.hidden){
        e.preventDefault();
        confirmarSugestao();
      }else if(e.key === "Escape"){
        fecharSugestoes();
      }
    });
    lista.addEventListener("click", function(e){
      var sugestao = e.target.closest("li[data-valor]");
      if(!sugestao) return;
      input.value = sugestao.getAttribute("data-valor");
      fecharSugestoes();
    });
    function fecharAoClicarFora(e){
      if(e.target !== input && !lista.contains(e.target)) fecharSugestoes();
    }
    document.addEventListener("click", fecharAoClicarFora);
    limparAutocompleteAtual = function(){
      document.removeEventListener("click", fecharAoClicarFora);
      limparAutocompleteAtual = null;
    };
  }

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

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

  /* ---------------- cálculo de risco ---------------- */

  function calcularRisco(aluno){
    var freq = Number(aluno.frequencia);
    var media = Number(aluno.media);
    var diasAtraso = aluno.situacaoPagamento === "atrasado" ? Number(aluno.diasAtraso || 0) : 0;

    var riscoFrequencia = clamp((90 - freq) * 2.5, 0, 100);
    var riscoNotas = clamp((6 - media) * 25, 0, 100);
    var riscoPagamento = clamp((diasAtraso / 60) * 100, 0, 100);

    var score = Math.round(riscoFrequencia * 0.40 + riscoNotas * 0.35 + riscoPagamento * 0.25);

    var nivel = score < 33 ? "low" : (score < 67 ? "mid" : "high");

    return {
      score: score,
      nivel: nivel,
      fatores: {
        frequencia: { valor: freq, risco: Math.round(riscoFrequencia) },
        notas: { valor: media, risco: Math.round(riscoNotas) },
        pagamento: { valor: diasAtraso, risco: Math.round(riscoPagamento) }
      }
    };
  }

  var NIVEL_LABEL = { low: "Risco baixo", mid: "Risco médio", high: "Risco alto" };
  var STAMP_LABEL = { low: "Baixo risco", mid: "Risco médio", high: "Alto risco" };

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
      "Ana Beatriz Lima": true,
      "Carlos Eduardo Souza": true,
      "Fernanda Alves Costa": true,
      "João Pedro Martins": true,
      "Mariana Ribeiro Santos": true,
      "Cauã Victor Camargo": true
    };
    var conjuntoDeExemplos = alunos.length > 0 && alunos.every(function(aluno){
      return nomesExemplo[aluno.nome];
    });
    var exemplosDesatualizados = alunos.some(function(aluno){
      return !aluno.turno || aluno.turno === "Não informado";
    });
    return conjuntoDeExemplos && exemplosDesatualizados ? gerarAlunosExemplo() : alunos;
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
      { id: gerarId(), nome:"Fernanda Alves Costa", email:"fernanda.costa@escola.com", curso:"Design Gráfico", turno:"Tarde", dataMatricula:"2024-01-22", frequencia:52, media:4.2, situacaoPagamento:"atrasado", diasAtraso:45, status:"ativo" },
      { id: gerarId(), nome:"João Pedro Martins", email:"joao.martins@escola.com", curso:"Ciência da Computação", turno:"Noite", dataMatricula:"2022-03-01", frequencia:68, media:5.5, situacaoPagamento:"atrasado", diasAtraso:20, status:"ativo" },
      { id: gerarId(), nome:"Mariana Ribeiro Santos", email:"mariana.santos@escola.com", curso:"Pedagogia", turno:"Integral", dataMatricula:"2024-05-06", frequencia:88, media:7.8, situacaoPagamento:"em_dia", diasAtraso:0, status:"ativo" },
      { id: gerarId(), nome:"Cauã Victor Camargo", email:"caua.camargo@escola.com", curso:"Administração", turno:"Manhã", dataMatricula:hojeISO(), frequencia:100, media:10.0, situacaoPagamento:"em_dia", diasAtraso:0, status:"ativo" }
    ];
  }

  /* ---------------- renderização: lista ---------------- */

  function alunosFiltrados(){
    var q = normalizarTexto(state.query.trim());
    var ativos = state.alunos.filter(function(a){ return a.status === "ativo"; });
    return ativos.filter(function(a){
      var correspondeBusca = !q || normalizarTexto(a.nome).indexOf(q) !== -1 || normalizarTexto(a.curso).indexOf(q) !== -1;
      var correspondeRisco = !state.risco || calcularRisco(a).nivel === state.risco;
      var correspondeTurno = !state.turno || (a.turno || "Não informado") === state.turno;
      var correspondeCurso = !state.curso || a.curso === state.curso;
      return correspondeBusca && correspondeRisco && correspondeTurno && correspondeCurso;
    });
  }

  function renderStats(){
    var ativos = state.alunos.filter(function(a){ return a.status === "ativo"; });
    var counts = { low:0, mid:0, high:0 };
    ativos.forEach(function(a){ counts[calcularRisco(a).nivel]++; });

    var el = document.getElementById("stats-row");
    el.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + ativos.length + '</div><div class="stat-label">Alunos ativos</div></div>' +
      '<div class="stat-card low"><div class="stat-value">' + counts.low + '</div><div class="stat-label">Risco baixo</div></div>' +
      '<div class="stat-card mid"><div class="stat-value">' + counts.mid + '</div><div class="stat-label">Risco médio</div></div>' +
      '<div class="stat-card high"><div class="stat-value">' + counts.high + '</div><div class="stat-label">Risco alto</div></div>';
  }

  function preencherFiltros(){
    var filtroTurno = document.getElementById("filtro-turno");
    var filtroCurso = document.getElementById("filtro-curso");
    filtroTurno.innerHTML = '<option value="">Todos</option>' +
      '<option value="Não informado">Não informado</option>' +
      TURNOS_DISPONIVEIS.map(function(turno){ return '<option value="' + escapeHtml(turno) + '">' + escapeHtml(turno) + '</option>'; }).join("");
    filtroCurso.innerHTML = '<option value="">Todos</option>' + CURSOS_DISPONIVEIS.map(function(curso){
      return '<option value="' + escapeHtml(curso) + '">' + escapeHtml(curso) + '</option>';
    }).join("");
  }

  function renderLista(){
    renderStats();

    var tbody = document.getElementById("students-tbody");
    var emptyState = document.getElementById("empty-state");
    var lista = alunosFiltrados();
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
      var risco = calcularRisco(a);
      return (
        '<tr>' +
          '<td class="cell-name" data-label="Aluno">' +
            '<button data-id="' + a.id + '" class="js-abrir-detalhe">' + escapeHtml(a.nome) + '</button>' +
            '<div class="cell-sub">' + escapeHtml(a.curso) + ' &middot; ' + escapeHtml(a.turno || "Turno não informado") + '</div>' +
          '</td>' +
          '<td class="cell-mono" data-label="Matriculado desde">' + formatarData(a.dataMatricula) + '</td>' +
          '<td class="cell-mono" data-label="Frequência">' + a.frequencia + '%</td>' +
          '<td data-label="Risco de evasão"><span class="pill ' + risco.nivel + '">' + NIVEL_LABEL[risco.nivel] + '</span></td>' +
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
    var risco = calcularRisco(aluno);
    var el = document.getElementById("detail-content");

    var pagamentoTexto = aluno.situacaoPagamento === "atrasado"
      ? ("Atrasado (" + aluno.diasAtraso + " dias)")
      : "Em dia";

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
          '<div class="factor">' +
            '<div class="factor-head"><span class="label">Frequência</span><span class="value">' + aluno.frequencia + '%</span></div>' +
            '<div class="meter"><div class="meter-fill" style="width:' + aluno.frequencia + '%; background:var(--accent);"></div></div>' +
          '</div>' +
          '<div class="factor">' +
            '<div class="factor-head"><span class="label">Média de notas</span><span class="value">' + Number(aluno.media).toFixed(1) + ' / 10</span></div>' +
            '<div class="meter"><div class="meter-fill" style="width:' + (Number(aluno.media)*10) + '%; background:var(--accent);"></div></div>' +
          '</div>' +
          '<div class="factor">' +
            '<div class="factor-head"><span class="label">Pagamento</span><span class="value">' + pagamentoTexto + '</span></div>' +
            '<div class="meter"><div class="meter-fill" style="width:' + (aluno.situacaoPagamento === "atrasado" ? clamp(aluno.diasAtraso/60*100,8,100) : 4) + '%; background:' + (aluno.situacaoPagamento === "atrasado" ? "var(--risk-high)" : "var(--risk-low)") + ';"></div></div>' +
          '</div>' +
          '<div class="form-actions" style="justify-content:flex-start; margin-top:24px;">' +
            '<button class="btn btn-secondary js-editar" data-id="' + aluno.id + '">Editar dados</button>' +
            '<button class="btn btn-danger js-excluir" data-id="' + aluno.id + '">Excluir aluno</button>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<h2>Previsão de evasão</h2>' +
          '<div class="stamp-wrap">' +
            '<div class="stamp ' + risco.nivel + '">' +
              '<span class="stamp-eyebrow">Estimativa</span>' +
              '<span class="stamp-title">' + STAMP_LABEL[risco.nivel] + '</span>' +
              '<span class="stamp-score">índice ' + risco.score + '/100</span>' +
            '</div>' +
            '<p class="stamp-caption">Estimativa heurística com base em frequência, notas e situação de pagamento — não é uma garantia.</p>' +
          '</div>' +
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
    if(limparAutocompleteAtual) limparAutocompleteAtual();
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
      '<p class="modal-sub">Dados cadastrais do novo aluno. Os indicadores de frequência e desempenho podem ser atualizados depois, na ficha do aluno.</p>' +
      '<form id="form-novo-aluno">' +
        '<div class="form-grid single">' +
          '<div class="field"><label for="f-nome">Nome completo</label><input id="f-nome" required /></div>' +
          '<div class="field"><label for="f-email">E-mail</label><input id="f-email" type="email" required /></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field">' +
            '<label for="f-curso">Curso</label>' +
            '<div class="autocomplete-wrap">' +
              '<input id="f-curso" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="f-curso-sugestoes" aria-expanded="false" required />' +
              '<ul id="f-curso-sugestoes" class="autocomplete-list" role="listbox" hidden></ul>' +
            '</div>' +
            '<span class="field-hint">Digite para buscar ou registre um curso novo.</span>' +
          '</div>' +
          '<div class="field"><label for="f-data">Data de matrícula</label><input id="f-data" type="date" value="' + hojeISO() + '" required /></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field"><label for="f-turno">Turno</label><select id="f-turno" required>' +
            '<option value="">Selecione o turno</option>' +
            TURNOS_DISPONIVEIS.map(function(turno){ return '<option value="' + escapeHtml(turno) + '">' + escapeHtml(turno) + '</option>'; }).join("") +
          '</select></div>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
          '<button type="submit" class="btn btn-primary">Matricular</button>' +
        '</div>' +
      '</form>'
    );

    ativarAutocompleteCurso("f-curso", "f-curso-sugestoes");
    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("form-novo-aluno").addEventListener("submit", function(e){
      e.preventDefault();
      var novo = {
        id: gerarId(),
        nome: document.getElementById("f-nome").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        curso: document.getElementById("f-curso").value.trim(),
        dataMatricula: document.getElementById("f-data").value,
        turno: document.getElementById("f-turno").value,
        frequencia: 100,
        media: 10,
        situacaoPagamento: "em_dia",
        diasAtraso: 0,
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
      '<p class="modal-sub">Atualize os dados cadastrais e os indicadores usados na estimativa de risco.</p>' +
      '<form id="form-editar-aluno">' +
        '<div class="form-grid single">' +
          '<div class="field"><label for="e-nome">Nome completo</label><input id="e-nome" value="' + escapeHtml(aluno.nome) + '" required /></div>' +
          '<div class="field"><label for="e-email">E-mail</label><input id="e-email" type="email" value="' + escapeHtml(aluno.email) + '" required /></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field">' +
            '<label for="e-curso">Curso</label>' +
            '<div class="autocomplete-wrap">' +
              '<input id="e-curso" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="e-curso-sugestoes" aria-expanded="false" value="' + escapeHtml(aluno.curso) + '" required />' +
              '<ul id="e-curso-sugestoes" class="autocomplete-list" role="listbox" hidden></ul>' +
            '</div>' +
            '<span class="field-hint">Digite para buscar ou registre um curso novo.</span>' +
          '</div>' +
          '<div class="field"><label for="e-data">Data de matrícula</label><input id="e-data" type="date" value="' + aluno.dataMatricula + '" required /></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field"><label for="e-turno">Turno</label><select id="e-turno" required>' +
            '<option value="">Selecione o turno</option>' +
            (!aluno.turno ? '<option value="Não informado" selected>Não informado</option>' : '') +
            TURNOS_DISPONIVEIS.map(function(turno){ return '<option value="' + escapeHtml(turno) + '"' + (aluno.turno === turno ? " selected" : "") + '>' + escapeHtml(turno) + '</option>'; }).join("") +
          '</select></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field"><label for="e-freq">Frequência (%)</label><input id="e-freq" type="number" min="0" max="100" value="' + aluno.frequencia + '" required /></div>' +
          '<div class="field"><label for="e-media">Média de notas (0–10)</label><input id="e-media" type="number" min="0" max="10" step="0.1" value="' + aluno.media + '" required /></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field"><label for="e-pagamento">Situação de pagamento</label>' +
            '<select id="e-pagamento">' +
              '<option value="em_dia"' + (aluno.situacaoPagamento === "em_dia" ? " selected" : "") + '>Em dia</option>' +
              '<option value="atrasado"' + (aluno.situacaoPagamento === "atrasado" ? " selected" : "") + '>Atrasado</option>' +
            '</select>' +
          '</div>' +
          '<div class="field"><label for="e-dias">Dias de atraso</label><input id="e-dias" type="number" min="0" value="' + (aluno.diasAtraso || 0) + '" /></div>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
          '<button type="submit" class="btn btn-primary">Salvar alterações</button>' +
        '</div>' +
      '</form>'
    );

    ativarAutocompleteCurso("e-curso", "e-curso-sugestoes");
    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("form-editar-aluno").addEventListener("submit", function(e){
      e.preventDefault();
      aluno.nome = document.getElementById("e-nome").value.trim();
      aluno.email = document.getElementById("e-email").value.trim();
      aluno.curso = document.getElementById("e-curso").value.trim();
      aluno.dataMatricula = document.getElementById("e-data").value;
      aluno.turno = document.getElementById("e-turno").value;
      aluno.frequencia = clamp(Number(document.getElementById("e-freq").value), 0, 100);
      aluno.media = clamp(Number(document.getElementById("e-media").value), 0, 10);
      aluno.situacaoPagamento = document.getElementById("e-pagamento").value;
      aluno.diasAtraso = Number(document.getElementById("e-dias").value) || 0;

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
