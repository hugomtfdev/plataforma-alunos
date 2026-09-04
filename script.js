(function(){
  "use strict";

  var STORAGE_KEY = "alunos-data";
  var state = { alunos: [], loaded: false, query: "" };

  /* ---------------- utilidades ---------------- */

  function gerarId(){
    return "al_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8);
  }

  function escapeHtml(str){
    return String(str == null ? "" : str).replace(/[&<>"']/g, function(c){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
    });
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
      var raw = localStorage.getItem(STORAGE_KEY);
      if(raw){
        state.alunos = JSON.parse(raw);
        return;
      }
    }catch(err){
      console.error("Erro ao carregar dados", err);
    }
    // primeira vez usando a página (ou dado corrompido/indisponível): começa com exemplos
    state.alunos = gerarAlunosExemplo();
    salvarDados();
  }

  function salvarDados(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.alunos));
      return true;
    }catch(err){
      console.error("Erro ao salvar dados", err);
      mostrarToast("Não foi possível salvar as alterações.", "erro");
      return false;
    }
  }

  function gerarAlunosExemplo(){
    return [
      { id: gerarId(), nome:"Ana Beatriz Lima", email:"ana.lima@escola.com", curso:"Engenharia de Software", dataMatricula:"2024-02-10", frequencia:95, media:8.4, situacaoPagamento:"em_dia", diasAtraso:0, status:"ativo" },
      { id: gerarId(), nome:"Carlos Eduardo Souza", email:"carlos.souza@escola.com", curso:"Administração", dataMatricula:"2023-08-15", frequencia:68, media:5.5, situacaoPagamento:"atrasado", diasAtraso:20, status:"ativo" },
      { id: gerarId(), nome:"Fernanda Alves Costa", email:"fernanda.costa@escola.com", curso:"Design Gráfico", dataMatricula:"2024-01-22", frequencia:52, media:4.2, situacaoPagamento:"atrasado", diasAtraso:45, status:"ativo" },
      { id: gerarId(), nome:"João Pedro Martins", email:"joao.martins@escola.com", curso:"Ciência da Computação", dataMatricula:"2022-03-01", frequencia:88, media:7.0, situacaoPagamento:"em_dia", diasAtraso:0, status:"ativo" },
      { id: gerarId(), nome:"Mariana Ribeiro Santos", email:"mariana.santos@escola.com", curso:"Pedagogia", dataMatricula:"2024-05-06", frequencia:74, media:6.0, situacaoPagamento:"atrasado", diasAtraso:10, status:"ativo" }
    ];
  }

  /* ---------------- renderização: lista ---------------- */

  function alunosFiltrados(){
    var q = state.query.trim().toLowerCase();
    var ativos = state.alunos.filter(function(a){ return a.status === "ativo"; });
    if(!q) return ativos;
    return ativos.filter(function(a){
      return a.nome.toLowerCase().indexOf(q) !== -1 || a.curso.toLowerCase().indexOf(q) !== -1;
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
          '<td class="cell-name">' +
            '<button data-id="' + a.id + '" class="js-abrir-detalhe">' + escapeHtml(a.nome) + '</button>' +
            '<div class="cell-sub">' + escapeHtml(a.curso) + '</div>' +
          '</td>' +
          '<td class="cell-mono">' + formatarData(a.dataMatricula) + '</td>' +
          '<td class="cell-mono">' + a.frequencia + '%</td>' +
          '<td><span class="pill ' + risco.nivel + '">' + NIVEL_LABEL[risco.nivel] + '</span></td>' +
          '<td>' +
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
              '<p class="profile-meta">' + escapeHtml(aluno.curso) + ' &middot; matriculado em <strong>' + formatarData(aluno.dataMatricula) + '</strong></p>' +
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
    document.getElementById("modal-box").innerHTML = html;
    document.getElementById("modal-overlay").hidden = false;
  }
  function fecharModal(){
    document.getElementById("modal-overlay").hidden = true;
    document.getElementById("modal-box").innerHTML = "";
  }

  function abrirModalNovoAluno(){
    abrirModal(
      '<h2>Matricular aluno</h2>' +
      '<p class="modal-sub">Dados cadastrais do novo aluno. Os indicadores de frequência e desempenho podem ser atualizados depois, na ficha do aluno.</p>' +
      '<form id="form-novo-aluno">' +
        '<div class="form-grid single">' +
          '<div class="field"><label for="f-nome">Nome completo</label><input id="f-nome" required /></div>' +
          '<div class="field"><label for="f-email">E-mail</label><input id="f-email" type="email" required /></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field"><label for="f-curso">Curso</label><input id="f-curso" required /></div>' +
          '<div class="field"><label for="f-data">Data de matrícula</label><input id="f-data" type="date" value="' + hojeISO() + '" required /></div>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
          '<button type="submit" class="btn btn-primary">Matricular</button>' +
        '</div>' +
      '</form>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("form-novo-aluno").addEventListener("submit", function(e){
      e.preventDefault();
      var novo = {
        id: gerarId(),
        nome: document.getElementById("f-nome").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        curso: document.getElementById("f-curso").value.trim(),
        dataMatricula: document.getElementById("f-data").value,
        frequencia: 100,
        media: 10,
        situacaoPagamento: "em_dia",
        diasAtraso: 0,
        status: "ativo"
      };
      state.alunos.push(novo);
      salvarDados();
      renderLista();
      fecharModal();
      mostrarToast("Aluno matriculado com sucesso.");
    });
  }

  function abrirModalEditar(id){
    var aluno = state.alunos.find(function(a){ return a.id === id; });
    if(!aluno) return;

    abrirModal(
      '<h2>Editar aluno</h2>' +
      '<p class="modal-sub">Atualize os dados cadastrais e os indicadores usados na estimativa de risco.</p>' +
      '<form id="form-editar-aluno">' +
        '<div class="form-grid single">' +
          '<div class="field"><label for="e-nome">Nome completo</label><input id="e-nome" value="' + escapeHtml(aluno.nome) + '" required /></div>' +
          '<div class="field"><label for="e-email">E-mail</label><input id="e-email" type="email" value="' + escapeHtml(aluno.email) + '" required /></div>' +
        '</div>' +
        '<div class="form-grid" style="margin-top:14px;">' +
          '<div class="field"><label for="e-curso">Curso</label><input id="e-curso" value="' + escapeHtml(aluno.curso) + '" required /></div>' +
          '<div class="field"><label for="e-data">Data de matrícula</label><input id="e-data" type="date" value="' + aluno.dataMatricula + '" required /></div>' +
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

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("form-editar-aluno").addEventListener("submit", function(e){
      e.preventDefault();
      aluno.nome = document.getElementById("e-nome").value.trim();
      aluno.email = document.getElementById("e-email").value.trim();
      aluno.curso = document.getElementById("e-curso").value.trim();
      aluno.dataMatricula = document.getElementById("e-data").value;
      aluno.frequencia = clamp(Number(document.getElementById("e-freq").value), 0, 100);
      aluno.media = clamp(Number(document.getElementById("e-media").value), 0, 10);
      aluno.situacaoPagamento = document.getElementById("e-pagamento").value;
      aluno.diasAtraso = Number(document.getElementById("e-dias").value) || 0;

      salvarDados();
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
      '<h2>Excluir cadastro</h2>' +
      '<p class="modal-sub">Tem certeza de que deseja excluir o registro de <strong>' + escapeHtml(aluno.nome) + '</strong>? Essa ação não pode ser desfeita.</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
        '<button type="button" class="btn btn-danger" id="btn-confirmar-excluir">Excluir</button>' +
      '</div>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("btn-confirmar-excluir").addEventListener("click", function(){
      state.alunos = state.alunos.filter(function(a){ return a.id !== id; });
      salvarDados();
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
  state.loaded = true;
  renderLista();

})();
