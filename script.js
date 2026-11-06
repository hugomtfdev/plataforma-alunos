(function () {
  "use strict";

  /* ---------------- configuração da API de predição ---------------- */

  // Em HTTPS (Vercel), utiliza a rota relativa /api/v1/predictions mapeada pelo vercel.json.
  var EM_HTTPS = typeof window !== "undefined" && window.location && window.location.protocol === "https:";
  var API_BASE_URL = EM_HTTPS ? "/api/v1/predictions" : "http://52.67.241.122:8080/api/v1/predictions";
  var API_CONFIG_KEY = "config-api";

  function normalizarUrlConfig(urlRaw) {
    var u = (typeof urlRaw === "string" && urlRaw.trim()) ? urlRaw.trim() : API_BASE_URL;
    // Corrige automaticamente URL antiga sem porta que batia na porta 80
    if (u === "http://52.67.241.122/api/v1/predictions") {
      u = EM_HTTPS ? "/api/v1/predictions" : "http://52.67.241.122:8080/api/v1/predictions";
    }
    if (EM_HTTPS && /^http:\/\/52\.67\.241\.122(:\d+)?\/api\//i.test(u)) {
      u = u.replace(/^http:\/\/52\.67\.241\.122(:\d+)?/i, "");
    }
    return u;
  }
  var API_TIMEOUT_MS = 20000;
  var VERSAO_DADOS = 5;
  var LEGENDA_MODELO = "Predição do modelo (Regressão Logística, acurácia 86,67%) — estimativa estatística, não certeza.";

  var CURSOS_DISPONIVEIS = CATALOGOS.course.map(function (curso) {
    return { codigo: curso.codigo, nome: curso.rotulo };
  });
  var TURNOS_DISPONIVEIS = ["Diurno", "Noturno"];

  /* ---------------- esquema único dos 34 campos do modelo ---------------- */

  // Cada item descreve um campo: chave (nome snake_case da API), rotulo, tipo
  // ("catalogo" = código UCI convertido no envio; "opcao" = valor direto de lista fixa;
  // "inteiro"; "decimal"), grupo, min/max e opcoes. O formulário, a validação e o payload
  // são todos gerados a partir desta lista. O campo "course" fica no cadastro
  // (aluno.cursoCodigo); os demais ficam em aluno.dadosPredicao[chave].
  var GRUPOS_PREDICAO = ["Perfil", "Família", "Financeiro", "1º semestre", "2º semestre", "Macroeconômicos"];

  function definirCampo(chave, rotulo, tipo, grupo, extra) {
    var campo = { chave: chave, rotulo: rotulo, tipo: tipo, grupo: grupo, min: null, max: null, opcoes: null, cadastro: false };
    Object.keys(extra || {}).forEach(function (k) { campo[k] = extra[k]; });
    if (tipo === "catalogo" && !campo.opcoes) campo.opcoes = CATALOGOS[chave];
    if (tipo === "inteiro" && campo.min == null) { campo.min = 0; campo.max = 60; }
    return campo;
  }

  var CAMPOS_PREDICAO = [
    definirCampo("marital_status", "Estado civil", "opcao", "Perfil", { opcoes: OPCOES_SIMPLES.marital_status }),
    definirCampo("application_mode", "Modo de candidatura", "catalogo", "Perfil"),
    definirCampo("application_order", "Ordem da candidatura (0 = 1ª escolha … 9)", "inteiro", "Perfil", { min: 0, max: 9 }),
    definirCampo("course", "Curso", "catalogo", "Perfil", { cadastro: true }),
    definirCampo("daytime_evening_attendance", "Período do curso", "opcao", "Perfil", { opcoes: OPCOES_SIMPLES.turno }),
    definirCampo("previous_qualification", "Escolaridade anterior", "catalogo", "Perfil"),
    definirCampo("nationality", "Nacionalidade", "catalogo", "Perfil"),
    definirCampo("age_at_enrollment", "Idade na matrícula", "inteiro", "Perfil", { min: 16, max: 100 }),
    definirCampo("gender", "Gênero", "opcao", "Perfil", { opcoes: OPCOES_SIMPLES.genero }),
    definirCampo("international", "Estudante internacional", "opcao", "Perfil", { opcoes: OPCOES_SIMPLES.sim_nao }),

    definirCampo("mothers_qualification", "Escolaridade da mãe", "catalogo", "Família"),
    definirCampo("fathers_qualification", "Escolaridade do pai", "catalogo", "Família"),
    definirCampo("mothers_occupation", "Ocupação da mãe", "catalogo", "Família"),
    definirCampo("fathers_occupation", "Ocupação do pai", "catalogo", "Família"),
    definirCampo("displaced", "Deslocado da residência de origem", "opcao", "Família", { opcoes: OPCOES_SIMPLES.sim_nao }),
    definirCampo("educational_special_needs", "Necessidades educacionais especiais", "opcao", "Família", { opcoes: OPCOES_SIMPLES.sim_nao }),

    definirCampo("debtor", "Possui dívida", "opcao", "Financeiro", { opcoes: OPCOES_SIMPLES.sim_nao }),
    definirCampo("tuition_fees_up_to_date", "Mensalidades em dia", "opcao", "Financeiro", { opcoes: OPCOES_SIMPLES.sim_nao }),
    definirCampo("scholarship_holder", "Bolsista", "opcao", "Financeiro", { opcoes: OPCOES_SIMPLES.sim_nao })
  ];

  ["1st", "2nd"].forEach(function (sem) {
    var grupo = sem === "1st" ? "1º semestre" : "2º semestre";
    var prefixo = "curricular_units_" + sem + "_sem_";
    CAMPOS_PREDICAO.push(
      definirCampo(prefixo + "credited", "Disciplinas creditadas", "inteiro", grupo),
      definirCampo(prefixo + "enrolled", "Disciplinas matriculadas", "inteiro", grupo),
      definirCampo(prefixo + "evaluations", "Avaliações realizadas", "inteiro", grupo),
      definirCampo(prefixo + "approved", "Disciplinas aprovadas", "inteiro", grupo),
      definirCampo(prefixo + "grade", "Nota média ponderada (0–20)", "decimal", grupo, { min: 0, max: 20 }),
      definirCampo(prefixo + "without_evaluations", "Disciplinas sem avaliação", "inteiro", grupo)
    );
  });

  CAMPOS_PREDICAO.push(
    definirCampo("unemployment_rate", "Taxa de desemprego (%)", "decimal", "Macroeconômicos", { min: 0, max: 30, global: true }),
    definirCampo("inflation_rate", "Taxa de inflação (%)", "decimal", "Macroeconômicos", { min: -5, max: 15, global: true }),
    definirCampo("gdp", "Variação do PIB (%)", "decimal", "Macroeconômicos", { min: -15, max: 15, global: true })
  );

  var STORAGE_KEY = "alunos-data";
  var state = {
    alunos: [], loaded: false, query: "", risco: "", turno: "", curso: "", ordenacao: { campo: null, direcao: "asc" },
    predicoes: {},
    api: { status: "desconhecido", detalhe: null },
    apiConfig: { url: API_BASE_URL, token: "" },
    macro: null,
    lote: { status: "ocioso", erro: null, seq: 0 },
    detalhe: null,
    erroArmazenamento: null
  };

  function limparTokenBearer(rawToken) {
    if (typeof rawToken !== "string") return "";
    return rawToken
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/^Bearer\s+/i, "")
      .trim();
  }

  var apiConfigService = {
    carregar: function () {
      try {
        var raw = localStorage.getItem(API_CONFIG_KEY);
        if (!raw) return { url: API_BASE_URL, token: "" };
        var parsed = JSON.parse(raw);
        var carregado = {
          url: normalizarUrlConfig(parsed && parsed.url),
          token: limparTokenBearer(parsed && parsed.token)
        };
        localStorage.setItem(API_CONFIG_KEY, JSON.stringify(carregado));
        return carregado;
      } catch (err) {
        return { url: API_BASE_URL, token: "" };
      }
    },
    salvar: function (config) {
      var limpo = {
        url: normalizarUrlConfig(config && config.url),
        token: limparTokenBearer(config && config.token)
      };
      localStorage.setItem(API_CONFIG_KEY, JSON.stringify(limpo));
      return limpo;
    }
  };
  var sequenciaDetalhe = 0;
  var elementoComFocoAntesDoModal = null;

  var alunosService = {
    listar: function () {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return null;

      var alunosSalvos = JSON.parse(raw);
      if (!Array.isArray(alunosSalvos)) throw new Error("O conteúdo salvo não é uma lista de alunos.");
      if (!alunosSalvos.every(function (aluno) {
        return aluno && typeof aluno === "object" && typeof aluno.nome === "string" && typeof aluno.curso === "string";
      })) throw new Error("Há registros inválidos no armazenamento.");
      return alunosSalvos;
    },
    salvar: function (alunos) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(alunos));
      return true;
    }
  };

  /* ---------------- indicadores macroeconômicos (configuração global) ---------------- */

  // Desemprego, inflação e PIB são indicadores do período, iguais para todos os alunos:
  // ficam numa configuração única (não por aluno) e entram no payload via valorDoCampo().
  var MACRO_KEY = "config-macro";
  var CAMPOS_MACRO = ["unemployment_rate", "inflation_rate", "gdp"];
  // Faixas observadas no dataset de treino; fora delas a predição é uma extrapolação.
  var FAIXA_TREINO = { unemployment_rate: [7.6, 16.2], inflation_rate: [-0.8, 3.7], gdp: [-4.06, 3.51] };

  function campoMacro(chave) {
    return CAMPOS_PREDICAO.filter(function (c) { return c.chave === chave; })[0];
  }

  // Devolve a configuração normalizada ({3 chaves}) ou null se faltar/estiver inválido algum valor.
  function validarMacro(config) {
    if (!config || typeof config !== "object") return null;
    var limpo = {};
    for (var i = 0; i < CAMPOS_MACRO.length; i++) {
      var chave = CAMPOS_MACRO[i];
      if (!valorValido(campoMacro(chave), config[chave])) return null;
      limpo[chave] = config[chave];
    }
    return limpo;
  }

  function formatarNumeroBR(n) { return String(n).replace(".", ","); }

  function avisosFaixaMacro(config) {
    var avisos = [];
    CAMPOS_MACRO.forEach(function (chave) {
      var v = config ? config[chave] : null;
      var faixa = FAIXA_TREINO[chave];
      if (typeof v === "number" && isFinite(v) && (v < faixa[0] || v > faixa[1])) {
        avisos.push(campoMacro(chave).rotulo + ": " + formatarNumeroBR(v) + " está fora da faixa vista no treino (" +
          formatarNumeroBR(faixa[0]) + " a " + formatarNumeroBR(faixa[1]) + ").");
      }
    });
    return avisos;
  }

  var macroService = {
    carregar: function () {
      try {
        var raw = localStorage.getItem(MACRO_KEY);
        return raw ? validarMacro(JSON.parse(raw)) : null;
      } catch (err) {
        return null;
      }
    },
    salvar: function (config) {
      localStorage.setItem(MACRO_KEY, JSON.stringify(config));
      return true;
    }
  };
  /* ---------------- utilidades ---------------- */

  function gerarId() {
    return "al_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function normalizarTexto(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function cursoPorCodigo(codigo) {
    return CURSOS_DISPONIVEIS.find(function (curso) { return curso.codigo === Number(codigo); }) || null;
  }

  function opcoesCurso(codigoSelecionado, nomeLegado) {
    var selecionado = Number(codigoSelecionado) || "";
    var opcoes = '<option value="">Selecione o curso</option>';
    if (nomeLegado && !cursoPorCodigo(selecionado)) {
      opcoes += '<option value="legacy" selected>' + escapeHtml(nomeLegado) + ' (cadastro existente)</option>';
    }
    return opcoes + CURSOS_DISPONIVEIS.map(function (curso, idx) {
      return '<option value="' + curso.codigo + '"' + (curso.codigo === selecionado ? ' selected' : '') + '>Cód. ' + (idx + 1) + ' — ' + escapeHtml(curso.nome) + ' (UCI ' + curso.codigo + ')</option>';
    }).join("");
  }

  // Os 13 atributos do payload exemplificado pelo líder (Daniel) na Kasper API:
  // "course" fica em Dados de matrícula; os outros 12 aparecem diretamente na grade principal.
  var CHAVES_ESSENCIAIS_DANIEL = [
    "marital_status",
    "age_at_enrollment",
    "debtor",
    "tuition_fees_up_to_date",
    "scholarship_holder",
    "curricular_units_1st_sem_enrolled",
    "curricular_units_1st_sem_approved",
    "curricular_units_1st_sem_grade",
    "curricular_units_2nd_sem_enrolled",
    "curricular_units_2nd_sem_approved",
    "curricular_units_2nd_sem_grade",
    "unemployment_rate"
  ];

  var EXEMPLOS_DANIEL = {
    evasao: {
      rotulo: "ALUNO-RISCO-EVASAO (Crítico · Idade 32)",
      studentId: "ALUNO-RISCO-EVASAO",
      nomeSugerido: "Carlos Eduardo Silva",
      emailSugerido: "carlos.evasao@escola.com",
      cursoCodigoUci: 171, // course: 2
      turno: "Diurno",
      frequencia: 48,
      media: 3.5,
      reprovadas: 6,
      unemployment_rate: 16.2,
      dados: {
        marital_status: 1,
        debtor: 1,
        tuition_fees_up_to_date: 0,
        scholarship_holder: 0,
        age_at_enrollment: 32,
        curricular_units_1st_sem_enrolled: 6,
        curricular_units_1st_sem_approved: 0,
        curricular_units_1st_sem_grade: 0.0,
        curricular_units_2nd_sem_enrolled: 6,
        curricular_units_2nd_sem_approved: 0,
        curricular_units_2nd_sem_grade: 0.0
      }
    },
    critico1: {
      rotulo: "ALUNO-001-CRITICO (Crítico · Idade 29)",
      studentId: "ALUNO-001-CRITICO",
      nomeSugerido: "Lucas Mendes",
      emailSugerido: "lucas.critico@escola.com",
      cursoCodigoUci: 171, // course: 2
      turno: "Noturno",
      frequencia: 52,
      media: 4.0,
      reprovadas: 6,
      unemployment_rate: 16.2,
      dados: {
        marital_status: 1,
        debtor: 1,
        tuition_fees_up_to_date: 0,
        scholarship_holder: 0,
        age_at_enrollment: 29,
        curricular_units_1st_sem_enrolled: 6,
        curricular_units_1st_sem_approved: 0,
        curricular_units_1st_sem_grade: 0.0,
        curricular_units_2nd_sem_enrolled: 6,
        curricular_units_2nd_sem_approved: 0,
        curricular_units_2nd_sem_grade: 0.0
      }
    },
    destaque2: {
      rotulo: "ALUNO-002-DESTAQUE (Baixo Risco · Idade 18)",
      studentId: "ALUNO-002-DESTAQUE",
      nomeSugerido: "Mariana Costa",
      emailSugerido: "mariana.destaque@escola.com",
      cursoCodigoUci: 9147, // course: 9 (Gestão)
      turno: "Diurno",
      frequencia: 94,
      media: 8.9,
      reprovadas: 0,
      unemployment_rate: 8.0,
      dados: {
        marital_status: 1,
        debtor: 0,
        tuition_fees_up_to_date: 1,
        scholarship_holder: 1,
        age_at_enrollment: 18,
        curricular_units_1st_sem_enrolled: 6,
        curricular_units_1st_sem_approved: 6,
        curricular_units_1st_sem_grade: 17.5,
        curricular_units_2nd_sem_enrolled: 6,
        curricular_units_2nd_sem_approved: 6,
        curricular_units_2nd_sem_grade: 18.0
      }
    }
  };

  function renderCamposIngresso(prefixo, aluno) {
    aluno = aluno || {};
    var cursoSelecionado = Number(aluno.cursoCodigo) || "";
    var cursoOptions = opcoesCurso(cursoSelecionado, aluno.curso);
    var turnoAtual = aluno.turno || "";
    var campoTurno = "";
    if (prefixo === "f") {
      var turnoOptions = '<option value="">Selecione o turno</option>' + TURNOS_DISPONIVEIS.map(function (t) {
        return '<option value="' + escapeHtml(t) + '"' + (turnoAtual === t ? ' selected' : '') + '>' + escapeHtml(t) + '</option>';
      }).join("");
      campoTurno = '<div class="field"><label for="' + prefixo + '-turno">Turno</label><select id="' + prefixo + '-turno" required>' + turnoOptions + '</select></div>';
    }

    return '<fieldset class="form-section">' +
      '<legend>Dados de matrícula (Atributo <code>course</code> do payload)</legend>' +
      '<div class="form-grid">' +
      '<div class="field"><label for="' + prefixo + '-curso">Curso (<code>course</code>: 1 a 17)</label><select id="' + prefixo + '-curso" required>' + cursoOptions + '</select><span class="field-hint">Ex.: Cód. 2 = <code>"course": 2</code> no JSON da API.</span></div>' +
      campoTurno +
      '<div class="field"><label for="' + prefixo + '-data">Data de matrícula</label><input id="' + prefixo + '-data" type="date" value="' + escapeHtml(aluno.dataMatricula || hojeISO()) + '" required /></div>' +
      '</div>' +
      '</fieldset>';
  }

  function renderCamposAcademicos(prefixo, aluno) {
    aluno = aluno || {};
    return '<fieldset class="form-section">' +
      '<legend>Acompanhamento acadêmico</legend>' +
      '<p class="form-section-note">Indicadores informativos da plataforma. Não são enviados ao modelo: ele usa as notas por semestre (0–20) da seção &ldquo;Dados para predição&rdquo;.</p>' +
      '<div class="form-grid">' +
      '<div class="field"><label for="' + prefixo + '-freq">Frequência (%)</label><input id="' + prefixo + '-freq" type="number" min="0" max="100" step="0.1" value="' + (aluno.frequencia == null ? "" : aluno.frequencia) + '" /></div>' +
      '<div class="field"><label for="' + prefixo + '-media">Média acadêmica (0–10)</label><input id="' + prefixo + '-media" type="number" min="0" max="10" step="0.1" value="' + (aluno.media == null ? "" : aluno.media) + '" /></div>' +
      '<div class="field"><label for="' + prefixo + '-reprovadas">Disciplinas reprovadas</label><input id="' + prefixo + '-reprovadas" type="number" min="0" step="1" value="' + (aluno.disciplinasReprovadas == null ? "" : aluno.disciplinasReprovadas) + '" /></div>' +
      '</div>' +
      '</fieldset>';
  }

  function lerDadosAcademicos(prefixo) {
    function numero(campo) {
      var el = document.getElementById(prefixo + "-" + campo);
      if (!el) return null;
      var valor = el.value;
      return valor === "" ? null : Number(valor);
    }
    return {
      frequencia: numero("freq"),
      media: numero("media"),
      disciplinasReprovadas: numero("reprovadas")
    };
  }

  function lerDadosIngresso(prefixo, alunoAnterior) {
    function valor(campo) { return document.getElementById(prefixo + "-" + campo).value; }

    var cursoValue = valor("curso");
    var curso = cursoValue === "legacy" ? null : cursoPorCodigo(cursoValue);

    return {
      cursoCodigo: curso ? curso.codigo : (alunoAnterior ? alunoAnterior.cursoCodigo || null : null),
      curso: curso ? curso.nome : (alunoAnterior ? alunoAnterior.curso : ""),
      dataMatricula: valor("data")
    };
  }

  /* ---------------- dados para predição: formulário ---------------- */

  function valorDoCampo(aluno, campo) {
    var valor;
    if (campo.chave === "course") valor = aluno.cursoCodigo;
    else if (campo.chave === "unemployment_rate" && aluno && typeof aluno.unemploymentRate === "number" && isFinite(aluno.unemploymentRate) && state.macro) {
      valor = aluno.unemploymentRate;
    }
    else if (campo.global) valor = state.macro ? state.macro[campo.chave] : null;
    else valor = (aluno.dadosPredicao || {})[campo.chave];
    return valor == null || valor === "" ? null : valor;
  }

  function renderCampoPredicao(prefixo, campo, aluno) {
    var id = prefixo + "-p-" + campo.chave;
    var valor = valorDoCampo(aluno, campo);
    var controle;
    if (campo.tipo === "catalogo" || campo.tipo === "opcao") {
      controle = '<select id="' + id + '"><option value="">Selecione</option>' + campo.opcoes.map(function (opcao, indice) {
        var codigoVisivel = campo.tipo === "catalogo" ? (indice + 1) : opcao.codigo;
        return '<option value="' + opcao.codigo + '"' + (valor === opcao.codigo ? ' selected' : '') + '>' + codigoVisivel + ' — ' + escapeHtml(opcao.rotulo) + '</option>';
      }).join("") + '</select>';
    } else {
      controle = '<input id="' + id + '" type="number" min="' + campo.min + '" max="' + campo.max + '" step="' + (campo.tipo === "inteiro" ? "1" : "any") + '" value="' + (valor == null ? "" : valor) + '" />';
    }
    return '<div class="field"><label for="' + id + '">' + escapeHtml(campo.rotulo) + ' <code class="field-code">' + escapeHtml(campo.chave) + '</code></label>' + controle + '</div>';
  }

  function renderCamposEssenciaisDaniel(prefixo, aluno) {
    aluno = aluno || {};
    var camposEssenciais = CHAVES_ESSENCIAIS_DANIEL.map(function (chave) {
      return CAMPOS_PREDICAO.find(function (c) { return c.chave === chave; });
    }).filter(Boolean);

    var botoesDaniel = Object.keys(EXEMPLOS_DANIEL).map(function (chave) {
      return '<button type="button" class="btn btn-secondary js-exemplo-daniel" data-prefixo="' + prefixo + '" data-exemplo="' + chave + '">' + escapeHtml(EXEMPLOS_DANIEL[chave].rotulo) + '</button>';
    }).join("");

    return '<fieldset class="form-section">' +
      '<legend>Dados para Predição de Evasão (Payload Kasper API)</legend>' +
      '<p class="form-section-note">Estes são os 13 atributos do exemplo inicial do Daniel. O envio completo contém 34 atributos no objeto <code>features</code> para <code>/api/v1/predictions</code> (o atributo <code>course</code> é definido acima em Dados de matrícula).</p>' +
      '<div class="example-actions"><span>Exemplos parciais (13 atributos; complete os demais abaixo):</span>' + botoesDaniel + '</div>' +
      '<div class="form-grid">' +
      camposEssenciais.map(function (c) { return renderCampoPredicao(prefixo, c, aluno); }).join("") +
      '</div>' +
      '</fieldset>';
  }

  function renderCamposPredicao(prefixo, aluno) {
    var blocosSecundarios = GRUPOS_PREDICAO.map(function (grupo) {
      var campos = CAMPOS_PREDICAO.filter(function (c) {
        return c.grupo === grupo && !c.cadastro && !c.global && !(prefixo === "f" && c.chave === "daytime_evening_attendance") && CHAVES_ESSENCIAIS_DANIEL.indexOf(c.chave) === -1;
      });
      if (!campos.length) return "";
      return '<div class="predict-group"><h4>' + escapeHtml(grupo) + '</h4><div class="form-grid">' +
        campos.map(function (c) { return renderCampoPredicao(prefixo, c, aluno); }).join("") +
        '</div></div>';
    }).join("");

    var botoes = Object.keys(PERFIS_EXEMPLO).map(function (chave) {
      return '<button type="button" class="btn btn-secondary js-exemplo" data-prefixo="' + prefixo + '" data-perfil="' + chave + '">' + escapeHtml(PERFIS_EXEMPLO[chave].rotulo) + '</button>';
    }).join("");

    var macro = state.macro || {};
    var indicadores = ["inflation_rate", "gdp"].map(function (chave) {
      var campo = campoMacro(chave);
      return '<div class="field"><label>' + escapeHtml(campo.rotulo) + ' <code class="field-code">' + chave + '</code></label>' +
        '<span class="meta-value">' + (macro[chave] == null ? "Não configurado" : formatarNumeroBR(macro[chave]) + "%") + '</span></div>';
    }).join("");
    return '<div class="example-actions"><button type="button" class="btn btn-secondary js-exemplo-kaique" data-prefixo="' + prefixo + '">Preencher exemplo completo do Kaique (34 atributos)</button><span>Usa dados de exemplo; confira antes de salvar.</span></div>' +
      renderCamposEssenciaisDaniel(prefixo, aluno) +
      '<fieldset class="form-section"><legend>Demais atributos do modelo</legend>' +
      '<p class="form-section-note">Campos sem informação permanecem pendentes. Nenhum valor complementar é presumido no cadastro comum.</p>' +
      '<div class="example-actions"><span>Perfis completos do CSV UCI:</span>' + botoes + '</div>' + blocosSecundarios + '</fieldset>' +
      '<fieldset class="form-section"><legend>Indicadores globais incluídos no envio</legend>' +
      '<p class="form-section-note">Inflação e PIB vêm de Indicadores macro, no cabeçalho, e são compartilhados por todos os alunos. O desemprego acima pode ser individual.</p>' +
      '<div class="form-grid">' + indicadores + '</div></fieldset>';
  }

  function lerFormularioPredicao(prefixo) {
    var dados = {};
    CAMPOS_PREDICAO.forEach(function (campo) {
      if (campo.cadastro || campo.global) return;
      var el = document.getElementById(prefixo + "-p-" + campo.chave);
      var valor = el ? el.value : "";
      if (prefixo === "f" && campo.chave === "daytime_evening_attendance") {
        var turno = document.getElementById("f-turno").value;
        dados[campo.chave] = turno === "Diurno" ? 1 : (turno === "Noturno" ? 0 : null);
      } else dados[campo.chave] = valor === "" ? null : Number(valor);
    });
    return dados;
  }

  function alunoDoPayloadExemplo(payload) {
    var aluno = { studentId: payload.studentId, dadosPredicao: {}, unemploymentRate: payload.features.unemployment_rate };
    CAMPOS_PREDICAO.forEach(function (campo) {
      var valor = payload.features[campo.chave];
      if (campo.tipo === "catalogo") {
        var item = CATALOGOS[campo.chave][valor - 1];
        if (!item) throw new Error("Índice inválido no exemplo: " + campo.chave);
        valor = item.codigo;
      }
      if (campo.cadastro) aluno.cursoCodigo = valor;
      else if (!campo.global) aluno.dadosPredicao[campo.chave] = valor;
    });
    sincronizarTurno(aluno);
    return aluno;
  }

  function preencherExemploKaique(prefixo) {
    var aluno = alunoDoPayloadExemplo(PAYLOAD_EXEMPLO_KAIQUE);
    CAMPOS_PREDICAO.forEach(function (campo) {
      if (campo.global && campo.chave !== "unemployment_rate") return;
      var el = document.getElementById(campo.cadastro ? prefixo + "-curso" : prefixo + "-p-" + campo.chave);
      var valor = campo.cadastro ? aluno.cursoCodigo : campo.chave === "unemployment_rate" ? aluno.unemploymentRate : aluno.dadosPredicao[campo.chave];
      if (el) el.value = String(valor);
    });
    var elTurno = document.getElementById(prefixo + "-turno");
    if (elTurno) elTurno.value = aluno.turno;
    document.getElementById(prefixo + "-student-id").value = aluno.studentId;
    var macro = state.macro || {};
    var diferentes = ["inflation_rate", "gdp"].some(function (chave) { return macro[chave] !== PAYLOAD_EXEMPLO_KAIQUE.features[chave]; });
    mostrarToast(diferentes ? "Exemplo preenchido. Para reproduzir o JSON do Kaique, configure inflação 1,4% e PIB 1,74% em Indicadores macro." : "Exemplo completo do Kaique preenchido. Confira e salve.");
  }

  function lerUnemploymentRateIndividual(prefixo) {
    var el = document.getElementById(prefixo + "-p-unemployment_rate");
    if (!el || el.value === "") return null;
    var n = Number(el.value);
    return isFinite(n) ? n : null;
  }

  function preencherExemploDaniel(prefixo, chaveExemplo) {
    var ex = EXEMPLOS_DANIEL[chaveExemplo];
    if (!ex) return;
    var elCurso = document.getElementById(prefixo + "-curso");
    if (elCurso) elCurso.value = String(ex.cursoCodigoUci);
    var elTurno = document.getElementById(prefixo + "-turno");
    if (elTurno && ex.turno) elTurno.value = ex.turno;
    var elTurnoPredicao = document.getElementById(prefixo + "-p-daytime_evening_attendance");
    if (elTurnoPredicao && ex.turno) elTurnoPredicao.value = ex.turno === "Diurno" ? "1" : "0";
    var elStudentId = document.getElementById(prefixo + "-student-id");
    if (elStudentId && ex.studentId) elStudentId.value = ex.studentId;
    var elNome = document.getElementById(prefixo + "-nome");
    if (elNome && !elNome.value.trim() && ex.nomeSugerido) elNome.value = ex.nomeSugerido;
    var elEmail = document.getElementById(prefixo + "-email");
    if (elEmail && !elEmail.value.trim() && ex.emailSugerido) elEmail.value = ex.emailSugerido;

    Object.keys(ex.dados).forEach(function (chave) {
      var el = document.getElementById(prefixo + "-p-" + chave);
      if (el) el.value = String(ex.dados[chave]);
    });
    var elUnemp = document.getElementById(prefixo + "-p-unemployment_rate");
    if (elUnemp && ex.unemployment_rate != null) elUnemp.value = String(ex.unemployment_rate);
    mostrarToast("Exemplo " + ex.studentId + " preenchido nos campos.");
  }

  function preencherPerfilExemplo(prefixo, chavePerfil) {
    var perfil = PERFIS_EXEMPLO[chavePerfil];
    if (!perfil) return;
    CAMPOS_PREDICAO.forEach(function (campo) {
      var el = document.getElementById(campo.cadastro ? prefixo + "-curso" : prefixo + "-p-" + campo.chave);
      if (el && perfil.dados[campo.chave] != null) el.value = String(perfil.dados[campo.chave]);
      if (campo.chave === "daytime_evening_attendance" && prefixo === "f") document.getElementById("f-turno").value = perfil.dados[campo.chave] === 1 ? "Diurno" : "Noturno";
    });
    mostrarToast("Perfil de exemplo carregado (" + perfil.rotulo.toLowerCase() + "). Salve para aplicar.");
  }

  function formatarData(iso) {
    if (!iso) return "—";
    var partes = iso.split("-");
    if (partes.length !== 3) return iso;
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  function hojeISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  var toastTimer = null;
  function mostrarToast(msg, tipo) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (tipo === "erro" ? " danger" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  /* ---------------- validação e payload ---------------- */

  function valorValido(campo, valor) {
    if (typeof valor !== "number" || !isFinite(valor)) return false;
    if (campo.tipo === "catalogo" || campo.tipo === "opcao") {
      return campo.opcoes.some(function (opcao) { return opcao.codigo === valor; });
    }
    if (campo.tipo === "inteiro" && Math.floor(valor) !== valor) return false;
    if (campo.min != null && valor < campo.min) return false;
    if (campo.max != null && valor > campo.max) return false;
    return true;
  }

  // Devolve os campos (do esquema) ausentes ou inválidos. Lista vazia = dados completos.
  function camposFaltantes(aluno) {
    return CAMPOS_PREDICAO.filter(function (campo) {
      return !valorValido(campo, valorDoCampo(aluno, campo));
    });
  }

  /*
   * ÚNICO ponto de conversão código UCI -> valor do modelo.
   * O manual da API (seções 5 e 13) manda enviar o código original da UCI, mas o modelo foi
   * treinado com o CSV em que cada coluna categórica foi reindexada 1..N. A hipótese validada
   * (ver testes) é: valor do modelo = posição (base 1) do código UCI no catálogo ordenado da
   * seção 13 do manual (CATALOGOS em catalogos.js). Ex.: curso 33 -> 1; curso 9500 -> 12.
   * Retorna null se o código não existe no catálogo.
   */
  function converterCodigoUciParaIndice(chave, codigoUci) {
    var lista = CATALOGOS[chave];
    if (!lista) return codigoUci;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].codigo === codigoUci) return i + 1;
    }
    return null;
  }

  // Monta os 34 atributos numéricos exigidos pelo modelo. Lança erro se faltar qualquer dado.
  function montarFeatures(aluno) {
    var faltantes = camposFaltantes(aluno);
    if (faltantes.length) {
      throw new Error("Dados incompletos: " + faltantes.map(function (c) { return c.rotulo; }).join(", "));
    }
    var features = {};
    CAMPOS_PREDICAO.forEach(function (campo) {
      var valor = valorDoCampo(aluno, campo);
      features[campo.chave] = campo.tipo === "catalogo" ? converterCodigoUciParaIndice(campo.chave, valor) : valor;
    });
    return features;
  }

  // Monta o payload no formato { studentId, features } exigido pelo Kasper API.
  function montarPayload(aluno) {
    var features = montarFeatures(aluno);
    var idEnvio = (aluno && (aluno.studentId || aluno.id)) ? String(aluno.studentId || aluno.id) : "ALUNO-2026-001";
    return {
      studentId: idEnvio,
      features: features
    };
  }

  function hashDados(texto) {
    var h = 5381;
    for (var i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function chaveCache(aluno, payload) {
    var baseHash = payload && payload.features ? payload.features : payload;
    return aluno.id + ":" + hashDados(JSON.stringify(baseHash));
  }

  /* ---------------- comunicação com a API ---------------- */

  function erroApi(tipo, mensagem) {
    var erro = new Error(mensagem);
    erro.tipoErro = tipo;
    return erro;
  }

  function obterUrlApi(caminho, config) {
    config = config || state.apiConfig;
    var urlConfigurada = normalizarUrlConfig(config && config.url ? config.url : API_BASE_URL).replace(/\/+$/, "");
    // Em HTTPS (Vercel), converte qualquer URL HTTP para o caminho relativo /api/... tratado pelo vercel.json
    if (EM_HTTPS && /^http:\/\/[^\/]+(\/api\/.*)$/i.test(urlConfigurada)) {
      urlConfigurada = urlConfigurada.replace(/^http:\/\/[^\/]+/i, "");
    }
    if (!caminho || caminho === "/predict" || caminho === "/predictions" || caminho === "/api/v1/predictions") {
      if (/\/(predict|predictions)$/i.test(urlConfigurada)) return urlConfigurada;
      return urlConfigurada + (caminho || "/api/v1/predictions");
    }
    var raiz = urlConfigurada.replace(/\/(api\/v1\/predictions|predictions|predict)$/i, "");
    return (raiz || "") + caminho;
  }

  function montarHeadersApi(config) {
    config = config || state.apiConfig;
    var headers = { "Content-Type": "application/json", "Accept": "application/json" };
    var token = config && config.token ? limparTokenBearer(config.token) : "";
    if (token) {
      headers["Authorization"] = "Bearer " + token;
      headers["X-API-KEY"] = token;
    }
    return headers;
  }

  function mensagemHttp(status, dados) {
    var detalhe = dados && (dados.detail || dados.message || dados.error || dados.erro);
    if (status === 401) {
      return "A API retornou HTTP 401" + (typeof detalhe === "string" && detalhe ? ": " + detalhe : " sem mensagem explicativa. A resposta, isoladamente, não permite identificar a causa.");
    }
    if (status === 403) {
      return "Acesso bloqueado pela API (HTTP 403" + (typeof detalhe === "string" && detalhe ? " — " + detalhe : "") + "). Verifique a liberação de CORS deste domínio na API ou confira o Token.";
    }
    if (status === 422 && Array.isArray(detalhe)) {
      return "A API recusou os dados (HTTP 422): " + detalhe.map(function (item) {
        var local = Array.isArray(item.loc) ? item.loc.filter(function (p) { return p !== "body"; }).join(".") : "";
        return (local ? local + ": " : "") + item.msg;
      }).join("; ");
    }
    if (typeof detalhe === "string") return "A API retornou HTTP " + status + ": " + detalhe;
    return "A API retornou HTTP " + status + ".";
  }

  async function executarFetchApi(urlAlvo, metodo, headers, corpo, sinal) {
    return fetch(urlAlvo, {
      method: metodo,
      headers: headers,
      body: metodo !== "GET" && corpo != null ? JSON.stringify(corpo) : undefined,
      signal: sinal
    });
  }

  function urlPortaAlternativa(urlAlvo) {
    // Se a URL for HTTP sem porta explícita (padrão 80), gera alternativa na 8080 (e vice-versa)
    var mSemPorta = urlAlvo.match(/^(http:\/\/[^\/:]+)(\/.*)?$/i);
    if (mSemPorta) return mSemPorta[1] + ":8080" + (mSemPorta[2] || "");
    var mCom8080 = urlAlvo.match(/^(http:\/\/[^\/:]+):8080(\/.*)?$/i);
    if (mCom8080) return mCom8080[1] + (mCom8080[2] || "");
    var mCom80 = urlAlvo.match(/^(http:\/\/[^\/:]+):80(\/.*)?$/i);
    if (mCom80) return mCom80[1] + ":8080" + (mCom80[2] || "");
    return null;
  }

  async function lerCorpoResposta(resposta) {
    if (!resposta) return null;
    if (typeof resposta.text === "function") {
      var texto = await resposta.text();
      if (!texto.trim()) return null;
      try { return JSON.parse(texto); } catch (err) { return { detail: texto.trim().slice(0, 220) }; }
    }
    try {
      return await resposta.json();
    } catch (errJson) {
      return null;
    }
  }

  function mensagemFalhaHttp(status, dados, duracaoMs) {
    var mensagem = mensagemHttp(status, dados) + " Tempo de resposta: " + (duracaoMs / 1000).toFixed(1) + " s.";
    if (status === 401 && dados == null && duracaoMs >= 3500) {
      mensagem += " A demora pode indicar um timeout interno, mas a confirmação depende dos logs do servidor.";
    }
    return mensagem;
  }

  function registrarEstadoApi(status, detalhe) {
    state.api = { status: status, detalhe: detalhe };
    renderBadgeApi();
  }

  async function chamarApi(caminho, corpo) {
    var configConsulta = state.apiConfig;
    var controlador = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controlador) controlador.abort(); }, API_TIMEOUT_MS);
    var urlAlvo = obterUrlApi(caminho);
    var headers = montarHeadersApi();
    var sinal = controlador ? controlador.signal : undefined;
    var inicioMs = Date.now();
    var resposta;
    var dados;
    try {
      try {
        resposta = await executarFetchApi(urlAlvo, "POST", headers, corpo, sinal);
      } catch (errPrimario) {
        var urlAlt = urlPortaAlternativa(urlAlvo);
        if (urlAlt && (!errPrimario || errPrimario.name !== "AbortError")) {
          resposta = await executarFetchApi(urlAlt, "POST", headers, corpo, sinal);
        } else {
          throw errPrimario;
        }
      }
      dados = await lerCorpoResposta(resposta);
    } catch (err) {
      if (state.apiConfig === configConsulta) registrarEstadoApi("erro", "A última consulta não pôde ser concluída.");
      throw erroApi("rede", err && err.name === "AbortError"
        ? "A API não respondeu em " + (API_TIMEOUT_MS / 1000) + " s."
        : "Não foi possível conectar à API em " + urlAlvo + ".");
    } finally {
      clearTimeout(timer);
    }
    if (!resposta.ok) {
      var mensagem = mensagemFalhaHttp(resposta.status, dados, Date.now() - inicioMs);
      if (state.apiConfig === configConsulta) registrarEstadoApi("erro", mensagem);
      throw erroApi("http", mensagem);
    }
    return dados;
  }

  var NIVEL_API = {
    "Baixo Risco": "low",
    "Baixo Risco de Evasão": "low",
    "Baixo": "low",
    "LOW": "low",
    "Low": "low",
    "low": "low",
    "Médio Risco": "mid",
    "Medio Risco": "mid",
    "Médio Risco de Evasão": "mid",
    "Médio": "mid",
    "MEDIUM": "mid",
    "Medium": "mid",
    "mid": "mid",
    "Alto Risco": "high",
    "Alto Risco de Evasão": "high",
    "Alto": "high",
    "HIGH": "high",
    "High": "high",
    "high": "high"
  };

  var ROTULO_NIVEL_PADRAO = {
    low: "Baixo Risco",
    mid: "Médio Risco",
    high: "Alto Risco de Evasão"
  };

  // Converte uma predição da API em {score, nivel, ...}; suporta envelope do Kasper API e retorno direto do modelo.
  function converterRespostaApi(resposta) {
    if (!resposta || typeof resposta !== "object") {
      throw erroApi("resposta", "A API devolveu uma resposta em formato inesperado.");
    }
    var r = (resposta.data && typeof resposta.data === "object") ? resposta.data
      : (resposta.result && typeof resposta.result === "object") ? resposta.result
        : (resposta.prediction && typeof resposta.prediction === "object") ? resposta.prediction
          : resposta;

    var p = typeof r.dropout_probability === "number" ? r.dropout_probability
      : typeof r.dropoutProbability === "number" ? r.dropoutProbability
        : typeof r.probability === "number" ? r.probability
          : typeof r.probabilidade_evasao === "number" ? r.probabilidade_evasao
            : null;

    var rawNivel = r.risk_level != null ? r.risk_level
      : r.riskLevel != null ? r.riskLevel
        : r.risk != null ? r.risk
          : null;

    var nivel = rawNivel != null ? NIVEL_API[String(rawNivel)] : null;
    if (rawNivel == null && typeof p === "number" && isFinite(p) && p >= 0 && p <= 1 && (r.studentId != null || resposta.studentId != null)) {
      nivel = p >= 0.7 ? "high" : (p >= 0.4 ? "mid" : "low");
      rawNivel = ROTULO_NIVEL_PADRAO[nivel];
    }

    if (typeof p !== "number" || !isFinite(p) || p < 0 || p > 1 || !nivel) {
      throw erroApi("resposta", "A API devolveu uma resposta em formato inesperado.");
    }
    var pred = r.prediction != null ? r.prediction : resposta.prediction;
    return {
      score: Math.round(p * 100),
      nivel: nivel,
      probabilidade: p,
      riskLevel: ROTULO_NIVEL_PADRAO[nivel] || String(rawNivel),
      modelo: r.model_used || r.modelUsed || null,
      acuracia: typeof r.model_accuracy === "number" ? r.model_accuracy : (typeof r.modelAccuracy === "number" ? r.modelAccuracy : null),
      evasaoPrevista: pred === 1 || pred === true || pred === "Dropout"
    };
  }

  async function preverRisco(aluno) {
    var payload = montarPayload(aluno);
    var configConsulta = state.apiConfig;
    var resultado;
    try {
      resultado = converterRespostaApi(await chamarApi("/predict", payload));
    } catch (err) {
      if (err.tipoErro === "resposta" && state.apiConfig === configConsulta) registrarEstadoApi("erro", err.message);
      throw err;
    }
    if (state.apiConfig !== configConsulta) return resultado;
    registrarEstadoApi("online", "A última consulta retornou uma predição válida.");
    state.predicoes[chaveCache(aluno, payload)] = resultado;
    return resultado;
  }

  async function preverLote(alunos) {
    // Executa a predição individualmente no endpoint configurado (/api/v1/predictions) para cada aluno pendente
    for (var i = 0; i < alunos.length; i++) {
      await preverRisco(alunos[i]);
    }
  }

  /* ---------------- previsões em cache (lista e contadores) ---------------- */

  function obterPrevisao(aluno) {
    if (camposFaltantes(aluno).length) return null;
    return state.predicoes[chaveCache(aluno, montarPayload(aluno))] || null;
  }

  function estadoPrevisao(aluno) {
    if (camposFaltantes(aluno).length) return "incompleto";
    if (obterPrevisao(aluno)) return "ok";
    if (state.lote.status === "carregando") return "calculando";
    if (state.lote.status === "erro") return "indisponivel";
    return "sem";
  }

  // Consultas individuais para os alunos ativos, completos e ainda sem cache.
  async function atualizarLote() {
    var pendentes = state.alunos.filter(function (a) {
      return a.status === "ativo" && camposFaltantes(a).length === 0 && !obterPrevisao(a);
    });
    if (!pendentes.length) {
      if (state.lote.status === "erro") state.lote.status = "ocioso";
      renderLista();
      return;
    }
    var minhaSeq = ++state.lote.seq;
    state.lote.status = "carregando";
    state.lote.erro = null;
    renderLista();
    try {
      await preverLote(pendentes);
      if (minhaSeq === state.lote.seq) state.lote.status = "ocioso";
    } catch (err) {
      if (minhaSeq === state.lote.seq) {
        state.lote.status = "erro";
        state.lote.erro = err.message;
      }
    }
    renderLista();
    atualizarDetalheAberto();
  }

  /* ---------------- painel: indicadores macroeconômicos ---------------- */

  function textoMacro() {
    if (!state.macro) return "não configurados";
    return "desemprego " + formatarNumeroBR(state.macro.unemployment_rate) + "% · inflação " +
      formatarNumeroBR(state.macro.inflation_rate) + "% · PIB " + formatarNumeroBR(state.macro.gdp) + "%";
  }

  function renderTokenAviso() {
    var el = document.getElementById("token-aviso");
    if (!el) return;
    var temToken = Boolean(state.apiConfig && state.apiConfig.token);
    if (temToken) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = '<div><strong>Token Bearer pendente.</strong> Gere seu token no <a href="https://kasper-ai-studio.vercel.app/login" target="_blank" rel="noopener noreferrer" class="btn-link">Kasper AI Studio ↗</a> e configure a conexão para realizar predições na API.</div>' +
      '<button type="button" class="btn-link js-abrir-api-config">Configurar API &amp; Token</button>';
  }

  function abrirModalApiConfig() {
    var atual = state.apiConfig || { url: API_BASE_URL, token: "" };
    abrirModal(
      '<h2 id="modal-title">Configurar API &amp; Token Bearer</h2>' +
      '<p class="modal-sub">Gere sua chave em <a href="https://kasper-ai-studio.vercel.app/login" target="_blank" rel="noopener noreferrer" class="btn-link">Kasper AI Studio (kasper-ai-studio.vercel.app) ↗</a>, cole abaixo e confirme o endpoint.</p>' +
      '<form id="form-api-config">' +
      '<div class="form-grid single">' +
      '<div class="field">' +
      '<label for="cfg-token">Token Bearer (Kasper AI Studio)</label>' +
      '<input id="cfg-token" type="text" class="input-mono" placeholder="Cole aqui o token gerado (ex: edupredict_sk_...)" value="' + escapeHtml(atual.token || "") + '" autocomplete="off" spellcheck="false" />' +
      '<span class="field-hint">Enviado como <code>Authorization: Bearer &lt;token&gt;</code> e <code>X-API-KEY</code>.</span>' +
      '</div>' +
      '<div class="field">' +
      '<label for="cfg-url">URL do Endpoint de Predição</label>' +
      '<input id="cfg-url" type="text" class="input-mono" value="' + escapeHtml(atual.url || API_BASE_URL) + '" required spellcheck="false" />' +
      '<span class="field-hint">Você pode informar qualquer IP, domínio ou porta. Atalhos rápidos:</span>' +
      '<div class="preset-chips">' +
      '<button type="button" class="preset-chip js-preset-url" data-url="/api/v1/predictions">Vercel Proxy (/api/v1/predictions)</button>' +
      '<button type="button" class="preset-chip js-preset-url" data-url="http://52.67.241.122:8080/api/v1/predictions">Kasper API (:8080)</button>' +
      '<button type="button" class="preset-chip js-preset-url" data-url="http://52.67.241.122/api/v1/predictions">Kasper API (Sem porta)</button>' +
      '<button type="button" class="preset-chip js-preset-url" data-url="http://56.126.10.158:8000/predict">ML Direto (:8000)</button>' +
      '<button type="button" class="preset-chip js-preset-url" data-url="http://127.0.0.1:8000/predict">Localhost</button>' +
      '</div>' +
      '</div>' +
      '<div id="api-diag-box" class="api-diag-box" role="status" hidden></div>' +
      '</div>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
      '<button type="button" class="btn btn-secondary" id="btn-testar-api">Testar Token &amp; Conexão</button>' +
      '<button type="submit" class="btn btn-primary">Salvar e Conectar</button>' +
      '</div>' +
      '</form>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.querySelectorAll(".js-preset-url").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.getElementById("cfg-url").value = btn.getAttribute("data-url");
      });
    });

    document.getElementById("btn-testar-api").addEventListener("click", async function () {
      var diagBox = document.getElementById("api-diag-box");
      var btnTestar = document.getElementById("btn-testar-api");
      var urlDigitada = document.getElementById("cfg-url").value.trim() || API_BASE_URL;
      var tokenDigitado = limparTokenBearer(document.getElementById("cfg-token").value);
      diagBox.hidden = false;
      diagBox.className = "api-diag-box";
      diagBox.innerHTML = "Testando comunicação com a API…";
      btnTestar.disabled = true;

      var configTeste = { url: normalizarUrlConfig(urlDigitada), token: tokenDigitado };
      var urlEfetiva = obterUrlApi("/predict", configTeste);
      var headers = montarHeadersApi(configTeste);

      var featuresTeste = Object.assign({}, PERFIS_EXEMPLO.alto.dados);
      featuresTeste.course = converterCodigoUciParaIndice("course", featuresTeste.course) || 2;
      ["application_mode", "previous_qualification", "nationality", "mothers_qualification", "fathers_qualification", "mothers_occupation", "fathers_occupation"].forEach(function (k) {
        featuresTeste[k] = converterCodigoUciParaIndice(k, featuresTeste[k]) || 1;
      });
      var macroAtual = state.macro || { unemployment_rate: 10.8, inflation_rate: 1.4, gdp: 1.74 };
      featuresTeste.unemployment_rate = macroAtual.unemployment_rate;
      featuresTeste.inflation_rate = macroAtual.inflation_rate;
      featuresTeste.gdp = macroAtual.gdp;

      var corpoTeste = { studentId: "TESTE-CONEXAO", features: featuresTeste };
      var controlador = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () { if (controlador) controlador.abort(); }, API_TIMEOUT_MS);
      var inicio = Date.now();
      var resumo = "";
      var statusTeste = "erro";
      try {
        var resp = await executarFetchApi(urlEfetiva, "POST", headers, corpoTeste, controlador ? controlador.signal : undefined);
        var corpoResp = await lerCorpoResposta(resp);
        var duracao = Date.now() - inicio;
        resumo = "HTTP " + resp.status + " em " + (duracao / 1000).toFixed(1) + " s.";
        diagBox.innerHTML = '<strong>' + escapeHtml(resumo) + '</strong><br>Endpoint: <code>' + escapeHtml(urlEfetiva) + '</code><br>';
        if (resp.ok) {
          converterRespostaApi(corpoResp);
          statusTeste = "online";
          resumo += " Predição válida recebida.";
          diagBox.className = "api-diag-box ok";
          diagBox.innerHTML += 'A API retornou uma predição válida nesta consulta.';
        } else {
          throw erroApi("http", mensagemFalhaHttp(resp.status, corpoResp, duracao));
        }
      } catch (errTeste) {
        var tempo = ((Date.now() - inicio) / 1000).toFixed(1);
        var detalhe = errTeste && errTeste.name === "AbortError"
          ? "Tempo limite de " + (API_TIMEOUT_MS / 1000) + " s atingido. A causa deve ser investigada no servidor ou na rede."
          : (errTeste.tipoErro ? errTeste.message : "Não foi possível concluir a comunicação. Verifique rede, endpoint e permissões de acesso.");
        resumo = (resumo ? resumo + " " : "Consulta encerrada após " + tempo + " s. ") + detalhe;
        diagBox.className = "api-diag-box erro";
        diagBox.innerHTML = '<strong>Predição não confirmada</strong><br>' + escapeHtml(resumo) + '<br>Endpoint: <code>' + escapeHtml(urlEfetiva) + '</code>';
      } finally {
        clearTimeout(timer);
        if (typeof corpoResp !== "undefined") {
          var respostaVisivel = corpoResp == null ? "Corpo vazio ou JSON nulo." : JSON.stringify(corpoResp, null, 2);
          if (tokenDigitado) respostaVisivel = respostaVisivel.split(tokenDigitado).join("[chave oculta]");
          diagBox.innerHTML += '<details><summary>Resposta recebida</summary><pre class="payload-code">' + escapeHtml(respostaVisivel) + '</pre></details>';
        }
        btnTestar.disabled = false;
        // O teste usa uma configuração local; não substitui nem restaura configurações salvas.
        if (document.getElementById("api-diag-box") === diagBox &&
            normalizarUrlConfig(state.apiConfig.url) === configTeste.url &&
            limparTokenBearer(state.apiConfig.token) === configTeste.token) {
          registrarEstadoApi(statusTeste, resumo);
        }
      }
    });

    document.getElementById("form-api-config").addEventListener("submit", function (e) {
      e.preventDefault();
      var urlDigitada = document.getElementById("cfg-url").value.trim();
      var tokenDigitado = document.getElementById("cfg-token").value.trim();
      if (!urlDigitada) {
        mostrarToast("Informe a URL do endpoint da API.", "erro");
        return;
      }
      try {
        state.apiConfig = apiConfigService.salvar({ url: urlDigitada, token: tokenDigitado });
      } catch (err) {
        mostrarToast("Não foi possível salvar a configuração da API.", "erro");
        return;
      }
      state.predicoes = {};
      state.api = { status: state.apiConfig.token ? "configurado" : "desconhecido", detalhe: "Configuração salva; a predição ainda não foi verificada." };
      fecharModal();
      renderBadgeApi();
      renderLista();
      atualizarDetalheAberto();
      mostrarToast(state.apiConfig.token ? "Token Bearer e endpoint salvos com sucesso." : "Endpoint salvo (sem Token Bearer).");
      atualizarLote();
    });
  }

  function renderMacroAviso() {
    var el = document.getElementById("macro-aviso");
    if (!el) return;
    if (state.macro) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = '<strong>Indicadores macroeconômicos não configurados.</strong> Sem eles não há predição para nenhum aluno. ' +
      '<button type="button" class="btn-link js-abrir-macro">Configurar agora</button>';
  }

  function abrirModalMacro() {
    var atual = state.macro || {};
    var campos = CAMPOS_PREDICAO.filter(function (c) { return c.global; });
    var inputs = campos.map(function (c) {
      var faixa = FAIXA_TREINO[c.chave];
      return '<div class="field"><label for="m-' + c.chave + '">' + escapeHtml(c.rotulo) + '</label>' +
        '<input id="m-' + c.chave + '" type="number" step="any" min="' + c.min + '" max="' + c.max + '" value="' +
        (atual[c.chave] == null ? "" : atual[c.chave]) + '" required />' +
        '<span class="field-hint">Faixa vista no treino: ' + formatarNumeroBR(faixa[0]) + ' a ' + formatarNumeroBR(faixa[1]) + '</span></div>';
    }).join("");
    var exemplos = '<option value="">Escolher…</option>' + MACRO_EXEMPLOS.map(function (e, i) {
      return '<option value="' + i + '">Desemprego ' + formatarNumeroBR(e.unemployment_rate) + '% · Inflação ' +
        formatarNumeroBR(e.inflation_rate) + '% · PIB ' + formatarNumeroBR(e.gdp) + '%</option>';
    }).join("");

    abrirModal(
      '<h2 id="modal-title">Indicadores macroeconômicos</h2>' +
      '<p class="modal-sub">Valem para <strong>todos</strong> os alunos: são indicadores do período, não dados individuais. ' +
      'O modelo foi treinado com valores em faixas específicas; fora delas a predição é uma extrapolação.</p>' +
      '<form id="form-macro">' +
      '<div class="form-grid single">' + inputs + '</div>' +
      '<div class="field macro-exemplo"><label for="m-exemplo">Carregar exemplo real do dataset de treino</label><select id="m-exemplo">' + exemplos + '</select></div>' +
      '<div class="macro-alerta" id="macro-alerta" role="status" hidden></div>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Salvar</button>' +
      '</div>' +
      '</form>'
    );

    function lerCampos() {
      var valores = {};
      CAMPOS_MACRO.forEach(function (chave) {
        var v = document.getElementById("m-" + chave).value;
        valores[chave] = v === "" ? null : Number(v);
      });
      return valores;
    }
    function atualizarAlerta() {
      var avisos = avisosFaixaMacro(lerCampos());
      var el = document.getElementById("macro-alerta");
      el.hidden = !avisos.length;
      el.innerHTML = avisos.length ? '<strong>Atenção (não impede salvar):</strong><br>' + avisos.map(escapeHtml).join("<br>") : "";
    }

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    CAMPOS_MACRO.forEach(function (chave) {
      document.getElementById("m-" + chave).addEventListener("input", atualizarAlerta);
    });
    document.getElementById("m-exemplo").addEventListener("change", function (e) {
      var exemplo = MACRO_EXEMPLOS[Number(e.target.value)];
      if (!exemplo) return;
      CAMPOS_MACRO.forEach(function (chave) { document.getElementById("m-" + chave).value = exemplo[chave]; });
      atualizarAlerta();
    });
    atualizarAlerta();

    document.getElementById("form-macro").addEventListener("submit", function (e) {
      e.preventDefault();
      var config = validarMacro(lerCampos());
      if (!config) {
        mostrarToast("Preencha os três indicadores com valores válidos.", "erro");
        return;
      }
      try {
        macroService.salvar(config);
      } catch (err) {
        mostrarToast("Não foi possível salvar os indicadores.", "erro");
        return;
      }
      state.macro = config;
      fecharModal();
      mostrarToast("Indicadores macroeconômicos salvos.");
      renderLista();
      atualizarDetalheAberto();
      atualizarLote();
    });
  }
  /* ---------------- saúde da API (health-check) ---------------- */

  var API_HEALTH_TIMEOUT_MS = 5000;
  var ROTULOS_API = {
    desconhecido: "API: não verificada",
    configurado: "API configurada · Não verificada",
    verificando: "API: verificando…",
    online: "Predição disponível",
    saudavel: "Serviço respondeu · Sem predição verificada",
    erro: "Última consulta falhou",
    offline: "API offline",
    modelo: "API sem modelo"
  };

  // /health informa saúde do serviço, sem comprovar autenticação nem inferência.
  async function verificarSaudeApi() {
    var controlador = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controlador) controlador.abort(); }, API_HEALTH_TIMEOUT_MS);
    state.api = { status: "verificando", detalhe: null };
    renderBadgeApi();
    var urlHealth = obterUrlApi("/health");
    try {
      var resposta = await fetch(urlHealth, { signal: controlador ? controlador.signal : undefined });
      var dados = null;
      try { dados = await resposta.json(); } catch (err) { dados = null; }
      if (!resposta.ok) {
        state.api = { status: "offline", detalhe: "A API respondeu HTTP " + resposta.status + " em /health." };
      } else if (dados && dados.status === "healthy" && dados.model_loaded === true) {
        state.api = { status: "saudavel", detalhe: "O serviço informa modelo carregado. Nenhuma predição foi validada nesta verificação." };
      } else {
        state.api = { status: "modelo", detalhe: "A API respondeu, mas o modelo não está carregado." };
      }
    } catch (err) {
      state.api = { status: "offline", detalhe: "Não foi possível conectar à API em " + urlHealth + "." };
    } finally {
      clearTimeout(timer);
    }
    renderBadgeApi();
    return state.api.status;
  }

  function renderBadgeApi() {
    var el = document.getElementById("api-badge");
    if (!el) return;
    var temToken = Boolean(state.apiConfig && state.apiConfig.token);
    var status = state.api.status;
    var rotulo = ROTULOS_API[status] || ROTULOS_API.desconhecido;
    if (status === "desconhecido" && temToken) {
      status = "configurado";
      rotulo = ROTULOS_API.configurado;
    }
    el.className = "api-badge " + status;
    el.textContent = rotulo;
    el.title = (state.api.detalhe ? state.api.detalhe + " " : "") + "Clique para configurar a API e o Token Bearer.";
  }

  async function reverificarApi() {
    var status = await verificarSaudeApi();
    if (status === "saudavel") atualizarLote();
  }

  /* ---------------- backup: exportar e importar ---------------- */

  function montarBackup() {
    return { versaoDados: VERSAO_DADOS, exportadoEm: new Date().toISOString(), configMacro: state.macro, alunos: state.alunos };
  }

  function exportarDados() {
    var texto;
    try {
      texto = state.erroArmazenamento ? localStorage.getItem(STORAGE_KEY) : JSON.stringify(montarBackup(), null, 2);
      if (texto == null) throw new Error("Não foi possível ler o conteúdo original.");
    } catch (err) {
      mostrarToast("Não foi possível exportar os dados do navegador.", "erro");
      return;
    }
    var blob = new Blob([texto], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = (state.erroArmazenamento ? "alunos-recuperacao-" : "alunos-backup-") + hojeISO() + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    mostrarToast(state.erroArmazenamento ? "Conteúdo original exportado para recuperação." : "Backup exportado (" + state.alunos.length + " aluno(s)).");
  }

  // Valida o conteúdo de um backup e devolve a lista já migrada. Lança Error se algo estiver inválido;
  // nada é alterado em state aqui (validação completa antes de qualquer mudança).
  function interpretarBackup(texto) {
    var dados;
    try { dados = JSON.parse(texto); } catch (err) { throw new Error("O arquivo não é um JSON válido."); }
    var lista = Array.isArray(dados) ? dados : (dados && dados.alunos);
    if (!Array.isArray(lista)) throw new Error("Formato não reconhecido: esperada uma lista de alunos.");
    if (!Array.isArray(dados) && typeof dados.versaoDados === "number" && dados.versaoDados > VERSAO_DADOS) {
      throw new Error("O backup foi gerado por uma versão mais nova da plataforma (dados v" + dados.versaoDados + ").");
    }
    if (!lista.length) throw new Error("O backup não contém nenhum aluno.");
    var ids = {};
    return lista.map(function (aluno, i) {
      if (!aluno || typeof aluno !== "object" || typeof aluno.nome !== "string" || !aluno.nome.trim() || typeof aluno.curso !== "string") {
        throw new Error("Registro " + (i + 1) + " inválido: nome e curso são obrigatórios.");
      }
      var migrado = migrarAluno(aluno);
      if (!migrado.id || ids[migrado.id]) migrado.id = gerarId();
      ids[migrado.id] = true;
      if (!migrado.status) migrado.status = "ativo";
      sincronizarTurno(migrado);
      return migrado;
    });
  }

  // modo "substituir": só os importados; "mesclar": mantém os atuais e sobrescreve os de mesmo id.
  function combinarAlunos(atuais, importados, modo) {
    if (modo === "substituir") return importados.slice();
    var porId = {};
    importados.forEach(function (a) { porId[a.id] = a; });
    var usados = {};
    var resultado = atuais.map(function (a) {
      if (porId[a.id]) { usados[a.id] = true; return porId[a.id]; }
      return a;
    });
    importados.forEach(function (a) { if (!usados[a.id]) resultado.push(a); });
    return resultado;
  }

  // Configuração macro do backup (ou null se ausente/inválida).
  function extrairMacroBackup(texto) {
    try {
      var dados = JSON.parse(texto);
      return dados && !Array.isArray(dados) ? validarMacro(dados.configMacro) : null;
    } catch (err) {
      return null;
    }
  }

  function aplicarImportacao(importados, modo, macro) {
    var anteriores = state.alunos;
    var erroAnterior = state.erroArmazenamento;
    if (erroAnterior) {
      if (modo !== "substituir") {
        mostrarToast("Para recuperar a base, importe um backup válido usando Substituir.", "erro");
        return false;
      }
      try {
        // Preserva o conteúdo original antes da substituição explicitamente solicitada.
        var original = localStorage.getItem(STORAGE_KEY);
        if (original !== null) localStorage.setItem(STORAGE_KEY + "-recuperacao-" + Date.now(), original);
      } catch (err) {
        mostrarToast("Não foi possível preservar os dados originais. Importação interrompida.", "erro");
        return false;
      }
      state.erroArmazenamento = null;
    }
    state.alunos = combinarAlunos(anteriores, importados, modo);
    if (!salvarDados()) {
      state.alunos = anteriores;
      state.erroArmazenamento = erroAnterior;
      return false;
    }
    // Os indicadores do backup só valem em "substituir" ou quando ainda não há configuração.
    if (macro && (modo === "substituir" || !state.macro)) {
      try { macroService.salvar(macro); state.macro = macro; } catch (err) { mostrarToast("Alunos importados, mas os indicadores macro não puderam ser salvos.", "erro"); }
    }
    state.predicoes = {};
    fecharModal();
    fecharDetalhe();
    renderLista();
    mostrarToast("Importação concluída (" + state.alunos.length + " aluno(s) na lista).");
    atualizarLote();
    return true;
  }

  function abrirModalImportar(importados, nomeArquivo, macro) {
    abrirModal(
      '<h2 id="modal-title">Importar dados</h2>' +
      '<p class="modal-sub">O arquivo <strong>' + escapeHtml(nomeArquivo) + '</strong> contém <strong>' + importados.length +
      '</strong> aluno(s). Atualmente há <strong>' + state.alunos.length + '</strong> na lista.</p>' +
      '<p class="modal-sub"><strong>Mesclar</strong> mantém os atuais e sobrescreve os de mesmo identificador. ' +
      '<strong>Substituir</strong> apaga a lista atual e não pode ser desfeito (exporte um backup antes).</p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
      '<button type="button" class="btn btn-secondary" id="btn-importar-mesclar">Mesclar</button>' +
      '<button type="button" class="btn btn-danger" id="btn-importar-substituir">Substituir</button>' +
      '</div>'
    );
    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("btn-importar-mesclar").addEventListener("click", function () { aplicarImportacao(importados, "mesclar", macro); });
    document.getElementById("btn-importar-substituir").addEventListener("click", function () { aplicarImportacao(importados, "substituir", macro); });
  }

  async function importarArquivo(arquivo) {
    try {
      var texto = await arquivo.text();
      abrirModalImportar(interpretarBackup(texto), arquivo.name, extrairMacroBackup(texto));
    } catch (err) {
      mostrarToast("Importação cancelada: " + err.message, "erro");
    }
  }

  var NIVEL_LABEL = { low: "Risco baixo", mid: "Risco médio", high: "Risco alto" };

  /* ---------------- armazenamento ---------------- */

  function migrarAluno(aluno) {
    // v4 -> v5: os indicadores macro deixaram de ser por aluno (agora são globais).
    if (aluno.versaoDados === 4 && aluno.dadosPredicao && typeof aluno.dadosPredicao === "object") {
      CAMPOS_MACRO.forEach(function (chave) { delete aluno.dadosPredicao[chave]; });
      aluno.versaoDados = VERSAO_DADOS;
      return aluno;
    }
    if (aluno.versaoDados === VERSAO_DADOS && aluno.dadosPredicao && typeof aluno.dadosPredicao === "object") return aluno;

    function numero(v) { return typeof v === "number" && isFinite(v) ? v : null; }
    function indicador(v) { return v === true ? 1 : (v === false ? 0 : null); }

    var dados = {
      marital_status: numero(aluno.estadoCivilCodigo),
      application_order: numero(aluno.ordemCandidatura),
      daytime_evening_attendance: numero(aluno.turnoCodigo),
      age_at_enrollment: numero(aluno.idadeIngresso),
      scholarship_holder: indicador(aluno.bolsista),
      debtor: indicador(aluno.devedor),
      tuition_fees_up_to_date: indicador(aluno.mensalidadeEmDia)
    };

    // O curso era guardado como índice 1..17; agora é o código UCI do catálogo.
    var indice = Number(aluno.cursoCodigo);
    if (indice >= 1 && indice <= CATALOGOS.course.length) {
      aluno.cursoCodigo = CATALOGOS.course[indice - 1].codigo;
      aluno.curso = CATALOGOS.course[indice - 1].rotulo;
    } else if (!cursoPorCodigo(aluno.cursoCodigo)) {
      aluno.cursoCodigo = null;
    }

    // Modo de ingresso e escolaridade anterior eram códigos "provisórios": são descartados
    // (precisam ser preenchidos de novo com o catálogo correto).
    ["estadoCivilCodigo", "ordemCandidatura", "turnoCodigo", "idadeIngresso", "bolsista", "devedor",
      "mensalidadeEmDia", "modoIngressoCodigo", "qualificacaoAnteriorCodigo", "predicao", "versaoDemo"
    ].forEach(function (chave) { delete aluno[chave]; });

    aluno.dadosPredicao = dados;
    aluno.versaoDados = VERSAO_DADOS;
    return aluno;
  }

  function sincronizarTurno(aluno) {
    var cursoCatalogo = cursoPorCodigo(aluno.cursoCodigo);
    if (cursoCatalogo) aluno.curso = cursoCatalogo.nome;

    var dados = aluno.dadosPredicao || (aluno.dadosPredicao = {});
    var codigo = dados.daytime_evening_attendance;
    if (codigo === 1) aluno.turno = "Diurno";
    else if (codigo === 0) aluno.turno = "Noturno";
    else if (aluno.turno === "Diurno") dados.daytime_evening_attendance = 1;
    else if (aluno.turno === "Noturno") dados.daytime_evening_attendance = 0;
    else aluno.turno = aluno.turno || "";
  }

  function carregarDados() {
    state.erroArmazenamento = null;
    try {
      var alunosSalvos = alunosService.listar();
      if (alunosSalvos) {
        state.alunos = alunosSalvos.map(function (aluno) {
          var migrado = migrarAluno(aluno);
          sincronizarTurno(migrado);
          return migrado;
        });
        return;
      }
    } catch (err) {
      console.error("Erro ao carregar dados", err);
      state.erroArmazenamento = "Não foi possível carregar os cadastros. O conteúdo original foi preservado. Use Exportar para recuperá-lo ou importe um backup válido com Substituir. Novas gravações estão bloqueadas para proteger os dados.";
    }
    // Primeira vez usando a pagina: inicia com a base limpa (sem alunos)
    state.alunos = [];
  }

  function salvarDados() {
    if (state.erroArmazenamento) {
      mostrarToast("Gravação bloqueada: recupere os dados originais ou importe um backup válido.", "erro");
      return false;
    }
    try {
      return alunosService.salvar(state.alunos);
    } catch (err) {
      console.error("Erro ao salvar dados", err);
      mostrarToast("Não foi possível salvar as alterações.", "erro");
      return false;
    }
  }

  function criarAlunoExemplo(base, chavePerfil) {
    var aluno = Object.assign({ id: gerarId(), status: "ativo", disciplinasReprovadas: null, versaoDados: VERSAO_DADOS }, base);
    var dados = {};
    var codigoCurso = null;
    if (chavePerfil) {
      dados = Object.assign({}, PERFIS_EXEMPLO[chavePerfil].dados);
      codigoCurso = dados.course;
      delete dados.course;
      CAMPOS_MACRO.forEach(function (chave) { delete dados[chave]; });
    } else {
      codigoCurso = 9147;
    }
    aluno.cursoCodigo = codigoCurso;
    aluno.curso = cursoPorCodigo(codigoCurso).nome;
    aluno.dadosPredicao = dados;
    sincronizarTurno(aluno);
    return aluno;
  }

  // Exemplos de demonstração: três perfis reais do dataset (alto, médio e baixo risco) e um cadastro novo, incompleto.
  function gerarAlunosExemplo() {
    return [
      criarAlunoExemplo({ nome: "Fernanda Alves Costa", email: "fernanda.costa@escola.com", dataMatricula: "2024-01-22", frequencia: 52, media: 4.2 }, "alto"),
      criarAlunoExemplo({ nome: "João Pedro Martins", email: "joao.martins@escola.com", dataMatricula: "2022-03-01", frequencia: 68, media: 5.5 }, "medio"),
      criarAlunoExemplo({ nome: "Mariana Ribeiro Santos", email: "mariana.santos@escola.com", dataMatricula: "2024-05-06", frequencia: 88, media: 7.8 }, "baixo"),
      criarAlunoExemplo({ nome: "Cauã Victor Camargo", email: "caua.camargo@escola.com", dataMatricula: hojeISO(), frequencia: null, media: null }, null)
    ];
  }

  /* ---------------- renderização: lista ---------------- */

  function alunosFiltrados() {
    var q = normalizarTexto(state.query.trim());
    var ativos = state.alunos.filter(function (a) { return a.status === "ativo"; });
    return ativos.filter(function (a) {
      var correspondeBusca = !q || normalizarTexto(a.nome).indexOf(q) !== -1 || normalizarTexto(a.curso).indexOf(q) !== -1;
      var previsao = obterPrevisao(a);
      var correspondeRisco = !state.risco || (previsao && previsao.nivel === state.risco);
      var correspondeTurno = !state.turno || (a.turno || "Não informado") === state.turno;
      var correspondeCurso = !state.curso || a.curso === state.curso;
      return correspondeBusca && correspondeRisco && correspondeTurno && correspondeCurso;
    });
  }

  function alunosOrdenados(lista) {
    var campo = state.ordenacao.campo;
    if (!campo) return lista;

    var direcao = state.ordenacao.direcao === "asc" ? 1 : -1;
    var ordemRisco = { low: 1, mid: 2, high: 3 };
    return lista.map(function (aluno, indice) { return { aluno: aluno, indice: indice }; }).sort(function (a, b) {
      var valorA;
      var valorB;
      if (campo === "nome") {
        valorA = normalizarTexto(a.aluno.nome);
        valorB = normalizarTexto(b.aluno.nome);
      } else if (campo === "dataMatricula") {
        valorA = a.aluno.dataMatricula || "";
        valorB = b.aluno.dataMatricula || "";
      } else if (campo === "frequencia") {
        valorA = a.aluno.frequencia == null ? null : Number(a.aluno.frequencia);
        valorB = b.aluno.frequencia == null ? null : Number(b.aluno.frequencia);
      } else {
        var previsaoA = obterPrevisao(a.aluno);
        var previsaoB = obterPrevisao(b.aluno);
        valorA = previsaoA && previsaoA.nivel ? ordemRisco[previsaoA.nivel] : null;
        valorB = previsaoB && previsaoB.nivel ? ordemRisco[previsaoB.nivel] : null;
      }

      if (valorA == null || valorA === "") return valorB == null || valorB === "" ? a.indice - b.indice : 1;
      if (valorB == null || valorB === "") return -1;
      if (valorA < valorB) return -1 * direcao;
      if (valorA > valorB) return 1 * direcao;
      return a.indice - b.indice;
    }).map(function (item) { return item.aluno; });
  }

  function direcaoInicialOrdenacao(campo) {
    return campo === "nome" ? "asc" : "desc";
  }

  function atualizarIndicadoresOrdenacao() {
    document.querySelectorAll(".sort-button").forEach(function (botao) {
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

  function renderStatusApi() {
    var el = document.getElementById("api-status");
    if (state.lote.status === "carregando") {
      el.hidden = false;
      el.className = "api-status";
      el.innerHTML = 'Consultando o modelo de predição…';
    } else if (state.lote.status === "erro") {
      el.hidden = false;
      el.className = "api-status erro";
      el.innerHTML = '<strong>Predição indisponível.</strong> ' + escapeHtml(state.lote.erro || "") +
        ' <button type="button" class="btn-link js-tentar-lote">Tentar novamente</button>' +
        ' <button type="button" class="btn-link js-abrir-api-config" style="margin-left:10px;">Configurar conexão</button>';
    } else {
      el.hidden = true;
      el.innerHTML = "";
    }
  }

  function renderStats() {
    var ativos = state.alunos.filter(function (a) { return a.status === "ativo"; });
    var counts = { low: 0, mid: 0, high: 0, previstas: 0 };
    ativos.forEach(function (a) {
      var previsao = obterPrevisao(a);
      if (!previsao) return;
      counts.previstas++;
      counts[previsao.nivel]++;
    });

    var el = document.getElementById("stats-row");
    el.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + ativos.length + '</div><div class="stat-label">Alunos ativos</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + counts.previstas + '</div><div class="stat-label">Previsões do modelo</div></div>' +
      '<div class="stat-card high"><div class="stat-value">' + counts.high + '</div><div class="stat-label">Alto risco</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (ativos.length - counts.previstas) + '</div><div class="stat-label">Sem predição</div></div>';
  }

  function preencherFiltros() {
    var filtroTurno = document.getElementById("filtro-turno");
    var filtroCurso = document.getElementById("filtro-curso");
    var ativos = state.alunos.filter(function (a) { return a.status === "ativo"; });

    var contagemTurno = {};
    var temSemTurno = false;
    ativos.forEach(function (a) {
      if (a.turno) {
        contagemTurno[a.turno] = (contagemTurno[a.turno] || 0) + 1;
      } else {
        temSemTurno = true;
        contagemTurno["Não informado"] = (contagemTurno["Não informado"] || 0) + 1;
      }
    });
    var turnos = TURNOS_DISPONIVEIS.slice();
    Object.keys(contagemTurno).forEach(function (t) {
      if (t !== "Não informado" && turnos.indexOf(t) === -1) turnos.push(t);
    });
    if (temSemTurno) turnos.push("Não informado");
    if (state.turno && turnos.indexOf(state.turno) === -1) state.turno = "";

    filtroTurno.innerHTML = '<option value="">Todos</option>' +
      turnos.map(function (turno) {
        var qtd = contagemTurno[turno] || 0;
        var rotulo = escapeHtml(turno) + (ativos.length ? " (" + qtd + ")" : "");
        return '<option value="' + escapeHtml(turno) + '"' + (state.turno === turno ? ' selected' : '') + '>' + rotulo + '</option>';
      }).join("");
    filtroTurno.value = state.turno;

    // Lista apenas os cursos que possuem alunos ativos matriculados, em ordem alfabética.
    var contagemCurso = {};
    ativos.forEach(function (a) {
      if (a.curso) contagemCurso[a.curso] = (contagemCurso[a.curso] || 0) + 1;
    });
    var cursos = Object.keys(contagemCurso).sort(function (a, b) {
      return normalizarTexto(a).localeCompare(normalizarTexto(b));
    });
    if (state.curso && cursos.indexOf(state.curso) === -1) state.curso = "";

    filtroCurso.innerHTML = '<option value="">Todos</option>' +
      cursos.map(function (curso) {
        var rotulo = escapeHtml(curso) + " (" + contagemCurso[curso] + ")";
        return '<option value="' + escapeHtml(curso) + '"' + (state.curso === curso ? ' selected' : '') + '>' + rotulo + '</option>';
      }).join("");
    filtroCurso.value = state.curso;
  }

  function renderPillRisco(aluno) {
    var estado = estadoPrevisao(aluno);
    if (estado === "ok") {
      var previsao = obterPrevisao(aluno);
      return '<span class="pill ' + previsao.nivel + '" title="' + escapeHtml(previsao.riskLevel) + '">' + NIVEL_LABEL[previsao.nivel] + ' · ' + previsao.score + '%</span>';
    }
    var textos = {
      incompleto: ["Sem predição", "Dados incompletos"],
      calculando: ["Calculando…", "Consultando o modelo"],
      indisponivel: ["Predição indisponível", state.lote.erro || ""],
      sem: ["Sem predição", ""]
    };
    return '<span class="pill pending" title="' + escapeHtml(textos[estado][1]) + '">' + textos[estado][0] + '</span>';
  }

  function renderLista() {
    var avisoDados = document.getElementById("dados-aviso");
    if (avisoDados) {
      avisoDados.hidden = !state.erroArmazenamento;
      avisoDados.textContent = state.erroArmazenamento || "";
    }
    preencherFiltros();
    renderStatusApi();
    renderTokenAviso();
    renderMacroAviso();
    renderStats();

    var tbody = document.getElementById("students-tbody");
    var emptyState = document.getElementById("empty-state");
    var lista = alunosOrdenados(alunosFiltrados());
    atualizarIndicadoresOrdenacao();
    var totalAtivos = state.alunos.filter(function (a) { return a.status === "ativo"; }).length;

    if (totalAtivos === 0) {
      tbody.innerHTML = "";
      document.getElementById("students-table").style.display = "none";
      emptyState.hidden = false;
      return;
    }
    document.getElementById("students-table").style.display = "";
    emptyState.hidden = true;

    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:32px; text-align:center; color:var(--ink-soft);">Nenhum resultado para essa busca.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map(function (a) {
      return (
        '<tr>' +
        '<td class="cell-name" data-label="Aluno">' +
        '<button data-id="' + a.id + '" class="js-abrir-detalhe">' + escapeHtml(a.nome) + '</button>' +
        '<div class="cell-sub">' + escapeHtml(a.curso) + ' &middot; ' + escapeHtml(a.turno || "Turno não informado") + '</div>' +
        '</td>' +
        '<td class="cell-mono" data-label="Matriculado desde">' + formatarData(a.dataMatricula) + '</td>' +
        '<td class="cell-mono" data-label="Frequência">' + (a.frequencia == null ? "—" : a.frequencia + "%") + '</td>' +
        '<td data-label="Previsão da IA">' + renderPillRisco(a) + '</td>' +
        '<td data-label="Ações">' +
        '<div class="cell-actions">' +
        '<button class="btn-icon js-editar" data-id="' + a.id + '" title="Editar dados" aria-label="Editar aluno"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>' +
        '<button class="btn-icon btn-icon-danger js-excluir" data-id="' + a.id + '" title="Excluir aluno" aria-label="Excluir aluno"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' +
        '</div>' +
        '</td>' +
        '</tr>'
      );
    }).join("");
  }

  /* ---------------- renderização: detalhe ---------------- */

  function buscarAluno(id) {
    return state.alunos.find(function (a) { return a.id === id; }) || null;
  }

  function detalheAberto() {
    return !document.getElementById("view-detail").hidden;
  }

  function abrirDetalhe(id) {
    var aluno = buscarAluno(id);
    if (!aluno) return;

    state.detalhe = { id: id, token: ++sequenciaDetalhe, carregando: false, erro: null };
    document.getElementById("view-list").hidden = true;
    document.getElementById("view-detail").hidden = false;
    renderDetalhe(aluno);
  }

  function fecharDetalhe() {
    state.detalhe = null;
    document.getElementById("view-detail").hidden = true;
    document.getElementById("view-list").hidden = false;
  }

  function atualizarDetalheAberto() {
    if (!state.detalhe || !detalheAberto()) return;
    var aluno = buscarAluno(state.detalhe.id);
    if (aluno) renderDetalhe(aluno);
  }

  function formatarPercentual(probabilidade) {
    return (probabilidade * 100).toFixed(1).replace(".", ",") + "%";
  }

  function renderFaltantes(faltantes) {
    return GRUPOS_PREDICAO.map(function (grupo) {
      var campos = faltantes.filter(function (c) { return c.grupo === grupo; });
      if (!campos.length) return "";
      if (grupo === "Macroeconômicos") return '<li><strong>Macroeconômicos:</strong> configure em <em>Indicadores macro</em> (cabeçalho); valem para todos os alunos.</li>';
      return '<li><strong>' + escapeHtml(grupo) + ':</strong> ' + campos.map(function (c) { return escapeHtml(c.rotulo); }).join("; ") + '</li>';
    }).join("");
  }

  function renderPrevisaoHtml(aluno) {
    var faltantes = camposFaltantes(aluno);
    var detalhe = state.detalhe && state.detalhe.id === aluno.id ? state.detalhe : { carregando: false, erro: null };
    var botao = function (texto, desabilitado) {
      return '<div class="form-actions" style="justify-content:flex-start; margin-top:16px;"><button type="button" class="btn btn-primary js-prever" data-id="' + aluno.id + '"' + (desabilitado ? ' disabled' : '') + '>' + texto + '</button></div>';
    };

    if (faltantes.length) {
      return '<div class="prediction-pending"><strong>Dados incompletos</strong>' +
        '<p>Faltam ' + faltantes.length + ' de ' + CAMPOS_PREDICAO.length + ' campos para prever o risco. Preencha em <em>Editar dados → Dados para predição</em>:</p>' +
        '<ul class="missing-list">' + renderFaltantes(faltantes) + '</ul>' +
        botao("Prever risco", true) + '</div>';
    }
    if (detalhe.carregando) {
      return '<div class="prediction-pending prediction-loading" role="status"><strong>Consultando o modelo…</strong><p>Aguarde a resposta da API.</p>' + botao("Prever risco", true) + '</div>';
    }
    var previsao = obterPrevisao(aluno);
    if (previsao) {
      var pct = Math.max(0, Math.min(100, Math.round(previsao.probabilidade * 100)));
      return '<div class="prediction-result">' +
        '<div class="prediction-head"><span class="pill ' + previsao.nivel + '">' + escapeHtml(previsao.riskLevel) + '</span></div>' +
        '<p class="prediction-percent">' + formatarPercentual(previsao.probabilidade) + '</p>' +
        '<p class="prediction-label">Probabilidade estimada de evasão (dropout_probability)</p>' +
        '<div class="prob-bar" aria-hidden="true"><div class="prob-bar-fill ' + previsao.nivel + '" style="width:' + pct + '%"></div></div>' +
        '<small>' + LEGENDA_MODELO + '</small>' + botao("Prever novamente", false) + '</div>';
    }
    if (detalhe.erro) {
      return '<div class="prediction-pending prediction-error" role="alert"><strong>Predição indisponível</strong><p>' + escapeHtml(detalhe.erro) + '</p>' + botao("Tentar novamente", false) + '</div>';
    }
    return '<div class="prediction-pending"><strong>Previsão ainda não calculada</strong><p>Os dados estão completos. Clique em &ldquo;Prever risco&rdquo; para consultar o modelo.</p>' + botao("Prever risco", false) + '</div>';
  }

  function rotuloSimNao(v) {
    if (v === 1) return "1 (Sim)";
    if (v === 0) return "0 (Não)";
    return "—";
  }

  function rotuloEstadoCivil(v) {
    var item = OPCOES_SIMPLES.marital_status.find(function (o) { return o.codigo === v; });
    return item ? (v + " (" + item.rotulo + ")") : (v == null ? "—" : String(v));
  }

  function renderPayloadPreview(aluno) {
    if (camposFaltantes(aluno).length > 0) return "";
    try {
      var payloadCompleto = montarPayload(aluno);
      return '<details class="payload-preview">' +
        '<summary>Ver payload completo enviado (34 atributos)</summary>' +
        '<pre class="payload-code">' + escapeHtml(JSON.stringify(payloadCompleto, null, 2)) + '</pre>' +
        '</details>';
    } catch (err) {
      return "";
    }
  }

  function renderDetalhe(aluno) {
    var el = document.getElementById("detail-content");
    var dados = aluno.dadosPredicao || {};
    var preenchidos = CAMPOS_PREDICAO.length - camposFaltantes(aluno).length;
    var codModeloCurso = aluno.cursoCodigo ? converterCodigoUciParaIndice("course", aluno.cursoCodigo) : null;
    var unempVal = valorDoCampo(aluno, campoMacro("unemployment_rate"));

    el.innerHTML =
      '<div class="detail-grid">' +
      '<div class="card">' +
      '<div class="profile-row">' +
      '<div>' +
      '<p class="profile-name">' + escapeHtml(aluno.nome) + '</p>' +
      '<p class="profile-meta">' + escapeHtml(aluno.email) + '</p>' +
      '</div>' +
      '</div>' +
      '<div class="meta-grid">' +
      '<div class="meta-item"><span class="meta-label">ID na API (studentId)</span><strong class="meta-value">' + escapeHtml(aluno.studentId || aluno.id) + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Curso (course)</span><strong class="meta-value">' + (codModeloCurso ? "Cód. " + codModeloCurso + " — " : "") + escapeHtml(aluno.curso) + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Estado civil (marital_status)</span><strong class="meta-value">' + escapeHtml(rotuloEstadoCivil(dados.marital_status)) + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Idade na matrícula (age_at_enrollment)</span><strong class="meta-value">' + (dados.age_at_enrollment == null ? "—" : dados.age_at_enrollment + " anos") + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Possui dívida (debtor)</span><strong class="meta-value">' + escapeHtml(rotuloSimNao(dados.debtor)) + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Mensalidades em dia (tuition_fees)</span><strong class="meta-value">' + escapeHtml(rotuloSimNao(dados.tuition_fees_up_to_date)) + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Bolsista (scholarship_holder)</span><strong class="meta-value">' + escapeHtml(rotuloSimNao(dados.scholarship_holder)) + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Taxa de desemprego (unemployment_rate)</span><strong class="meta-value">' + (unempVal == null ? "—" : formatarNumeroBR(unempVal) + "%") + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">1º Semestre (enrolled / approved / grade)</span><strong class="meta-value">' +
      (dados.curricular_units_1st_sem_enrolled == null ? "—" : dados.curricular_units_1st_sem_enrolled + " matr. · " + (dados.curricular_units_1st_sem_approved || 0) + " aprov. · Nota " + formatarNumeroBR(dados.curricular_units_1st_sem_grade || 0)) +
      '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">2º Semestre (enrolled / approved / grade)</span><strong class="meta-value">' +
      (dados.curricular_units_2nd_sem_enrolled == null ? "—" : dados.curricular_units_2nd_sem_enrolled + " matr. · " + (dados.curricular_units_2nd_sem_approved || 0) + " aprov. · Nota " + formatarNumeroBR(dados.curricular_units_2nd_sem_grade || 0)) +
      '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Turno / Matrícula</span><strong class="meta-value">' + escapeHtml(aluno.turno || "Não informado") + " · " + formatarData(aluno.dataMatricula) + '</strong></div>' +
      '<div class="meta-item"><span class="meta-label">Preenchimento do modelo</span><strong class="meta-value">' + preenchidos + ' de ' + CAMPOS_PREDICAO.length + ' atributos prontos</strong></div>' +
      '</div>' +
      renderPayloadPreview(aluno) +
      '<div class="academic-summary"><h3>Acompanhamento acadêmico</h3>' +
      '<div class="academic-grid">' +
      '<div class="academic-item"><span>Frequência</span><strong>' + (aluno.frequencia == null ? "Pendente" : Number(aluno.frequencia).toFixed(1).replace(".", ",") + "%") + '</strong></div>' +
      '<div class="academic-item"><span>Média geral</span><strong>' + (aluno.media == null ? "Pendente" : Number(aluno.media).toFixed(1).replace(".", ",") + " / 10") + '</strong></div>' +
      '<div class="academic-item"><span>Reprovações</span><strong>' + (aluno.disciplinasReprovadas == null ? "Pendente" : aluno.disciplinasReprovadas) + '</strong></div>' +
      '</div>' +
      '</div>' +
      '<div class="form-actions" style="justify-content:flex-start; margin-top:24px;">' +
      '<button class="btn btn-secondary js-editar" data-id="' + aluno.id + '">Editar dados</button>' +
      '<button class="btn btn-danger js-excluir" data-id="' + aluno.id + '">Excluir aluno</button>' +
      '</div>' +
      '</div>' +

      '<div class="card">' +
      '<h2>Previsão de evasão</h2>' +
      renderPrevisaoHtml(aluno) +
      '</div>' +
      '</div>';
  }

  // Dispara /predict para o aluno da ficha. Respostas tardias (outra tela/aluno) não alteram a interface.
  async function executarPrevisaoDetalhe(id) {
    var aluno = buscarAluno(id);
    if (!aluno) return;

    var token = ++sequenciaDetalhe;
    state.detalhe = { id: id, token: token, carregando: true, erro: null };
    renderDetalhe(aluno);

    var erro = null;
    try {
      await preverRisco(aluno);
    } catch (err) {
      erro = err.message || "Falha ao consultar a API.";
    }

    if (!state.detalhe || state.detalhe.token !== token || !detalheAberto()) return;
    state.detalhe.carregando = false;
    state.detalhe.erro = erro;
    var alunoAtual = buscarAluno(id);
    if (alunoAtual) renderDetalhe(alunoAtual);
    renderLista();
  }

  /* ---------------- modais ---------------- */

  function abrirModal(html) {
    elementoComFocoAntesDoModal = document.activeElement;
    document.getElementById("modal-box").innerHTML = html;
    document.getElementById("modal-overlay").hidden = false;
    var primeiroControle = document.querySelector("#modal-box input, #modal-box select, #modal-box button");
    if (primeiroControle) primeiroControle.focus();
  }
  function fecharModal() {
    document.getElementById("modal-overlay").hidden = true;
    document.getElementById("modal-box").innerHTML = "";
    if (elementoComFocoAntesDoModal && document.contains(elementoComFocoAntesDoModal)) {
      elementoComFocoAntesDoModal.focus();
    }
    elementoComFocoAntesDoModal = null;
  }

  function criarAlunoDeExemploDaniel(ex) {
    var cursoObj = cursoPorCodigo(ex.cursoCodigoUci) || CURSOS_DISPONIVEIS[1];
    var dadosPredicao = Object.assign({}, alunoDoPayloadExemplo(PAYLOAD_EXEMPLO_KAIQUE).dadosPredicao, ex.dados);
    dadosPredicao.daytime_evening_attendance = ex.turno === "Noturno" ? 0 : 1;
    dadosPredicao.curricular_units_1st_sem_evaluations = dadosPredicao.curricular_units_1st_sem_enrolled;
    dadosPredicao.curricular_units_2nd_sem_evaluations = dadosPredicao.curricular_units_2nd_sem_enrolled;
    return {
      id: gerarId(),
      studentId: ex.studentId,
      nome: ex.nomeSugerido,
      email: ex.emailSugerido,
      cursoCodigo: cursoObj.codigo,
      curso: cursoObj.nome,
      dataMatricula: hojeISO(),
      turno: ex.turno || "Diurno",
      frequencia: ex.frequencia,
      media: ex.media,
      disciplinasReprovadas: ex.reprovadas,
      unemploymentRate: ex.unemployment_rate,
      dadosPredicao: dadosPredicao,
      versaoDados: VERSAO_DADOS,
      status: "ativo"
    };
  }

  function abrirModalNovoAluno() {
    var alunoPadraoModal = { dataMatricula: hojeISO(), dadosPredicao: {} };
    var studentIdSugerido = "ALUNO-" + gerarId().toUpperCase();

    abrirModal(
      '<h2 id="modal-title">Matricular aluno &amp; Dados do Payload</h2>' +
      '<p class="modal-sub">Preencha os dados cadastrais e confira os <strong>34 atributos da predição</strong>, ou use o exemplo completo do Kaique. Cadastros incompletos podem ser salvos, mas não geram predição.</p>' +
      '<form id="form-novo-aluno">' +
      '<fieldset class="form-section form-section-first"><legend>Identificação do estudante</legend>' +
      '<div class="form-grid">' +
      '<div class="field"><label for="f-nome">Nome completo</label><input id="f-nome" required placeholder="Ex.: Lucas Ferreira" /></div>' +
      '<div class="field"><label for="f-email">E-mail</label><input id="f-email" type="email" required placeholder="Ex.: lucas@escola.com" /></div>' +
      '<div class="field"><label for="f-student-id">ID do aluno na API (<code>studentId</code>)</label><input id="f-student-id" class="input-mono" value="' + escapeHtml(studentIdSugerido) + '" required /></div>' +
      '</div>' +
      '</fieldset>' +
      renderCamposIngresso("f", alunoPadraoModal) +
      renderCamposPredicao("f", alunoPadraoModal) +
      '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
      '<button type="button" class="btn btn-secondary" id="btn-carregar-dupla-daniel" title="Cadastra dois exemplos e consulta a predição de cada um individualmente">Cadastrar e prever dois exemplos</button>' +
      '<button type="submit" class="btn btn-primary">Salvar matrícula</button>' +
      '</div>' +
      '</form>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("btn-carregar-dupla-daniel").addEventListener("click", function () {
      var a1 = criarAlunoDeExemploDaniel(EXEMPLOS_DANIEL.critico1);
      var a2 = criarAlunoDeExemploDaniel(EXEMPLOS_DANIEL.destaque2);
      var anteriores = state.alunos;
      state.alunos = state.alunos.filter(function (a) {
        return a.studentId !== a1.studentId && a.studentId !== a2.studentId && a.email !== a1.email && a.email !== a2.email;
      });
      state.alunos.push(a1, a2);
      if (!salvarDados()) {
        state.alunos = anteriores;
        return;
      }
      fecharModal();
      fecharDetalhe();
      renderLista();
      mostrarToast("Dois exemplos sintéticos cadastrados, com atributos complementares do exemplo do Kaique.");
      atualizarLote();
    });

    document.getElementById("form-novo-aluno").addEventListener("submit", function (e) {
      e.preventDefault();
      var emailDigitado = document.getElementById("f-email").value.trim().toLowerCase();
      var emailJaCadastrado = state.alunos.some(function (a) {
        return a.status === "ativo" && (a.email || "").trim().toLowerCase() === emailDigitado;
      });
      if (emailJaCadastrado) {
        mostrarToast("Já existe um aluno ativo matriculado com este e-mail.", "erro");
        document.getElementById("f-email").focus();
        return;
      }
      var ingresso = lerDadosIngresso("f", null);
      var studentIdDigitado = document.getElementById("f-student-id").value.trim() || "ALUNO-RISCO-EVASAO";
      var dadosPredicao = lerFormularioPredicao("f");
      var unempInd = lerUnemploymentRateIndividual("f");

      var turnoEscolhido = document.getElementById("f-turno").value;
      if (turnoEscolhido === "Diurno") dadosPredicao.daytime_evening_attendance = 1;
      else if (turnoEscolhido === "Noturno") dadosPredicao.daytime_evening_attendance = 0;

      // Calcula indicadores visuais de acompanhamento a partir das notas/aprovações informadas nos 13 campos
      var matrTotal = (dadosPredicao.curricular_units_1st_sem_enrolled || 0) + (dadosPredicao.curricular_units_2nd_sem_enrolled || 0);
      var aprovTotal = (dadosPredicao.curricular_units_1st_sem_approved || 0) + (dadosPredicao.curricular_units_2nd_sem_approved || 0);
      var reprCalculadas = Math.max(0, matrTotal - aprovTotal);
      var media20 = ((dadosPredicao.curricular_units_1st_sem_grade || 0) + (dadosPredicao.curricular_units_2nd_sem_grade || 0)) / 2;
      var media10 = Number((media20 / 2).toFixed(1));
      var freqEstimada = matrTotal > 0 ? Math.round(50 + (aprovTotal / matrTotal) * 44) : 75;

      var novo = {
        id: gerarId(),
        studentId: studentIdDigitado,
        nome: document.getElementById("f-nome").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        cursoCodigo: ingresso.cursoCodigo,
        curso: ingresso.curso,
        dataMatricula: ingresso.dataMatricula,
        turno: turnoEscolhido,
        frequencia: freqEstimada,
        media: media10,
        disciplinasReprovadas: reprCalculadas,
        unemploymentRate: unempInd,
        dadosPredicao: dadosPredicao,
        versaoDados: VERSAO_DADOS,
        status: "ativo"
      };
      sincronizarTurno(novo);
      state.alunos.push(novo);
      if (!salvarDados()) {
        state.alunos.pop();
        return;
      }
      renderLista();
      fecharModal();
      mostrarToast("Aluno matriculado com sucesso.");
      abrirDetalhe(novo.id);
      if (state.apiConfig && state.apiConfig.token && camposFaltantes(novo).length === 0) {
        executarPrevisaoDetalhe(novo.id);
      }
    });
  }

  function abrirModalEditar(id) {
    var aluno = buscarAluno(id);
    if (!aluno) return;

    abrirModal(
      '<h2 id="modal-title">Editar aluno</h2>' +
      '<p class="modal-sub">Atualize os dados cadastrais, os 34 atributos do payload da API e os indicadores acadêmicos.</p>' +
      '<form id="form-editar-aluno">' +
      '<fieldset class="form-section form-section-first"><legend>Dados cadastrais</legend><div class="form-grid">' +
      '<div class="field"><label for="e-nome">Nome completo</label><input id="e-nome" value="' + escapeHtml(aluno.nome) + '" required /></div>' +
      '<div class="field"><label for="e-email">E-mail</label><input id="e-email" type="email" value="' + escapeHtml(aluno.email) + '" required /></div>' +
      '<div class="field"><label for="e-student-id">ID do aluno na API (<code>studentId</code>)</label><input id="e-student-id" class="input-mono" value="' + escapeHtml(aluno.studentId || aluno.id) + '" required /></div>' +
      '</div></fieldset>' +
      renderCamposIngresso("e", aluno) +
      renderCamposPredicao("e", aluno) +
      renderCamposAcademicos("e", aluno) +
      '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Salvar alterações</button>' +
      '</div>' +
      '</form>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("form-editar-aluno").addEventListener("submit", function (e) {
      e.preventDefault();
      var emailDigitado = document.getElementById("e-email").value.trim().toLowerCase();
      var emailJaCadastrado = state.alunos.some(function (a) {
        return a.id !== aluno.id && a.status === "ativo" && (a.email || "").trim().toLowerCase() === emailDigitado;
      });
      if (emailJaCadastrado) {
        mostrarToast("Este e-mail já pertence a outro aluno matriculado.", "erro");
        document.getElementById("e-email").focus();
        return;
      }
      var atualizado = Object.assign({}, aluno);
      atualizado.nome = document.getElementById("e-nome").value.trim();
      atualizado.email = document.getElementById("e-email").value.trim();
      var elStudentId = document.getElementById("e-student-id");
      if (elStudentId && elStudentId.value.trim()) atualizado.studentId = elStudentId.value.trim();
      var ingresso = lerDadosIngresso("e", atualizado);
      Object.keys(ingresso).forEach(function (chave) { atualizado[chave] = ingresso[chave]; });
      atualizado.dadosPredicao = lerFormularioPredicao("e");
      var unempInd = lerUnemploymentRateIndividual("e");
      atualizado.unemploymentRate = unempInd;
      sincronizarTurno(atualizado);
      var academicos = lerDadosAcademicos("e");
      Object.keys(academicos).forEach(function (chave) { atualizado[chave] = academicos[chave]; });
      var anteriores = state.alunos;
      state.alunos = anteriores.map(function (a) { return a.id === aluno.id ? atualizado : a; });
      if (!salvarDados()) {
        state.alunos = anteriores;
        return;
      }
      aluno = atualizado;
      // Só invalida a ficha depois que a edição foi gravada.
      if (state.detalhe && state.detalhe.id === aluno.id) {
        state.detalhe = { id: aluno.id, token: ++sequenciaDetalhe, carregando: false, erro: null };
      }
      preencherFiltros();
      renderLista();
      fecharModal();
      mostrarToast("Dados atualizados.");
      if (detalheAberto()) {
        renderDetalhe(aluno);
      }
      atualizarLote();
    });
  }

  function abrirModalExcluir(id) {
    var aluno = buscarAluno(id);
    if (!aluno) return;

    abrirModal(
      '<h2 id="modal-title">Excluir cadastro</h2>' +
      '<p class="modal-sub">Tem certeza de que deseja excluir o registro de <strong>' + escapeHtml(aluno.nome) + '</strong>? Essa ação não pode ser desfeita.</p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" id="btn-cancelar-modal">Cancelar</button>' +
      '<button type="button" class="btn btn-danger" id="btn-confirmar-excluir">Excluir</button>' +
      '</div>'
    );

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    document.getElementById("btn-confirmar-excluir").addEventListener("click", function () {
      var alunosAnteriores = state.alunos;
      state.alunos = state.alunos.filter(function (a) { return a.id !== id; });
      if (!salvarDados()) {
        state.alunos = alunosAnteriores;
        return;
      }
      fecharModal();
      mostrarToast("Aluno excluído.");
      fecharDetalhe();
      renderLista();
    });
  }

  /* ---------------- eventos globais ---------------- */

  document.getElementById("btn-new-student").addEventListener("click", abrirModalNovoAluno);
  document.getElementById("btn-empty-new").addEventListener("click", abrirModalNovoAluno);
  document.getElementById("btn-exportar").addEventListener("click", exportarDados);
  document.getElementById("btn-importar").addEventListener("click", function () {
    document.getElementById("input-importar").click();
  });
  document.getElementById("input-importar").addEventListener("change", function (e) {
    var arquivo = e.target.files && e.target.files[0];
    e.target.value = "";
    if (arquivo) importarArquivo(arquivo);
  });
  document.getElementById("api-badge").addEventListener("click", abrirModalApiConfig);
  var btnApiConfig = document.getElementById("btn-api-config");
  if (btnApiConfig) btnApiConfig.addEventListener("click", abrirModalApiConfig);
  document.getElementById("btn-macro").addEventListener("click", abrirModalMacro);

  document.getElementById("btn-back").addEventListener("click", function () {
    fecharDetalhe();
    renderLista();
  });

  document.getElementById("search-input").addEventListener("input", function (e) {
    state.query = e.target.value;
    renderLista();
  });

  document.getElementById("filtro-risco").addEventListener("change", function (e) {
    state.risco = e.target.value;
    renderLista();
  });
  document.getElementById("filtro-turno").addEventListener("change", function (e) {
    state.turno = e.target.value;
    renderLista();
  });
  document.getElementById("filtro-curso").addEventListener("change", function (e) {
    state.curso = e.target.value;
    renderLista();
  });
  document.getElementById("btn-limpar-filtros").addEventListener("click", function () {
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

  document.querySelectorAll(".sort-button").forEach(function (botao) {
    botao.addEventListener("click", function () {
      var campo = botao.getAttribute("data-sort");
      state.ordenacao.direcao = state.ordenacao.campo === campo
        ? (state.ordenacao.direcao === "asc" ? "desc" : "asc")
        : direcaoInicialOrdenacao(campo);
      state.ordenacao.campo = campo;
      renderLista();
    });
  });

  document.getElementById("modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "modal-overlay") fecharModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !document.getElementById("modal-overlay").hidden) fecharModal();
  });

  document.addEventListener("click", function (e) {
    var abrir = e.target.closest(".js-abrir-detalhe");
    if (abrir) { abrirDetalhe(abrir.getAttribute("data-id")); return; }

    var editar = e.target.closest(".js-editar");
    if (editar) { abrirModalEditar(editar.getAttribute("data-id")); return; }

    var excluir = e.target.closest(".js-excluir");
    if (excluir) { abrirModalExcluir(excluir.getAttribute("data-id")); return; }

    var prever = e.target.closest(".js-prever");
    if (prever) { executarPrevisaoDetalhe(prever.getAttribute("data-id")); return; }

    var exemploKaique = e.target.closest(".js-exemplo-kaique");
    if (exemploKaique) { preencherExemploKaique(exemploKaique.getAttribute("data-prefixo")); return; }

    var exemploDaniel = e.target.closest(".js-exemplo-daniel");
    if (exemploDaniel) { preencherExemploDaniel(exemploDaniel.getAttribute("data-prefixo"), exemploDaniel.getAttribute("data-exemplo")); return; }

    var exemplo = e.target.closest(".js-exemplo");
    if (exemplo) { preencherPerfilExemplo(exemplo.getAttribute("data-prefixo"), exemplo.getAttribute("data-perfil")); return; }

    if (e.target.closest(".js-tentar-lote")) { atualizarLote(); return; }

    if (e.target.closest(".js-abrir-macro")) { abrirModalMacro(); return; }

    if (e.target.closest(".js-abrir-api-config")) { abrirModalApiConfig(); return; }
  });

  /* ---------------- inicialização ---------------- */

  state.apiConfig = apiConfigService.carregar();
  if (state.apiConfig && state.apiConfig.token) {
    state.api = { status: "configurado", detalhe: "Chave salva; nenhuma predição foi verificada nesta sessão." };
  }
  state.macro = macroService.carregar() || { unemployment_rate: 10.8, inflation_rate: 1.4, gdp: 1.74 };
  carregarDados();
  preencherFiltros();
  state.loaded = true;
  renderLista();
  renderBadgeApi();
  if (state.apiConfig && state.apiConfig.token) {
    atualizarLote();
  }

  // Gancho de teste: só existe se a página definir window.__EXPOR_TESTE__ antes de carregar.
  if (window.__EXPOR_TESTE__) {
    window.__teste = {
      montarFeatures: montarFeatures,
      montarPayload: montarPayload,
      apiConfigService: apiConfigService,
      camposFaltantes: camposFaltantes,
      preverRisco: preverRisco,
      converterCodigoUciParaIndice: converterCodigoUciParaIndice,
      CAMPOS_PREDICAO: CAMPOS_PREDICAO,
      converterRespostaApi: converterRespostaApi,
      chamarApi: chamarApi,
      migrarAluno: migrarAluno,
      alunosService: alunosService,
      gerarAlunosExemplo: gerarAlunosExemplo,
      VERSAO_DADOS: VERSAO_DADOS,
      verificarSaudeApi: verificarSaudeApi,
      macroService: macroService,
      validarMacro: validarMacro,
      avisosFaixaMacro: avisosFaixaMacro,
      extrairMacroBackup: extrairMacroBackup,
      valorDoCampo: valorDoCampo,
      preencherFiltros: preencherFiltros,
      interpretarBackup: interpretarBackup,
      combinarAlunos: combinarAlunos,
      montarBackup: montarBackup,
      renderPayloadPreview: renderPayloadPreview,
      alunoDoPayloadExemplo: alunoDoPayloadExemplo,
      preencherExemploKaique: preencherExemploKaique,
      lerFormularioPredicao: lerFormularioPredicao,
      renderCamposPredicao: renderCamposPredicao,
      renderBadgeApi: renderBadgeApi,
      carregarDados: carregarDados,
      salvarDados: salvarDados,
      abrirModalNovoAluno: abrirModalNovoAluno,
      abrirModalEditar: abrirModalEditar,
      abrirModalApiConfig: abrirModalApiConfig,
      aplicarImportacao: aplicarImportacao,
      state: state
    };
  }

})();
