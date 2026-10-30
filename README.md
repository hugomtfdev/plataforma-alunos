# Plataforma de Gestão de Alunos

MVP de uma plataforma de secretaria escolar para cadastro e acompanhamento de alunos. O projeto está sendo preparado para, futuramente, consumir uma API de predição de evasão escolar baseada em Machine Learning.

> **Estado atual:** a interface funciona localmente no navegador, persiste os cadastros no `localStorage` e obtém a predição de evasão da API FastAPI (Regressão Logística). Sem a API no ar, o risco aparece como **Predição indisponível**; nenhum risco é calculado localmente. Os alunos de demonstração usam linhas reais do dataset, mas os nomes e e-mails são fictícios.

## Funcionalidades atuais

- Listagem de alunos ativos com busca por nome ou curso.
- Filtros por risco, turno e curso.
- Cadastro e edição de dados pessoais e de ingresso.
- Acompanhamento acadêmico editável após a matrícula: frequência, média e disciplinas reprovadas.
- Ficha individual com dados de ingresso, indicadores acadêmicos e área reservada para a previsão de evasão.
- Exclusão de cadastros.
- Quatro registros de demonstração carregados no primeiro uso.
- Layout adaptável a telas menores.

## Como executar

O front não usa npm, bundler ou compilação.

1. **API** (PowerShell, na pasta `student_dropout_fastapi`; use o Python do seu venv):

   ```powershell
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

   Confirme em `http://127.0.0.1:8000/health` (`status: healthy`). A API libera CORS, então o front não precisa de servidor.
2. **Front**: abra `gestao-alunos.html` no navegador (ou use F5 no VS Code, `.vscode/launch.json`).

Se a API estiver em outra máquina, altere `API_BASE_URL` no topo de `script.js` (ex.: `http://192.168.0.10:8000`) e suba a API com `--host 0.0.0.0`.

## Estrutura do projeto

```text
/
├── gestao-alunos.html       # Estrutura da página e pontos de montagem
├── catalogos.js             # Somente dados: catálogos código UCI/rótulo e perfis de exemplo
├── script.js                # Estado, cadastro, filtros, renderização, persistência e cliente da API
├── style.css                # Layout, componentes e regras responsivas
├── README.md                # Documentação do MVP
└── .vscode/
    └── launch.json          # Configuração para iniciar no Chrome pelo VS Code
```

## Fluxo da plataforma

### Matrícula

O cadastro é leve: nome, e-mail, curso (17 cursos do catálogo, rótulo + código UCI) e data de matrícula.

### Dados para predição

Em **Editar dados → Dados para predição** ficam os demais campos exigidos pelo modelo, agrupados em Perfil, Família, Financeiro, 1º semestre, 2º semestre e Macroeconômicos. Campos categóricos são `select` (rótulo em português; o valor guardado é o código UCI). Os botões **Baixo / Médio / Alto risco** carregam perfis reais do dataset para demonstração.

### Acompanhamento

Frequência, média (0–10) e disciplinas reprovadas são informativas e **não são enviadas ao modelo**, que usa notas por semestre na escala 0–20.

### Previsão

- **Ficha individual:** botão *Prever risco* (`POST /predict`). Estados: carregando, *Predição indisponível* (erro) e sucesso (probabilidade em %, `risk_level` da API e a legenda do modelo). Se faltar qualquer um dos 34 campos, o botão fica bloqueado e a ficha lista o que falta (*Dados incompletos*).
- **Lista e contadores:** uma chamada `POST /predict/batch` para os alunos com dados completos, com cache em memória (id + hash dos dados). Os demais aparecem como *Sem predição*.
- Nunca é enviado payload incompleto nem valor padrão: a API aceitaria (HTTP 200 com predição calculada só com padrões), o que geraria um risco falso.

## Dados de demonstração e armazenamento

Os alunos são salvos no `localStorage` do navegador, na chave `alunos-data`. Isso é armazenamento local de protótipo: os dados não são compartilhados entre computadores, usuários ou navegadores e não constituem uma base de dados central.

Os quatro exemplos possuem indicadores diferentes para exercitar a interface. Seus valores são fictícios e não devem ser tratados como registros reais nem como evidência da qualidade do modelo. Os cursos usam a tabela código/nome encontrada no notebook de treinamento; confirme que ela corresponde ao catálogo oficial da instituição antes de usar em produção. Os códigos de modo de ingresso e escolaridade também são demonstrativos até validação.

Como limpar os dados locais durante o desenvolvimento:

1. Abra as ferramentas de desenvolvedor do navegador.
2. No console da página, execute `localStorage.removeItem('alunos-data')`.
3. Recarregue a página para carregar novamente os alunos de demonstração.

Essa ação remove todos os cadastros mantidos por esta cópia da plataforma no navegador atual.

## Integração com a API

Endpoints usados: `GET /health` (verificação manual), `POST /predict` e `POST /predict/batch` (`{"students": [...]}`). Não há autenticação. Resposta usada: `dropout_probability` (0–1) e `risk_level` (`Baixo Risco`, `Médio Risco`, `Alto Risco de Evasão`), convertidos para `{score, nivel: low|mid|high}`.

### Conversão dos códigos categóricos (importante)

O manual da API manda enviar os códigos originais da UCI, mas o modelo foi treinado com o CSV em que as colunas categóricas foram reindexadas (curso 1–17, modo de candidatura 1–18, escolaridade anterior 1–17, nacionalidade 1–21, escolaridade da mãe 1–29 e do pai 1–34, ocupação da mãe 1–32 e do pai 1–46). O front guarda o código UCI e `converterCodigoUciParaIndice()` (`script.js`) envia a **posição (base 1) do código no catálogo** (`catalogos.js`, ordem da seção 13 do manual). Validado: payload gerado igual à linha do CSV e mesma probabilidade na API (3 linhas, ver resultados da verificação). Se a API for retreinada com outro CSV, revise essa conversão.

## Limitações conhecidas

- Não há login ou controle de acesso nesta interface.
- Os cadastros existem somente no `localStorage` do navegador.
- A conversão UCI → índice do modelo é uma hipótese validada em linhas do CSV, não uma garantia documentada pela API.
- O modelo usa indicadores do 1º e 2º semestre: não serve para prever no momento da matrícula.
- Registros antigos do `localStorage` são migrados (curso vira código UCI); modo de ingresso e escolaridade anterior "provisórios" são descartados e precisam ser preenchidos de novo.
- A probabilidade é uma estimativa estatística (acurácia de teste 86,67%), não certeza.
- Não há testes automatizados no repositório; a verificação foi feita com scripts externos (API real + Chrome headless).

## Próximos passos sugeridos

1. Confirmar com a equipe do modelo a regra de reindexação dos códigos categóricos.
2. Definir a origem dos dados dos semestres (notas, disciplinas) e dos indicadores macroeconômicos na plataforma final.
3. Decidir como os dados serão persistidos e protegidos fora do navegador.
4. Criar testes automatizados para cadastro, edição, payload e estados de erro.
