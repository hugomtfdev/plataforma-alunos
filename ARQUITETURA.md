# Documentação Técnica e Arquitetura do Sistema

Documento interno de engenharia contendo decisões de arquitetura (ADRs), especificações de dados, contratos de integração e contexto para desenvolvedores e agentes de IA.

---

## 1. Visão Geral da Arquitetura

O sistema é estruturado como uma **Single Page Application (SPA) Buildless** (sem dependência de Node.js, empacotadores ou frameworks), projetada para operar no navegador com persistência local e comunicação assíncrona com microsserviço externo de Machine Learning.

```
┌────────────────────────────────────────────────────────┐
│                      NAVEGADOR                         │
│                                                        │
│   ┌─────────────────────┐      ┌───────────────────┐   │
│   │ gestao-alunos.html  │◄────►│    style.css      │   │
│   └──────────┬──────────┘      └───────────────────┘   │
│              │                                         │
│              ▼                                         │
│   ┌─────────────────────┐      ┌───────────────────┐   │
│   │      script.js      │◄────►│   catalogos.js    │   │
│   └──────────┬──────────┘      └───────────────────┘   │
│              │                                         │
│       ┌──────┴──────┐                                  │
│       ▼             ▼                                  │
│ ┌───────────┐ ┌───────────┐                            │
│ │localStorage│ │ Cache RAM │                            │
│ └───────────┘ └───────────┘                            │
└───────┬────────────────────────────────────────────────┘
        │ HTTP (Fetch API / JSON)
        ▼
┌────────────────────────────────────────────────────────┐
│              API DE INFERÊNCIA (EXTERNA)               │
│                                                        │
│   FastAPI + Uvicorn (Porta 8000)                       │
│   ├── GET  /health                                     │
│   ├── POST /predict                                    │
│   └── POST /predict/batch                              │
│                                                        │
│   Modelo: Regressão Logística (Scikit-Learn)           │
└────────────────────────────────────────────────────────┘
```

---

## 2. Contrato de Dados e Validação Estrita

O modelo de inferência exige exatamente **34 atributos** em formato `snake_case` (tipos numéricos `int` e `float`).

### 2.1 Esquema e Metadados (`CAMPOS_PREDICAO`)
Definido em [`script.js`](script.js), o catálogo `CAMPOS_PREDICAO` unifica metadados dos atributos:
- **Identificação do campo:** `key`, `label`, `tipo` (`int` ou `float`).
- **Restrições de faixa:** `min`, `max` (quando aplicável).
- **Catálogo de referência:** `catalogo` (chave do objeto em [`catalogos.js`](catalogos.js)).
- **Agrupamento temático:** `grupo` (pessoal, socioeconomico, academico_s1, academico_s2, macro).
- **Origem dos dados:** os atributos macroeconômicos (`unemployment_rate`, `inflation_rate`, `gdp`) possuem a marcação `global: true`, sendo alimentados pela configuração macro global do sistema e não por dados individuais do aluno.

### 2.2 Política de Validação Preventiva
A API FastAPI possui valores padrão para os atributos e retorna `HTTP 200 OK` mesmo recebendo um payload vazio `{}` ou parcial, gerando uma probabilidade padrão espúria de aproximadamente ~37,79%. 

Por essa razão, o front-end implementa uma barreira estrita em `montarPayload(aluno)`:
- Todos os 34 atributos são estritamente obrigatórios.
- Se qualquer campo estiver ausente, nulo ou inválido, a chamada de rede é **bloqueada no cliente**.
- O status visual é definido como *"Dados incompletos"*, listando detalhadamente quais campos estão pendentes.

---

## 3. Decisões Críticas de Arquitetura (ADRs)

### ADR-01: Conversão Categórica (UCI → Índice 1..N)
- **Problema:** O dataset de origem (UCI Machine Learning Repository) utiliza códigos arbitrários para categorias (ex: curso `9119` para *Engenharia Informática*). Contudo, o pré-processamento utilizado no treinamento do modelo reindexou as categorias nominais sequencialmente de `1` a `N`.
- **Impacto:** O envio do código original UCI faz com que o valor numérico (`9119`) sature os coeficientes da Regressão Logística, resultando em distorções extremas e falsos positivos (100% de risco de evasão para quase qualquer aluno).
- **Solução:** A função `converterCodigoUciParaIndice()` mapeia os 8 campos categóricos nominais (`course`, `application_mode`, `previous_qualification`, `nationality`, `mothers_qualification`, `fathers_qualification`, `mothers_occupation`, `fathers_occupation`) para a sua posição sequencial base 1 no array ordenado de [`catalogos.js`](catalogos.js).
- **Evidência:** Verificação empírica comparando as saídas do modelo com o CSV de treinamento original, onde os índices 1..N reproduzem com precisão as probabilidades esperadas.

