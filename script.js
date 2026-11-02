(function(){
  "use strict";

  /* ---------------- configuração da API de predição ---------------- */

  // Endereço da API FastAPI. Se a API rodar em outra máquina, troque aqui
  // (ex.: "http://192.168.0.10:8000") e inicie a API com --host 0.0.0.0.
  var API_BASE_URL = "http://127.0.0.1:8000";
  var API_TIMEOUT_MS = 20000;
  var VERSAO_DADOS = 5;
  var LEGENDA_MODELO = "Predição do modelo (Regressão Logística, acurácia 86,67%) — estimativa estatística, não certeza.";

  var CURSOS_DISPONIVEIS = CATALOGOS.course.map(function(curso){
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

  function definirCampo(chave, rotulo, tipo, grupo, extra){
    var campo = { chave: chave, rotulo: rotulo, tipo: tipo, grupo: grupo, min: null, max: null, opcoes: null, cadastro: false };
    Object.keys(extra || {}).forEach(function(k){ campo[k] = extra[k]; });
    if(tipo === "catalogo" && !campo.opcoes) campo.opcoes = CATALOGOS[chave];
    if(tipo === "inteiro" && campo.min == null){ campo.min = 0; campo.max = 60; }
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

  ["1st", "2nd"].forEach(function(sem){
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
    macro: null,
    lote: { status: "ocioso", erro: null, seq: 0 },
    detalhe: null
  };
  var sequenciaDetalhe = 0;
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

  /* ---------------- indicadores macroeconômicos (configuração global) ---------------- */

  // Desemprego, inflação e PIB são indicadores do período, iguais para todos os alunos:
  // ficam numa configuração única (não por aluno) e entram no payload via valorDoCampo().
  var MACRO_KEY = "config-macro";
  var CAMPOS_MACRO = ["unemployment_rate", "inflation_rate", "gdp"];
  // Faixas observadas no dataset de treino; fora delas a predição é uma extrapolação.
  var FAIXA_TREINO = { unemployment_rate: [7.6, 16.2], inflation_rate: [-0.8, 3.7], gdp: [-4.06, 3.51] };

  function campoMacro(chave){
    return CAMPOS_PREDICAO.filter(function(c){ return c.chave === chave; })[0];
  }

  // Devolve a configuração normalizada ({3 chaves}) ou null se faltar/estiver inválido algum valor.
  function validarMacro(config){
    if(!config || typeof config !== "object") return null;
    var limpo = {};
    for(var i = 0; i < CAMPOS_MACRO.length; i++){
      var chave = CAMPOS_MACRO[i];
      if(!valorValido(campoMacro(chave), config[chave])) return null;
      limpo[chave] = config[chave];
    }
    return limpo;
  }

  function formatarNumeroBR(n){ return String(n).replace(".", ","); }

  function avisosFaixaMacro(config){
    var avisos = [];
    CAMPOS_MACRO.forEach(function(chave){
      var v = config ? config[chave] : null;
      var faixa = FAIXA_TREINO[chave];
      if(typeof v === "number" && isFinite(v) && (v < faixa[0] || v > faixa[1])){
        avisos.push(campoMacro(chave).rotulo + ": " + formatarNumeroBR(v) + " está fora da faixa vista no treino (" +
          formatarNumeroBR(faixa[0]) + " a " + formatarNumeroBR(faixa[1]) + ").");
      }
    });
    return avisos;
  }

  var macroService = {
    carregar: function(){
      try{
        var raw = localStorage.getItem(MACRO_KEY);
        return raw ? validarMacro(JSON.parse(raw)) : null;
      }catch(err){
        return null;
      }
    },
    salvar: function(config){
      localStorage.setItem(MACRO_KEY, JSON.stringify(config));
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
      return '<option value="' + curso.codigo + '"' + (curso.codigo === selecionado ? ' selected' : '') + '>' + escapeHtml(curso.nome) + ' · cód. ' + curso.codigo + '</option>';
    }).join("");
  }

  function renderCamposIngresso(prefixo, aluno){
    aluno = aluno || {};
    var cursoSelecionado = Number(aluno.cursoCodigo) || "";
    var cursoOptions = opcoesCurso(cursoSelecionado, aluno.curso);
    var campoTurno = "";
    if(prefixo === "f"){
      var turnoOptions = '<option value="">Selecione o turno</option>' + TURNOS_DISPONIVEIS.map(function(t){
        return '<option value="' + escapeHtml(t) + '"' + (aluno.turno === t ? ' selected' : '') + '>' + escapeHtml(t) + '</option>';
      }).join("");
      campoTurno = '<div class="field"><label for="' + prefixo + '-turno">Turno</label><select id="' + prefixo + '-turno" required>' + turnoOptions + '</select></div>';
    }

    return '<fieldset class="form-section">' +
      '<legend>Dados de matrícula</legend>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="' + prefixo + '-curso">Curso</label><select id="' + prefixo + '-curso" required>' + cursoOptions + '</select><span class="field-hint">Catálogo do modelo (rótulo + código UCI).</span></div>' +
        campoTurno +
        '<div class="field"><label for="' + prefixo + '-data">Data de matrícula</label><input id="' + prefixo + '-data" type="date" value="' + escapeHtml(aluno.dataMatricula || hojeISO()) + '" required /></div>' +
      '</div>' +
    '</fieldset>';
  }

  function renderCamposAcademicos(prefixo, aluno){
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

    var cursoValue = valor("curso");
    var curso = cursoValue === "legacy" ? null : cursoPorCodigo(cursoValue);

    return {
      cursoCodigo: curso ? curso.codigo : (alunoAnterior ? alunoAnterior.cursoCodigo || null : null),
      curso: curso ? curso.nome : (alunoAnterior ? alunoAnterior.curso : ""),
      dataMatricula: valor("data")
    };
  }

  /* ---------------- dados para predição: formulário ---------------- */

  function valorDoCampo(aluno, campo){
    var valor;
    if(campo.chave === "course") valor = aluno.cursoCodigo;
    else if(campo.global) valor = state.macro ? state.macro[campo.chave] : null;
    else valor = (aluno.dadosPredicao || {})[campo.chave];
    return valor == null || valor === "" ? null : valor;
  }

  function renderCampoPredicao(prefixo, campo, aluno){
    var id = prefixo + "-p-" + campo.chave;
    var valor = valorDoCampo(aluno, campo);
    var controle;
    if(campo.tipo === "catalogo" || campo.tipo === "opcao"){
      controle = '<select id="' + id + '"><option value="">Selecione</option>' + campo.opcoes.map(function(opcao){
        return '<option value="' + opcao.codigo + '"' + (valor === opcao.codigo ? ' selected' : '') + '>' + escapeHtml(opcao.rotulo) + '</option>';
      }).join("") + '</select>';
    }else{
      controle = '<input id="' + id + '" type="number" min="' + campo.min + '" max="' + campo.max + '" step="' + (campo.tipo === "inteiro" ? "1" : "any") + '" value="' + (valor == null ? "" : valor) + '" />';
    }
    return '<div class="field"><label for="' + id + '">' + escapeHtml(campo.rotulo) + '</label>' + controle + '</div>';
  }

  function renderCamposPredicao(prefixo, aluno){
    var blocos = GRUPOS_PREDICAO.map(function(grupo){
      var campos = CAMPOS_PREDICAO.filter(function(c){ return c.grupo === grupo && !c.cadastro && !c.global; });
      if(!campos.length) return "";
      return '<div class="predict-group"><h4>' + escapeHtml(grupo) + '</h4><div class="form-grid">' +
        campos.map(function(c){ return renderCampoPredicao(prefixo, c, aluno); }).join("") +
      '</div></div>';
    }).join("");

    var botoes = Object.keys(PERFIS_EXEMPLO).map(function(chave){
      return '<button type="button" class="btn btn-secondary js-exemplo" data-prefixo="' + prefixo + '" data-perfil="' + chave + '">' + escapeHtml(PERFIS_EXEMPLO[chave].rotulo) + '</button>';
    }).join("");

    return '<fieldset class="form-section">' +
      '<legend>Dados para predição</legend>' +
      '<p class="form-section-note">Todos os campos são obrigatórios para prever o risco; sem eles a previsão não é feita. O curso é escolhido em &ldquo;Dados de matrícula&rdquo;.</p>' +
      '<div class="example-actions"><span>Carregar perfil de exemplo (linha real do dataset):</span>' + botoes + '</div>' +
      blocos +
    '</fieldset>';
  }

  function lerFormularioPredicao(prefixo){
    var dados = {};
    CAMPOS_PREDICAO.forEach(function(campo){
      if(campo.cadastro || campo.global) return;
      var valor = document.getElementById(prefixo + "-p-" + campo.chave).value;
      dados[campo.chave] = valor === "" ? null : Number(valor);
    });
    return dados;
  }

  function preencherPerfilExemplo(prefixo, chavePerfil){
    var perfil = PERFIS_EXEMPLO[chavePerfil];
    if(!perfil) return;
    CAMPOS_PREDICAO.forEach(function(campo){
      if(campo.global) return;
      var el = document.getElementById(campo.cadastro ? prefixo + "-curso" : prefixo + "-p-" + campo.chave);
      if(el) el.value = String(perfil.dados[campo.chave]);
    });
    mostrarToast("Perfil de exemplo carregado (" + perfil.rotulo.toLowerCase() + "). Salve para aplicar.");
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

  /* ---------------- validação e payload ---------------- */

  function valorValido(campo, valor){
    if(typeof valor !== "number" || !isFinite(valor)) return false;
    if(campo.tipo === "catalogo" || campo.tipo === "opcao"){
      return campo.opcoes.some(function(opcao){ return opcao.codigo === valor; });
    }
    if(campo.tipo === "inteiro" && Math.floor(valor) !== valor) return false;
    if(campo.min != null && valor < campo.min) return false;
    if(campo.max != null && valor > campo.max) return false;
    return true;
  }

  // Devolve os campos (do esquema) ausentes ou inválidos. Lista vazia = dados completos.
  function camposFaltantes(aluno){
    return CAMPOS_PREDICAO.filter(function(campo){
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
  function converterCodigoUciParaIndice(chave, codigoUci){
    var lista = CATALOGOS[chave];
    if(!lista) return codigoUci;
    for(var i = 0; i < lista.length; i++){
      if(lista[i].codigo === codigoUci) return i + 1;
    }
    return null;
  }

  // Monta os 34 campos exigidos pela API. Lança erro se faltar qualquer dado (sem padrões).
  function montarPayload(aluno){
    var faltantes = camposFaltantes(aluno);
    if(faltantes.length){
      throw new Error("Dados incompletos: " + faltantes.map(function(c){ return c.rotulo; }).join(", "));
    }
    var payload = {};
    CAMPOS_PREDICAO.forEach(function(campo){
      var valor = valorDoCampo(aluno, campo);
      payload[campo.chave] = campo.tipo === "catalogo" ? converterCodigoUciParaIndice(campo.chave, valor) : valor;
    });
    return payload;
  }

  function hashDados(texto){
    var h = 5381;
    for(var i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function chaveCache(aluno, payload){
    return aluno.id + ":" + hashDados(JSON.stringify(payload));
  }

  /* ---------------- comunicação com a API ---------------- */

  function erroApi(tipo, mensagem){
    var erro = new Error(mensagem);
    erro.tipoErro = tipo;
    return erro;
  }

  function mensagemHttp(status, dados){
    var detalhe = dados && dados.detail;
    if(status === 422 && Array.isArray(detalhe)){
      return "A API recusou os dados (HTTP 422): " + detalhe.map(function(item){
        var local = Array.isArray(item.loc) ? item.loc.filter(function(p){ return p !== "body"; }).join(".") : "";
        return (local ? local + ": " : "") + item.msg;
      }).join("; ");
    }
    if(typeof detalhe === "string") return "A API retornou HTTP " + status + ": " + detalhe;
    return "A API retornou HTTP " + status + ".";
  }

  async function chamarApi(caminho, corpo){
    var controlador = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function(){ if(controlador) controlador.abort(); }, API_TIMEOUT_MS);
    var resposta;
    try{
      resposta = await fetch(API_BASE_URL + caminho, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: controlador ? controlador.signal : undefined
      });
    }catch(err){
      throw erroApi("rede", err && err.name === "AbortError"
        ? "A API não respondeu em " + (API_TIMEOUT_MS / 1000) + " s."
        : "Não foi possível conectar à API em " + API_BASE_URL + ".");
    }finally{
      clearTimeout(timer);
    }
    var dados = null;
    try{ dados = await resposta.json(); }catch(err){ dados = null; }
    if(!resposta.ok) throw erroApi("http", mensagemHttp(resposta.status, dados));
    return dados;
  }

  var NIVEL_API = { "Baixo Risco": "low", "Médio Risco": "mid", "Alto Risco de Evasão": "high" };

  // Converte uma predição da API em {score, nivel, ...}; nunca aceita resposta fora do contrato.
  function converterRespostaApi(resposta){
    var p = resposta && resposta.dropout_probability;
    var nivel = resposta ? NIVEL_API[resposta.risk_level] : null;
    if(typeof p !== "number" || !isFinite(p) || p < 0 || p > 1 || !nivel){
      throw erroApi("resposta", "A API devolveu uma resposta em formato inesperado.");
    }
    return {
      score: Math.round(p * 100),
      nivel: nivel,
      probabilidade: p,
      riskLevel: resposta.risk_level,
      modelo: resposta.model_used || null,
      acuracia: typeof resposta.model_accuracy === "number" ? resposta.model_accuracy : null,
      evasaoPrevista: resposta.prediction === 1
    };
  }

  async function preverRisco(aluno){
    var payload = montarPayload(aluno);
    var resultado = converterRespostaApi(await chamarApi("/predict", payload));
    state.predicoes[chaveCache(aluno, payload)] = resultado;
    return resultado;
  }

  async function preverLote(alunos){
    var payloads = alunos.map(montarPayload);
    var dados = await chamarApi("/predict/batch", { students: payloads });
    if(!dados || !Array.isArray(dados.predictions) || dados.predictions.length !== payloads.length){
      throw erroApi("resposta", "A API devolveu um lote em formato inesperado.");
    }
    var resultados = dados.predictions.map(converterRespostaApi);
    alunos.forEach(function(aluno, i){
      state.predicoes[chaveCache(aluno, payloads[i])] = resultados[i];
    });
  }

  /* ---------------- previsões em cache (lista e contadores) ---------------- */

  function obterPrevisao(aluno){
    if(camposFaltantes(aluno).length) return null;
    return state.predicoes[chaveCache(aluno, montarPayload(aluno))] || null;
  }

  function estadoPrevisao(aluno){
    if(camposFaltantes(aluno).length) return "incompleto";
    if(obterPrevisao(aluno)) return "ok";
    if(state.lote.status === "carregando") return "calculando";
    if(state.lote.status === "erro") return "indisponivel";
    return "sem";
  }

  // Uma única chamada /predict/batch para os alunos ativos, completos e ainda sem cache.
  async function atualizarLote(){
    var pendentes = state.alunos.filter(function(a){
      return a.status === "ativo" && camposFaltantes(a).length === 0 && !obterPrevisao(a);
    });
    if(!pendentes.length){
      if(state.lote.status === "erro") state.lote.status = "ocioso";
      renderLista();
      return;
    }
    var minhaSeq = ++state.lote.seq;
    state.lote.status = "carregando";
    state.lote.erro = null;
    renderLista();
    try{
      await preverLote(pendentes);
      if(minhaSeq === state.lote.seq) state.lote.status = "ocioso";
    }catch(err){
      if(minhaSeq === state.lote.seq){
        state.lote.status = "erro";
        state.lote.erro = err.message;
      }
    }
    renderLista();
    atualizarDetalheAberto();
  }

  /* ---------------- painel: indicadores macroeconômicos ---------------- */

  function textoMacro(){
    if(!state.macro) return "não configurados";
    return "desemprego " + formatarNumeroBR(state.macro.unemployment_rate) + "% · inflação " +
      formatarNumeroBR(state.macro.inflation_rate) + "% · PIB " + formatarNumeroBR(state.macro.gdp) + "%";
  }

  function renderMacroAviso(){
    var el = document.getElementById("macro-aviso");
    if(!el) return;
    if(state.macro){
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = '<strong>Indicadores macroeconômicos não configurados.</strong> Sem eles não há predição para nenhum aluno. ' +
      '<button type="button" class="btn-link js-abrir-macro">Configurar agora</button>';
  }

  function abrirModalMacro(){
    var atual = state.macro || {};
    var campos = CAMPOS_PREDICAO.filter(function(c){ return c.global; });
    var inputs = campos.map(function(c){
      var faixa = FAIXA_TREINO[c.chave];
      return '<div class="field"><label for="m-' + c.chave + '">' + escapeHtml(c.rotulo) + '</label>' +
        '<input id="m-' + c.chave + '" type="number" step="any" min="' + c.min + '" max="' + c.max + '" value="' +
        (atual[c.chave] == null ? "" : atual[c.chave]) + '" required />' +
        '<span class="field-hint">Faixa vista no treino: ' + formatarNumeroBR(faixa[0]) + ' a ' + formatarNumeroBR(faixa[1]) + '</span></div>';
    }).join("");
    var exemplos = '<option value="">Escolher…</option>' + MACRO_EXEMPLOS.map(function(e, i){
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

    function lerCampos(){
      var valores = {};
      CAMPOS_MACRO.forEach(function(chave){
        var v = document.getElementById("m-" + chave).value;
        valores[chave] = v === "" ? null : Number(v);
      });
      return valores;
    }
    function atualizarAlerta(){
      var avisos = avisosFaixaMacro(lerCampos());
      var el = document.getElementById("macro-alerta");
      el.hidden = !avisos.length;
      el.innerHTML = avisos.length ? '<strong>Atenção (não impede salvar):</strong><br>' + avisos.map(escapeHtml).join("<br>") : "";
    }

    document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
    CAMPOS_MACRO.forEach(function(chave){
      document.getElementById("m-" + chave).addEventListener("input", atualizarAlerta);
    });
    document.getElementById("m-exemplo").addEventListener("change", function(e){
      var exemplo = MACRO_EXEMPLOS[Number(e.target.value)];
      if(!exemplo) return;
      CAMPOS_MACRO.forEach(function(chave){ document.getElementById("m-" + chave).value = exemplo[chave]; });
      atualizarAlerta();
    });
    atualizarAlerta();

    document.getElementById("form-macro").addEventListener("submit", function(e){
      e.preventDefault();
      var config = validarMacro(lerCampos());
      if(!config){
        mostrarToast("Preencha os três indicadores com valores válidos.", "erro");
        return;
      }
      try{
        macroService.salvar(config);
      }catch(err){
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
    verificando: "API: verificando…",
    online: "API online",
    offline: "API offline",
    modelo: "API sem modelo"
  };

  // Consulta GET /health. Resultado em state.api.status: online | offline | modelo.
  async function verificarSaudeApi(){
    var controlador = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function(){ if(controlador) controlador.abort(); }, API_HEALTH_TIMEOUT_MS);
    state.api = { status: "verificando", detalhe: null };
    renderBadgeApi();
    try{
      var resposta = await fetch(API_BASE_URL + "/health", { signal: controlador ? controlador.signal : undefined });
      var dados = null;
      try{ dados = await resposta.json(); }catch(err){ dados = null; }
      if(!resposta.ok){
        state.api = { status: "offline", detalhe: "A API respondeu HTTP " + resposta.status + " em /health." };
      }else if(dados && dados.status === "healthy" && dados.model_loaded === true){
        state.api = { status: "online", detalhe: "Modelo carregado e pronto." };
      }else{
        state.api = { status: "modelo", detalhe: "A API respondeu, mas o modelo não está carregado." };
      }
    }catch(err){
      state.api = { status: "offline", detalhe: "Não foi possível conectar à API em " + API_BASE_URL + "." };
    }finally{
      clearTimeout(timer);
    }
    renderBadgeApi();
    return state.api.status;
  }

  function renderBadgeApi(){
    var el = document.getElementById("api-badge");
    if(!el) return;
    var status = state.api.status;
    el.className = "api-badge " + status;
    el.textContent = ROTULOS_API[status] || ROTULOS_API.desconhecido;
    el.title = (state.api.detalhe ? state.api.detalhe + " " : "") + "Clique para verificar novamente.";
  }

  async function reverificarApi(){
    var status = await verificarSaudeApi();
    if(status === "online") atualizarLote();
  }

  /* ---------------- backup: exportar e importar ---------------- */

  function montarBackup(){
    return { versaoDados: VERSAO_DADOS, exportadoEm: new Date().toISOString(), configMacro: state.macro, alunos: state.alunos };
  }

  function exportarDados(){
    var texto = JSON.stringify(montarBackup(), null, 2);
    var blob = new Blob([texto], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "alunos-backup-" + hojeISO() + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    mostrarToast("Backup exportado (" + state.alunos.length + " aluno(s)).");
  }

  // Valida o conteúdo de um backup e devolve a lista já migrada. Lança Error se algo estiver inválido;
  // nada é alterado em state aqui (validação completa antes de qualquer mudança).
  function interpretarBackup(texto){
    var dados;
    try{ dados = JSON.parse(texto); }catch(err){ throw new Error("O arquivo não é um JSON válido."); }
    var lista = Array.isArray(dados) ? dados : (dados && dados.alunos);
    if(!Array.isArray(lista)) throw new Error("Formato não reconhecido: esperada uma lista de alunos.");
    if(!Array.isArray(dados) && typeof dados.versaoDados === "number" && dados.versaoDados > VERSAO_DADOS){
      throw new Error("O backup foi gerado por uma versão mais nova da plataforma (dados v" + dados.versaoDados + ").");
    }
    if(!lista.length) throw new Error("O backup não contém nenhum aluno.");
    var ids = {};
    return lista.map(function(aluno, i){
      if(!aluno || typeof aluno !== "object" || typeof aluno.nome !== "string" || !aluno.nome.trim() || typeof aluno.curso !== "string"){
        throw new Error("Registro " + (i + 1) + " inválido: nome e curso são obrigatórios.");
      }
      var migrado = migrarAluno(aluno);
      if(!migrado.id || ids[migrado.id]) migrado.id = gerarId();
      ids[migrado.id] = true;
      if(!migrado.status) migrado.status = "ativo";
      sincronizarTurno(migrado);
      return migrado;
    });
  }

  // modo "substituir": só os importados; "mesclar": mantém os atuais e sobrescreve os de mesmo id.
  function combinarAlunos(atuais, importados, modo){
    if(modo === "substituir") return importados.slice();
    var porId = {};
    importados.forEach(function(a){ porId[a.id] = a; });
    var usados = {};
    var resultado = atuais.map(function(a){
      if(porId[a.id]){ usados[a.id] = true; return porId[a.id]; }
      return a;
    });
    importados.forEach(function(a){ if(!usados[a.id]) resultado.push(a); });
    return resultado;
  }

  // Configuração macro do backup (ou null se ausente/inválida).
  function extrairMacroBackup(texto){
    try{
      var dados = JSON.parse(texto);
      return dados && !Array.isArray(dados) ? validarMacro(dados.configMacro) : null;
    }catch(err){
      return null;
    }
  }

  function aplicarImportacao(importados, modo, macro){
    var anteriores = state.alunos;
    state.alunos = combinarAlunos(anteriores, importados, modo);
    if(!salvarDados()){
      state.alunos = anteriores;
      return false;
    }
    // Os indicadores do backup só valem em "substituir" ou quando ainda não há configuração.
    if(macro && (modo === "substituir" || !state.macro)){
      try{ macroService.salvar(macro); state.macro = macro; }catch(err){ mostrarToast("Alunos importados, mas os indicadores macro não puderam ser salvos.", "erro"); }
    }
    state.predicoes = {};
    fecharModal();
    fecharDetalhe();
    renderLista();
    mostrarToast("Importação concluída (" + state.alunos.length + " aluno(s) na lista).");
    atualizarLote();
    return true;
  }

  function abrirModalImportar(importados, nomeArquivo, macro){
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
    document.getElementById("btn-importar-mesclar").addEventListener("click", function(){ aplicarImportacao(importados, "mesclar", macro); });
    document.getElementById("btn-importar-substituir").addEventListener("click", function(){ aplicarImportacao(importados, "substituir", macro); });
  }

  async function importarArquivo(arquivo){
    try{
      var texto = await arquivo.text();
      abrirModalImportar(interpretarBackup(texto), arquivo.name, extrairMacroBackup(texto));
    }catch(err){
      mostrarToast("Importação cancelada: " + err.message, "erro");
    }
  }

  var NIVEL_LABEL = { low: "Risco baixo", mid: "Risco médio", high: "Risco alto" };

  /* ---------------- armazenamento ---------------- */

  function migrarAluno(aluno){
    // v4 -> v5: os indicadores macro deixaram de ser por aluno (agora são globais).
    if(aluno.versaoDados === 4 && aluno.dadosPredicao && typeof aluno.dadosPredicao === "object"){
      CAMPOS_MACRO.forEach(function(chave){ delete aluno.dadosPredicao[chave]; });
      aluno.versaoDados = VERSAO_DADOS;
      return aluno;
    }
    if(aluno.versaoDados === VERSAO_DADOS && aluno.dadosPredicao && typeof aluno.dadosPredicao === "object") return aluno;

    function numero(v){ return typeof v === "number" && isFinite(v) ? v : null; }
    function indicador(v){ return v === true ? 1 : (v === false ? 0 : null); }

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
    if(indice >= 1 && indice <= CATALOGOS.course.length){
      aluno.cursoCodigo = CATALOGOS.course[indice - 1].codigo;
      aluno.curso = CATALOGOS.course[indice - 1].rotulo;
    }else if(!cursoPorCodigo(aluno.cursoCodigo)){
      aluno.cursoCodigo = null;
    }

    // Modo de ingresso e escolaridade anterior eram códigos "provisórios": são descartados
    // (precisam ser preenchidos de novo com o catálogo correto).
    ["estadoCivilCodigo", "ordemCandidatura", "turnoCodigo", "idadeIngresso", "bolsista", "devedor",
     "mensalidadeEmDia", "modoIngressoCodigo", "qualificacaoAnteriorCodigo", "predicao", "versaoDemo"
    ].forEach(function(chave){ delete aluno[chave]; });

    aluno.dadosPredicao = dados;
    aluno.versaoDados = VERSAO_DADOS;
    return aluno;
  }

  function sincronizarTurno(aluno){
    var cursoCatalogo = cursoPorCodigo(aluno.cursoCodigo);
    if(cursoCatalogo) aluno.curso = cursoCatalogo.nome;

    var dados = aluno.dadosPredicao || (aluno.dadosPredicao = {});
    var codigo = dados.daytime_evening_attendance;
    if(codigo === 1) aluno.turno = "Diurno";
    else if(codigo === 0) aluno.turno = "Noturno";
    else if(aluno.turno === "Diurno") dados.daytime_evening_attendance = 1;
    else if(aluno.turno === "Noturno") dados.daytime_evening_attendance = 0;
    else aluno.turno = aluno.turno || "";
  }

  function carregarDados(){
    try{
      var alunosSalvos = alunosService.listar();
      if(alunosSalvos){
        var precisaSalvar = alunosSalvos.some(function(a){ return a.versaoDados !== VERSAO_DADOS; });
        state.alunos = alunosSalvos.map(function(aluno){
          var migrado = migrarAluno(aluno);
          sincronizarTurno(migrado);
          return migrado;
        });
        if(precisaSalvar) salvarDados();
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
      return alunosService.salvar(state.alunos);
    }catch(err){
      console.error("Erro ao salvar dados", err);
      mostrarToast("Não foi possível salvar as alterações.", "erro");
      return false;
    }
  }

  function criarAlunoExemplo(base, chavePerfil){
    var aluno = Object.assign({ id: gerarId(), status: "ativo", disciplinasReprovadas: null, versaoDados: VERSAO_DADOS }, base);
    var dados = {};
    var codigoCurso = null;
    if(chavePerfil){
      dados = Object.assign({}, PERFIS_EXEMPLO[chavePerfil].dados);
      codigoCurso = dados.course;
      delete dados.course;
      CAMPOS_MACRO.forEach(function(chave){ delete dados[chave]; });
    }else{
      codigoCurso = 9147;
    }
    aluno.cursoCodigo = codigoCurso;
    aluno.curso = cursoPorCodigo(codigoCurso).nome;
    aluno.dadosPredicao = dados;
    sincronizarTurno(aluno);
    return aluno;
  }

  // Exemplos de demonstração: três perfis reais do dataset (alto, médio e baixo risco) e um cadastro novo, incompleto.
  function gerarAlunosExemplo(){
    return [
      criarAlunoExemplo({ nome:"Fernanda Alves Costa", email:"fernanda.costa@escola.com", dataMatricula:"2024-01-22", frequencia:52, media:4.2 }, "alto"),
      criarAlunoExemplo({ nome:"João Pedro Martins", email:"joao.martins@escola.com", dataMatricula:"2022-03-01", frequencia:68, media:5.5 }, "medio"),
      criarAlunoExemplo({ nome:"Mariana Ribeiro Santos", email:"mariana.santos@escola.com", dataMatricula:"2024-05-06", frequencia:88, media:7.8 }, "baixo"),
      criarAlunoExemplo({ nome:"Cauã Victor Camargo", email:"caua.camargo@escola.com", dataMatricula:hojeISO(), frequencia:null, media:null }, null)
    ];
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

  function renderStatusApi(){
    var el = document.getElementById("api-status");
    if(state.lote.status === "carregando"){
      el.hidden = false;
      el.className = "api-status";
      el.innerHTML = 'Consultando o modelo de predição…';
    }else if(state.lote.status === "erro"){
      el.hidden = false;
      el.className = "api-status erro";
      el.innerHTML = '<strong>Predição indisponível.</strong> ' + escapeHtml(state.lote.erro || "") + ' <button type="button" class="btn-link js-tentar-lote">Tentar novamente</button>';
    }else{
      el.hidden = true;
      el.innerHTML = "";
    }
  }

  function renderStats(){
    var ativos = state.alunos.filter(function(a){ return a.status === "ativo"; });
    var counts = { low:0, mid:0, high:0, previstas:0 };
    ativos.forEach(function(a){
      var previsao = obterPrevisao(a);
      if(!previsao) return;
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

  function preencherFiltros(){
    var filtroTurno = document.getElementById("filtro-turno");
    var filtroCurso = document.getElementById("filtro-curso");
    var ativos = state.alunos.filter(function(a){ return a.status === "ativo"; });

    var contagemTurno = {};
    var temSemTurno = false;
    ativos.forEach(function(a){
      if(a.turno){
        contagemTurno[a.turno] = (contagemTurno[a.turno] || 0) + 1;
      }else{
        temSemTurno = true;
        contagemTurno["Não informado"] = (contagemTurno["Não informado"] || 0) + 1;
      }
    });
    var turnos = TURNOS_DISPONIVEIS.slice();
    Object.keys(contagemTurno).forEach(function(t){
      if(t !== "Não informado" && turnos.indexOf(t) === -1) turnos.push(t);
    });
    if(temSemTurno) turnos.push("Não informado");
    if(state.turno && turnos.indexOf(state.turno) === -1) state.turno = "";

    filtroTurno.innerHTML = '<option value="">Todos</option>' +
      turnos.map(function(turno){
        var qtd = contagemTurno[turno] || 0;
        var rotulo = escapeHtml(turno) + (ativos.length ? " (" + qtd + ")" : "");
        return '<option value="' + escapeHtml(turno) + '"' + (state.turno === turno ? ' selected' : '') + '>' + rotulo + '</option>';
      }).join("");
    filtroTurno.value = state.turno;

    // Lista apenas os cursos que possuem alunos ativos matriculados, em ordem alfabética.
    var contagemCurso = {};
    ativos.forEach(function(a){
      if(a.curso) contagemCurso[a.curso] = (contagemCurso[a.curso] || 0) + 1;
    });
    var cursos = Object.keys(contagemCurso).sort(function(a, b){
      return normalizarTexto(a).localeCompare(normalizarTexto(b));
    });
    if(state.curso && cursos.indexOf(state.curso) === -1) state.curso = "";

    filtroCurso.innerHTML = '<option value="">Todos</option>' +
      cursos.map(function(curso){
        var rotulo = escapeHtml(curso) + " (" + contagemCurso[curso] + ")";
        return '<option value="' + escapeHtml(curso) + '"' + (state.curso === curso ? ' selected' : '') + '>' + rotulo + '</option>';
      }).join("");
    filtroCurso.value = state.curso;
  }

  function renderPillRisco(aluno){
    var estado = estadoPrevisao(aluno);
    if(estado === "ok"){
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

  function renderLista(){
    preencherFiltros();
    renderStatusApi();
    renderMacroAviso();
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

  function buscarAluno(id){
    return state.alunos.find(function(a){ return a.id === id; }) || null;
  }

  function detalheAberto(){
    return !document.getElementById("view-detail").hidden;
  }

  function abrirDetalhe(id){
    var aluno = buscarAluno(id);
    if(!aluno) return;

    state.detalhe = { id: id, token: ++sequenciaDetalhe, carregando: false, erro: null };
    document.getElementById("view-list").hidden = true;
    document.getElementById("view-detail").hidden = false;
    renderDetalhe(aluno);
  }

  function fecharDetalhe(){
    state.detalhe = null;
    document.getElementById("view-detail").hidden = true;
    document.getElementById("view-list").hidden = false;
  }

  function atualizarDetalheAberto(){
    if(!state.detalhe || !detalheAberto()) return;
    var aluno = buscarAluno(state.detalhe.id);
    if(aluno) renderDetalhe(aluno);
  }

  function formatarPercentual(probabilidade){
    return (probabilidade * 100).toFixed(1).replace(".", ",") + "%";
  }

  function renderFaltantes(faltantes){
    return GRUPOS_PREDICAO.map(function(grupo){
      var campos = faltantes.filter(function(c){ return c.grupo === grupo; });
      if(!campos.length) return "";
      if(grupo === "Macroeconômicos") return '<li><strong>Macroeconômicos:</strong> configure em <em>Indicadores macro</em> (cabeçalho); valem para todos os alunos.</li>';
      return '<li><strong>' + escapeHtml(grupo) + ':</strong> ' + campos.map(function(c){ return escapeHtml(c.rotulo); }).join("; ") + '</li>';
    }).join("");
  }

  function renderPrevisaoHtml(aluno){
    var faltantes = camposFaltantes(aluno);
    var detalhe = state.detalhe && state.detalhe.id === aluno.id ? state.detalhe : { carregando: false, erro: null };
    var botao = function(texto, desabilitado){
      return '<div class="form-actions" style="justify-content:flex-start; margin-top:16px;"><button type="button" class="btn btn-primary js-prever" data-id="' + aluno.id + '"' + (desabilitado ? ' disabled' : '') + '>' + texto + '</button></div>';
    };

    if(faltantes.length){
      return '<div class="prediction-pending"><strong>Dados incompletos</strong>' +
        '<p>Faltam ' + faltantes.length + ' de ' + CAMPOS_PREDICAO.length + ' campos para prever o risco. Preencha em <em>Editar dados → Dados para predição</em>:</p>' +
        '<ul class="missing-list">' + renderFaltantes(faltantes) + '</ul>' +
        botao("Prever risco", true) + '</div>';
    }
    if(detalhe.carregando){
      return '<div class="prediction-pending prediction-loading" role="status"><strong>Consultando o modelo…</strong><p>Aguarde a resposta da API.</p>' + botao("Prever risco", true) + '</div>';
    }
    var previsao = obterPrevisao(aluno);
    if(previsao){
      var pct = Math.max(0, Math.min(100, Math.round(previsao.probabilidade * 100)));
      return '<div class="prediction-result">' +
        '<div class="prediction-head"><span class="pill ' + previsao.nivel + '">' + escapeHtml(previsao.riskLevel) + '</span></div>' +
        '<p class="prediction-percent">' + formatarPercentual(previsao.probabilidade) + '</p>' +
        '<p class="prediction-label">Probabilidade estimada de evasão (dropout_probability)</p>' +
        '<div class="prob-bar" aria-hidden="true"><div class="prob-bar-fill ' + previsao.nivel + '" style="width:' + pct + '%"></div></div>' +
        '<small>' + LEGENDA_MODELO + '</small>' + botao("Prever novamente", false) + '</div>';
    }
    if(detalhe.erro){
      return '<div class="prediction-pending prediction-error" role="alert"><strong>Predição indisponível</strong><p>' + escapeHtml(detalhe.erro) + '</p>' + botao("Tentar novamente", false) + '</div>';
    }
    return '<div class="prediction-pending"><strong>Previsão ainda não calculada</strong><p>Os dados estão completos. Clique em &ldquo;Prever risco&rdquo; para consultar o modelo.</p>' + botao("Prever risco", false) + '</div>';
  }

  function renderDetalhe(aluno){
    var el = document.getElementById("detail-content");
    var dados = aluno.dadosPredicao || {};
    var preenchidos = CAMPOS_PREDICAO.length - camposFaltantes(aluno).length;

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
            '<div class="meta-item"><span class="meta-label">Curso</span><strong class="meta-value">' + escapeHtml(aluno.curso) + '</strong></div>' +
            '<div class="meta-item"><span class="meta-label">Turno</span><strong class="meta-value">' + escapeHtml(aluno.turno || "Não informado") + '</strong></div>' +
            '<div class="meta-item"><span class="meta-label">Data de matrícula</span><strong class="meta-value">' + formatarData(aluno.dataMatricula) + '</strong></div>' +
            '<div class="meta-item"><span class="meta-label">Idade na matrícula</span><strong class="meta-value">' + (dados.age_at_enrollment == null ? "—" : dados.age_at_enrollment + " anos") + '</strong></div>' +
            '<div class="meta-item"><span class="meta-label">Código do curso (UCI)</span><strong class="meta-value">' + (aluno.cursoCodigo == null ? "—" : aluno.cursoCodigo) + '</strong></div>' +
            '<div class="meta-item"><span class="meta-label">Preenchimento do modelo</span><strong class="meta-value">' + preenchidos + ' de ' + CAMPOS_PREDICAO.length + ' campos</strong></div>' +
            '<div class="meta-item meta-item-wide"><span class="meta-label">Indicadores macroeconômicos (globais)</span><strong class="meta-value">' + escapeHtml(textoMacro()) + '</strong></div>' +
          '</div>' +
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
  async function executarPrevisaoDetalhe(id){
    var aluno = buscarAluno(id);
    if(!aluno) return;

    var token = ++sequenciaDetalhe;
    state.detalhe = { id: id, token: token, carregando: true, erro: null };
    renderDetalhe(aluno);

    var erro = null;
    try{
      await preverRisco(aluno);
    }catch(err){
      erro = err.message || "Falha ao consultar a API.";
    }

    if(!state.detalhe || state.detalhe.token !== token || !detalheAberto()) return;
    state.detalhe.carregando = false;
    state.detalhe.erro = erro;
    var alunoAtual = buscarAluno(id);
    if(alunoAtual) renderDetalhe(alunoAtual);
    renderLista();
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
      '<p class="modal-sub">Cadastro básico. Os dados para predição de evasão são preenchidos depois, em Editar dados.</p>' +
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
      var emailDigitado = document.getElementById("f-email").value.trim().toLowerCase();
      var emailJaCadastrado = state.alunos.some(function(a){
        return a.status === "ativo" && (a.email || "").trim().toLowerCase() === emailDigitado;
      });
      if(emailJaCadastrado){
        mostrarToast("Já existe um aluno ativo matriculado com este e-mail.", "erro");
        document.getElementById("f-email").focus();
        return;
      }
      var ingresso = lerDadosIngresso("f", null);
      var novo = {
        id: gerarId(),
        nome: document.getElementById("f-nome").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        cursoCodigo: ingresso.cursoCodigo,
        curso: ingresso.curso,
        dataMatricula: ingresso.dataMatricula,
        turno: document.getElementById("f-turno").value,
        frequencia: null,
        media: null,
        disciplinasReprovadas: null,
        dadosPredicao: {},
        versaoDados: VERSAO_DADOS,
        status: "ativo"
      };
      sincronizarTurno(novo);
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
    var aluno = buscarAluno(id);
    if(!aluno) return;

    abrirModal(
      '<h2 id="modal-title">Editar aluno</h2>' +
      '<p class="modal-sub">Atualize os dados cadastrais, os dados para predição e os indicadores acadêmicos.</p>' +
      '<form id="form-editar-aluno">' +
        '<fieldset class="form-section form-section-first"><legend>Dados cadastrais</legend><div class="form-grid">' +
          '<div class="field"><label for="e-nome">Nome completo</label><input id="e-nome" value="' + escapeHtml(aluno.nome) + '" required /></div>' +
          '<div class="field"><label for="e-email">E-mail</label><input id="e-email" type="email" value="' + escapeHtml(aluno.email) + '" required /></div>' +
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
    document.getElementById("form-editar-aluno").addEventListener("submit", function(e){
      e.preventDefault();
      var emailDigitado = document.getElementById("e-email").value.trim().toLowerCase();
      var emailJaCadastrado = state.alunos.some(function(a){
        return a.id !== aluno.id && a.status === "ativo" && (a.email || "").trim().toLowerCase() === emailDigitado;
      });
      if(emailJaCadastrado){
        mostrarToast("Este e-mail já pertence a outro aluno matriculado.", "erro");
        document.getElementById("e-email").focus();
        return;
      }
      aluno.nome = document.getElementById("e-nome").value.trim();
      aluno.email = document.getElementById("e-email").value.trim();
      var ingresso = lerDadosIngresso("e", aluno);
      Object.keys(ingresso).forEach(function(chave){ aluno[chave] = ingresso[chave]; });
      aluno.dadosPredicao = lerFormularioPredicao("e");
      sincronizarTurno(aluno);
      var academicos = lerDadosAcademicos("e");
      Object.keys(academicos).forEach(function(chave){ aluno[chave] = academicos[chave]; });
      // Invalida respostas em andamento para esta ficha: os dados mudaram.
      if(state.detalhe && state.detalhe.id === aluno.id){
        state.detalhe = { id: aluno.id, token: ++sequenciaDetalhe, carregando: false, erro: null };
      }

      if(!salvarDados()) return;
      preencherFiltros();
      renderLista();
      fecharModal();
      mostrarToast("Dados atualizados.");
      if(detalheAberto()){
        renderDetalhe(aluno);
      }
      atualizarLote();
    });
  }

  function abrirModalExcluir(id){
    var aluno = buscarAluno(id);
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
      fecharDetalhe();
      renderLista();
    });
  }

  /* ---------------- eventos globais ---------------- */

  document.getElementById("btn-new-student").addEventListener("click", abrirModalNovoAluno);
  document.getElementById("btn-empty-new").addEventListener("click", abrirModalNovoAluno);
  document.getElementById("btn-exportar").addEventListener("click", exportarDados);
  document.getElementById("btn-importar").addEventListener("click", function(){
    document.getElementById("input-importar").click();
  });
  document.getElementById("input-importar").addEventListener("change", function(e){
    var arquivo = e.target.files && e.target.files[0];
    e.target.value = "";
    if(arquivo) importarArquivo(arquivo);
  });
  document.getElementById("api-badge").addEventListener("click", reverificarApi);
  document.getElementById("btn-macro").addEventListener("click", abrirModalMacro);

  document.getElementById("btn-back").addEventListener("click", function(){
    fecharDetalhe();
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

    var prever = e.target.closest(".js-prever");
    if(prever){ executarPrevisaoDetalhe(prever.getAttribute("data-id")); return; }

    var exemplo = e.target.closest(".js-exemplo");
    if(exemplo){ preencherPerfilExemplo(exemplo.getAttribute("data-prefixo"), exemplo.getAttribute("data-perfil")); return; }

    if(e.target.closest(".js-tentar-lote")){ atualizarLote(); return; }

    if(e.target.closest(".js-abrir-macro")){ abrirModalMacro(); return; }
  });

  /* ---------------- inicialização ---------------- */

  state.macro = macroService.carregar();
  carregarDados();
  preencherFiltros();
  state.loaded = true;
  renderLista();
  renderBadgeApi();
  verificarSaudeApi().then(function(){ atualizarLote(); });

  // Gancho de teste: só existe se a página definir window.__EXPOR_TESTE__ antes de carregar.
  if(window.__EXPOR_TESTE__){
    window.__teste = {
      montarPayload: montarPayload,
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
      state: state
    };
  }

})();
