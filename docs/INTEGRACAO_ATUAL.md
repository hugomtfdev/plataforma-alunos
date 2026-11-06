# Integração atual — 05/11/2026

O exemplo completo recebido de Kaique está em `payload-kaique.json`: um objeto
`{ studentId, features }` com 34 atributos. Os 13 atributos enviados anteriormente
por Daniel são um exemplo parcial; ele autorizou manter os demais atributos.
Esse exemplo não define, por si só, quais campos o backend considera opcionais.

O frontend continua validando os 34 atributos antes de consultar o modelo.
Cadastros incompletos podem ser salvos, mas não disparam inferência.
O cadastro comum inicia sem um perfil de risco pré-selecionado e não preenche
atributos complementares ausentes com valores presumidos.

Cadastro e edição exibem os campos complementares. O botão de exemplo completo
preenche os valores de Kaique. As categorias do JSON são índices do modelo:
o formulário converte esses índices para os códigos UCI internos e o envio os
converte de volta, uma única vez. A ordem dos catálogos deve ser preservada.

Inflação e PIB continuam compartilhados, configurados em Indicadores macro e
visíveis no formulário. Desemprego aceita valor individual, com fallback global.
O exemplo não altera indicadores globais; se houver divergência, avisa que o
JSON exato de Kaique usa inflação 1,4% e PIB 1,74%.

Os exemplos parciais de Daniel preenchem somente os dados conhecidos. O atalho
que cadastra dois exemplos usa os complementos do exemplo de Kaique e identifica
os registros como exemplos sintéticos; não representa duas pessoas reais.
As predições desses exemplos continuam sendo requisições individuais.

Na Vercel, o destino é `/api/v1/predictions`, encaminhado pelo `vercel.json`
ao gateway Java configurado. Os headers continuam `Authorization: Bearer ...`
e `X-API-KEY`. Não há reenvio de chave por query string.

O preview mostra os 34 valores efetivamente montados. O diagnóstico só declara
predição disponível após validar a resposta; status e duração não comprovam
a causa de uma falha interna do backend.