### ADR-02: Isolamento dos Indicadores Macroeconômicos Globais
- **Problema:** No dataset histórico de 4.424 registros, existem apenas 10 combinações distintas dos atributos econômicos (`unemployment_rate`, `inflation_rate`, `gdp`). Esses dados refletem o contexto macroeconômico do país no período letivo, e não propriedades individuais do estudante.
- **Solução:** Os 3 campos foram removidos da ficha cadastral individual e centralizados no painel global de **Indicadores Macroeconômicos** (`localStorage["config-macro"]`).
- **Tratamento de Extrapolação:** O painel informa a faixa observada no treinamento (`Desemprego: 7,6% a 16,2%`, `Inflação: -0,8% a 3,7%`, `PIB: -4,06% a 3,51%`). Valores fora desse intervalo exibem alerta consultivo de extrapolação, sem bloquear a operação do gestor.

### ADR-03: Ausência de Fallback Local
- **Decisão:** Não há cálculo heurístico nem estimativa simulada de risco no front-end.
- **Justificativa:** Se a API de Machine Learning estiver offline ou inacessível, a interface exibe explicitamente *"Predição indisponível"*. O cálculo sintético no cliente introduziria risco ético e institucional, podendo levar a tomadas de decisão pedagógicas equivocadas baseadas em simulações não validadas.

### ADR-04: Estratégia de Cache de Inferência
- **Implementação:** Para mitigar requisições redundantes na listagem geral e paginação, o sistema mantém um cache em memória indexado por:
  $$\text{Chave} = \text{ID do Aluno} + \text{Hash}(\text{34 atributos})$$
- **Invalidação:** Qualquer alteração nos dados do aluno ou nos parâmetros macroeconômicos globais altera o hash, invalidando imediatamente a entrada no cache e agendando uma nova inferência.

---

## 4. Persistência e Governança de Dados

- **Mecanismo:** Armazenamento via Web Storage API (`localStorage`), particionado sob as chaves:
  - `alunos-data`: Array contendo o cadastro completo dos alunos.
  - `config-macro`: Objeto com a configuração econômica global ativa.
- **Versionamento de Schema:** O sistema utiliza `VERSAO_DADOS = 5`. Funções de migração automática inspecionam a carga inicial, sanitizam registros legados, injetam identificadores únicos e preenchem estruturas necessárias.
- **Backup e Recuperação:**
  - **Exportar:** Gera dump completo em arquivo `.json` contendo timestamp, versão de schema e a coleção de estudantes.
  - **Importar:** Validação estrita do arquivo JSON com opção de *Mesclar* (atualização por ID mantendo registros existentes) ou *Substituir* (recriação total do banco local).

---

## 5. Histórico de Versões e Tags Git

O desenvolvimento da plataforma foi registrado através de tags semânticas no repositório:

- **`v1-prototipo`**: Estrutura visual inicial em HTML/CSS/JS com mock de dados, dashboard estatístico, ordenação e filtros.
- **`v2-integracao-api`**: Conexão real com endpoints FastAPI (`/predict` e `/predict/batch`), mapeamento dos 34 atributos e catálogos da UCI.
- **`v3-qualidade`**: Health-check em tempo real no cabeçalho (`GET /health`), rotina de backup/restore em JSON e bateria de testes de regressão local.
- **`v4-macro-e-filtros`**: Desacoplamento dos indicadores macroeconômicos para escopo global e filtros dinâmicos de curso/turno com contadores ativos.
- **`v5-design-e-identidade`**: Reformulação visual completa no padrão Slate Editorial minimalista, nova identidade institucional (*Permanência Estudantil*) e validação estrita de e-mail único.

---

## 6. Contexto Rápido para Desenvolvedores e Agentes de IA

Ao retomar o desenvolvimento ou depuração deste projeto em novas sessões ou com assistentes de IA, considere as seguintes premissas:

1. **Arquitetura Zero-Build:** Não adicione dependências de `npm`, `package.json`, Vite ou Webpack a menos que expressamente solicitado pelo usuário. O código deve continuar funcionando ao abrir `gestao-alunos.html` diretamente no navegador.
2. **Endereço da API:** A URL base é definida na constante `API_BASE_URL` no início de [`script.js`](script.js) (padrão: `http://127.0.0.1:8000`). O backend roda de forma desacoplada e independente.
3. **Contrato Estrito de 34 Atributos:** Toda chamada ao `/predict` deve ser rigorosamente inspecionada pela função `montarPayload()`. Nunca ignore campos faltantes nem envie defaults silenciosos.
4. **Mapeamento Categórico:** Lembre-se que as variáveis nominais devem ser convertidas pela posição 1..N via `converterCodigoUciParaIndice()`, e não pelo código original bruto da UCI.
5. **Critério de Risco:**
   - `< 40%`: Baixo Risco (verde / `low`)
   - `40% a 69%`: Médio Risco (âmbar / `mid`)
   - `≥ 70%`: Alto Risco (vermelho / `high`)

