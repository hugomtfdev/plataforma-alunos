const http = require("http");
const https = require("https");
const { URL } = require("url");

function fazerRequisicao(parsed, method, headers, bodyStr, portaOverride) {
  return new Promise(function (resolve, reject) {
    const client = parsed.protocol === "https:" ? https : http;
    const port = portaOverride || parsed.port || (parsed.protocol === "https:" ? 443 : 80);
    const options = {
      hostname: parsed.hostname,
      port: port,
      path: parsed.pathname + (parsed.search || ""),
      method: method,
      headers: headers,
      timeout: 15000
    };

    const proxyReq = client.request(options, function (proxyRes) {
      let rawData = "";
      proxyRes.setEncoding("utf8");
      proxyRes.on("data", function (chunk) { rawData += chunk; });
      proxyRes.on("end", function () {
        resolve({
          statusCode: proxyRes.statusCode || 200,
          contentType: proxyRes.headers["content-type"] || "application/json; charset=utf-8",
          body: rawData
        });
      });
    });

    proxyReq.on("timeout", function () {
      proxyReq.destroy();
      const err = new Error("Tempo limite excedido");
      err.code = "ETIMEDOUT";
      reject(err);
    });

    proxyReq.on("error", function (err) {
      reject(err);
    });

    if (bodyStr) {
      proxyReq.write(bodyStr, "utf8");
    }
    proxyReq.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Target-Url, X-Http-Method");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const targetUrl = req.headers["x-target-url"];
  if (!targetUrl) {
    res.status(400).json({ detail: "Header X-Target-Url ausente." });
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (err) {
    res.status(400).json({ detail: "URL de destino inválida: " + targetUrl });
    return;
  }

  const method = req.headers["x-http-method"] || req.method || "POST";
  const headers = {
    "Accept": "application/json"
  };
  if (req.headers["content-type"]) {
    headers["Content-Type"] = req.headers["content-type"];
  } else if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }
  if (req.headers["authorization"]) {
    headers["Authorization"] = req.headers["authorization"];
  }

  const bodyStr = method !== "GET" && method !== "HEAD" && req.body
    ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body))
    : null;

  if (bodyStr) {
    headers["Content-Length"] = Buffer.byteLength(bodyStr, "utf8");
  }

  try {
    const resultado = await fazerRequisicao(parsed, method, headers, bodyStr, null);
    res.setHeader("Content-Type", resultado.contentType);
    res.status(resultado.statusCode).send(resultado.body);
  } catch (errPrimario) {
    // Se a URL foi informada sem porta (padrão 80) e falhou na conexão, tenta automaticamente 8080 (e vice-versa)
    if (parsed.protocol === "http:" && (!parsed.port || parsed.port === "80" || parsed.port === "8080")) {
      const portaAlternativa = (!parsed.port || parsed.port === "80") ? 8080 : 80;
      try {
        const resultadoAlt = await fazerRequisicao(parsed, method, headers, bodyStr, portaAlternativa);
        res.setHeader("Content-Type", resultadoAlt.contentType);
        res.status(resultadoAlt.statusCode).send(resultadoAlt.body);
        return;
      } catch (errSecundario) {
        // Segue para retornar o erro original
      }
    }
    const status = errPrimario.code === "ETIMEDOUT" ? 504 : 502;
    res.status(status).json({
      detail: "Não foi possível conectar à API em " + targetUrl + " (" + (errPrimario.message || "erro de rede") + ")."
    });
  }
};
