# Plataforma de Gestão de Alunos

MVP de uma plataforma de secretaria escolar para cadastro e acompanhamento de alunos. O projeto está sendo preparado para, futuramente, consumir uma API de predição de evasão escolar baseada em Machine Learning.

> **Estado atual:** a interface funciona localmente no navegador e persiste os cadastros no `localStorage`. A integração com o backend e com o modelo de Machine Learning ainda não está implementada. Os dados e indicadores de demonstração não são previsões reais.

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

O projeto não usa atualmente npm, bundler ou processo de compilação.

1. Abra `gestao-alunos.html` diretamente no navegador; ou
2. No VS Code, abra a pasta do projeto e inicie a configuração **Abrir Gestão de Alunos** disponível em `.vscode/launch.json` com F5.

A fonte tipográfica é carregada do Google Fonts. Sem conexão à internet, o navegador utiliza as fontes alternativas definidas no CSS.

## Estrutura do projeto

```text
/
├── gestao-alunos.html       # Estrutura da página e pontos de montagem
├── script.js                # Estado, cadastro, filtros, renderização e persistência local
├── style.css                # Layout, componentes e regras responsivas
├── README.md                # Documentação do MVP
└── .vscode/
    └── launch.json          # Configuração para iniciar no Chrome pelo VS Code
```

## Fluxo da plataforma

### Matrícula

O cadastro registra nome, e-mail, curso, data e idade no ingresso, período do curso, ordem da candidatura, estado civil e informações financeiras disponíveis. O modo de ingresso e a escolaridade anterior são apresentados como códigos provisórios, pois os respectivos codebooks precisam ser confirmados com a equipe responsável pelo modelo.

### Acompanhamento

Frequência, média e quantidade de disciplinas reprovadas são mantidas na edição do aluno, não como dados presumidos na matrícula. Esses indicadores são editáveis para demonstrar como o acompanhamento pode evoluir ao longo do curso.

### Previsão

A interface tem espaço para exibir o resultado da API: nível, probabilidade, classificação binária e versão do modelo. Enquanto não houver integração, os alunos aparecem como **Aguardando API**. Nenhum risco é calculado localmente pela plataforma.

## Dados de demonstração e armazenamento

Os alunos são salvos no `localStorage` do navegador, na chave `alunos-data`. Isso é armazenamento local de protótipo: os dados não são compartilhados entre computadores, usuários ou navegadores e não constituem uma base de dados central.

Os quatro exemplos possuem indicadores diferentes para exercitar a interface. Seus valores são fictícios e não devem ser tratados como registros reais nem como evidência da qualidade do modelo. Os cursos usam a tabela código/nome encontrada no notebook de treinamento; confirme que ela corresponde ao catálogo oficial da instituição antes de usar em produção. Os códigos de modo de ingresso e escolaridade também são demonstrativos até validação.

Como limpar os dados locais durante o desenvolvimento:

1. Abra as ferramentas de desenvolvedor do navegador.
2. No console da página, execute `localStorage.removeItem('alunos-data')`.
3. Recarregue a página para carregar novamente os alunos de demonstração.

Essa ação remove todos os cadastros mantidos por esta cópia da plataforma no navegador atual.

## Integração planejada com a API

O backend fornecido documenta o endpoint:

```http
POST /api/v1/predictions
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
```

Exemplo documentado de entrada:

```json
{
  "studentId": "ALUNO-123",
  "features": {
    "attendanceRate": 0.72,
    "averageGrade": 5.8,
    "failedSubjects": 3,
    "age": 16
  }
}
```

A resposta documentada contém `studentId`, `dropoutProbability`, `dropoutPrediction`, `riskLevel` (`HIGH`, `MEDIUM` ou `LOW`) e `modelVersion`. A interface já reconhece esses nomes quando um objeto de previsão é associado ao aluno, mas ainda não faz a requisição HTTP.

O exemplo de `features` do README do backend é provisório e não foi confirmado como contrato final do modelo do notebook. Antes da integração, devem ser definidos os nomes, tipos, unidades, obrigatoriedade e disponibilidade temporal das variáveis. As colunas usadas no treinamento precisam corresponder exatamente às que a API recebe.

### Segurança da integração

O endpoint documentado exige um API Token. Não inclua esse token no `script.js`, no HTML, no `localStorage` ou em qualquer recurso entregue ao navegador. O token pode ser extraído por usuários da página. A estratégia de autenticação e encaminhamento da chamada precisa ser definida com quem mantém o backend, mantendo credenciais no lado servidor. Se frontend e backend forem hospedados em origens diferentes, a configuração de CORS também deverá ser alinhada.

## Limitações conhecidas

- Não há login ou controle de acesso nesta interface.
- Os cadastros existem somente no `localStorage` do navegador.
- Não há cliente HTTP, URL de API configurada, estado de carregamento de requisição nem tratamento de erros do serviço remoto.
- A tela de previsão mostra pendência até que um resultado real seja fornecido pela integração.
- O contrato de entrada do modelo e os codebooks de algumas categorias ainda precisam de confirmação.
- O modelo do notebook utiliza indicadores acadêmicos que não estão disponíveis no momento inicial da matrícula; previsões no ingresso podem exigir um modelo treinado especificamente para os dados disponíveis nessa etapa.
- O projeto não possui testes automatizados configurados. As verificações atuais são manuais no navegador e no VS Code.

## Próximos passos sugeridos

1. Confirmar com a equipe do backend o contrato final de entrada, resposta, autenticação, URL e CORS.
2. Confirmar os codebooks de cursos, modo de ingresso e escolaridade anterior.
3. Decidir como os dados de alunos serão persistidos e protegidos fora do navegador.
4. Implementar a integração sem expor tokens no frontend.
5. Definir quais indicadores existem na matrícula e quais só estarão disponíveis depois dos semestres letivos.
6. Criar testes para cadastro, edição, persistência, resposta da API e estados de erro/carregamento.

