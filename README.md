# Gestão & Prevenção de Evasão — Permanência Estudantil

Plataforma web para gestão acadêmica e acompanhamento preventivo de permanência estudantil, integrada a um serviço de inteligência artificial para predição precoce de risco de evasão escolar.

O sistema permite que coordenadores e equipes pedagógicas acompanhem indicadores de desempenho acadêmico, gerenciem matrículas e identifiquem estudantes em situação de vulnerabilidade com base em inferências preditivas.

---

## Demonstração Visual

Abaixo, a visualização da ficha individual do estudante com os indicadores cadastrais, acadêmicos e a predição de risco retornada pelo modelo:

![Ficha individual do estudante com predição de risco](docs/predicao.png)

---

## Funcionalidades Principais

- **Gestão Cadastral Completa:** Cadastro simplificado de estudantes com validação preventiva de e-mail único, seleção de turno e edição detalhada de dados socioeconômicos e acadêmicos.
- **Predição de Risco de Evasão:** Integração com modelo de Machine Learning que calcula a probabilidade percentual de evasão e categoriza o risco em *Baixo Risco* (< 40%), *Médio Risco* (40% a 69%) e *Alto Risco* (≥ 70%).
- **Inferência Individual e em Lote:** Suporte a predições pontuais na ficha do estudante e predições em lote (`batch`) na listagem geral com sistema de cache inteligente.
- **Painel de Indicadores Macroeconômicos:** Módulo global para configuração de taxas econômicas (desemprego, inflação e PIB) compartilhadas entre todos os estudantes, com aviso de conformidade às faixas estatísticas do modelo.
- **Filtros e Busca Dinâmica:** Pesquisa instantânea por nome ou curso, com filtros combinados por nível de risco, turno e cursos ativos com contagem automática de matriculados.
- **Monitoramento de Conectividade:** Indicador em tempo real do status de comunicação com a API de inferência (`Online`, `Offline` ou `Modelo não carregado`).
- **Segurança e Backup de Dados:** Exportação e importação de bases de dados completas em formato JSON, com validação de integridade e opção de mesclagem ou substituição.

---

## Tecnologias Utilizadas

A plataforma adota uma arquitetura *Buildless* e *Zero-Dependency*, rodando nativamente no navegador sem a necessidade de compiladores ou empacotadores:

- **HTML5:** Estruturação semântica da aplicação e formulários temáticos.
- **CSS3 Moderno:** Design system próprio, variáveis CSS (design tokens), Flexbox e CSS Grid com padrão visual sóbrio e responsivo.
- **JavaScript (ES6+ puro / Vanilla JS):** Lógica reativa de interface, manipulação de estado e comunicação assíncrona.
- **Web Storage API (`localStorage`):** Persistência local segura com controle automático de migração de versões de dados.
- **Fetch API:** Comunicação HTTP assíncrona consumindo endpoints REST do backend de inferência.
- **Google Fonts (`Inter`):** Tipografia institucional legível com suporte a numerais tabulares (`tabular-nums`).
- **SVG Nativo:** Ícones vetoriais inline para ações e estados do sistema.

---

## Como Executar

### 1. Executando o Front-end

Por não exigir processo de compilação ou instalação de pacotes:

1. Clone este repositório ou faça o download dos arquivos:
   ```bash
   git clone https://github.com/hugomtfdev/plataforma-alunos.git
   cd plataforma-alunos
   ```
2. Abra o arquivo **`gestao-alunos.html`** diretamente em qualquer navegador moderno (Chrome, Edge, Firefox, Safari); ou
3. Caso utilize o VS Code, inicie com a extensão *Live Server* ou pressione `F5`.

### 2. Conectando à API de Predição (Opcional)

A plataforma consome uma API externa desenvolvida em **FastAPI** para o cálculo preditivo de risco de evasão. 

> **Observação:** O serviço de backend roda de forma desacoplada e independente deste repositório.

Caso o serviço esteja em execução na máquina local:
```powershell
# Exemplo de inicialização da API externa
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Para apontar o front-end para um servidor específico ou endereço em rede local, configure a constante **`API_BASE_URL`** no início do arquivo **[`script.js`](script.js)**:

```javascript
var API_BASE_URL = "http://127.0.0.1:8000";
```

Quando a API estiver offline ou inacessível, a plataforma mantém todas as funções de gestão ativas e sinaliza o status de risco como *Predição indisponível*, garantindo total transparência ao operador.

---

## Endpoints Consumidos

| Método | Endpoint | Finalidade na Aplicação |
|---|---|---|
| `GET` | `/health` | Monitoramento da disponibilidade da API e do carregamento do modelo. |
| `POST` | `/predict` | Cálculo pontual de risco de evasão na ficha individual do estudante. |
| `POST` | `/predict/batch` | Inferência otimizada em lote para atualização da listagem geral de alunos. |

---

## Estrutura do Repositório

```text
plataforma-alunos/
├── gestao-alunos.html       # Interface principal da aplicação e janelas modais
├── style.css                # Folha de estilos, variáveis visuais e responsividade
├── script.js                # Lógica da interface, validações e integração HTTP
├── catalogos.js             # Mapeamento de cursos, ocupações e perfis de referência
├── README.md                # Documentação executiva e apresentação do projeto
├── docs/
│   └── predicao.png         # Captura de tela demonstrando a predição na interface
└── .vscode/
    └── launch.json          # Configuração de inicialização rápida no VS Code
```
