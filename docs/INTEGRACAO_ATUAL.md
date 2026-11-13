# Integração atual — 05/11/2026

O exemplo completo de referência está em `payload-exemplo.json`: um objeto
`{ studentId, features }` com 34 atributos. O exemplo anterior, com 13 atributos,
era parcial e não substitui o contrato completo de integração.
Esse exemplo não define, por si só, quais campos o backend considera opcionais.

O frontend continua validando os 34 atributos antes de consultar o modelo.
Cadastros incompletos podem ser salvos, mas não disparam inferência.
O cadastro comum inicia sem um perfil de risco pré-selecionado e não preenche
atributos complementares ausentes com valores presumidos.

Cadastro e edição exibem os campos complementares. O botão de exemplo completo
preenche os valores de referência. As categorias do JSON são índices do modelo:
o formulário converte esses índices para os códigos UCI internos e o envio os
converte de volta, uma única vez. A ordem dos catálogos deve ser preservada.

Matrícula e edição compartilham o mesmo formulário, com os campos salvos
preenchidos na edição, as mesmas validações e o mesmo fluxo de persistência.
Ambas organizam os campos em identificação e matrícula, perfil e ingresso,
família e condições de apoio, situação financeira, desempenho acadêmico por
semestre e indicadores macroeconômicos. A configuração global de indicadores
pode ser aberta durante o preenchimento, com retorno à matrícula sem perder
os campos já informados, tanto na matrícula quanto na edição. Essa organização
não altera o contrato de envio.

O acompanhamento acadêmico também é compartilhado. A média visual (0–10) é
a média simples das notas dos dois semestres (0–20), dividida por dois e
arredondada para uma casa decimal. Reprovações somam a diferença não negativa
entre matriculadas e aprovadas de cada semestre. Os indicadores são recalculados
durante o preenchimento e ao salvar; quando faltam os valores necessários,
ficam pendentes (null), sem substituir dados ausentes por zero.
Frequência é informada manualmente e preservada na edição: aprovações não
permitem inferir presença. A estimativa automática anterior foi removida.
Os indicadores de acompanhamento não integram os 34 atributos da API.

Desemprego, inflação e PIB usam os indicadores globais por padrão. Em matrícula
ou edição, a opção "Usar contexto individual deste aluno" permite informar os
três valores para outro país ou período. Nesse modo, o payload usa exclusivamente
os valores individuais e alterações globais os preservam. Voltar ao modo global
remove a configuração individual ao salvar e retoma os valores globais atuais.
Contextos individuais são persistidos em macroIndividual (dados v6) e preservados
em backups. Substituições antigas em unemploymentRate ou dadosPredicao não são
reativadas; cadastros v4/v5 continuam seguindo o global até a opção explícita.
Salvar os indicadores atualiza as previsões dos alunos ativos com dados completos
cujo payload mudou; resultados já consultados podem ser reutilizados do cache.
O exemplo não altera os indicadores de nenhum contexto; se houver divergência,
avisa que a referência usa desemprego 10,8%, inflação 1,4% e PIB 1,74%.

A interface oferece somente um exemplo completo, identificado como preenchimento
demonstrativo. Os atalhos parciais, os perfis por
nível de risco e o cadastro automático de dois exemplos foram removidos.

Na Vercel, o destino é `/api/v1/predictions`, encaminhado pelo `vercel.json`
ao gateway Java configurado. Os headers continuam `Authorization: Bearer ...`
e `X-API-KEY`. Não há reenvio de chave por query string.

O preview mostra os 34 valores efetivamente montados. O diagnóstico só declara
predição disponível após validar a resposta; status e duração não comprovam
a causa de uma falha interna do backend.
