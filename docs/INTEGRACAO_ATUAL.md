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

A matrícula organiza os campos em identificação e matrícula, perfil e ingresso,
família e condições de apoio, situação financeira, desempenho acadêmico por
semestre e indicadores macroeconômicos. A configuração global de indicadores
pode ser aberta durante o preenchimento, com retorno à matrícula sem perder
os campos já informados. Essa organização não altera o contrato de envio.

Inflação e PIB continuam compartilhados, configurados em Indicadores macro e
visíveis no formulário. Desemprego aceita valor individual, com fallback global.
O exemplo não altera indicadores globais; se houver divergência, avisa que o
JSON de referência usa inflação 1,4% e PIB 1,74%.

A interface oferece somente um exemplo completo, identificado como preenchimento
demonstrativo. Os atalhos parciais, os perfis por
nível de risco e o cadastro automático de dois exemplos foram removidos.

Na Vercel, o destino é `/api/v1/predictions`, encaminhado pelo `vercel.json`
ao gateway Java configurado. Os headers continuam `Authorization: Bearer ...`
e `X-API-KEY`. Não há reenvio de chave por query string.

O preview mostra os 34 valores efetivamente montados. O diagnóstico só declara
predição disponível após validar a resposta; status e duração não comprovam
a causa de uma falha interna do backend.
