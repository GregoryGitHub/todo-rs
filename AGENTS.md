# AGENTS.md - Guia do Projeto para Agentes de IA

Este documento fornece um mapa conciso e abrangente da arquitetura, estrutura de código, comandos backend e regras de negócio do **TodoRS**, otimizando o contexto para assistentes e agentes de IA (como o Antigravity).

---

## 1. Visão Geral do Projeto

- **Nome**: todo-rs
- **Tipo**: Aplicativo de produtividade (Tarefas, Notas Rápidas, Timer Pomodoro, cliente HTTP estilo Postman, Formatter JSON e cliente de banco de dados estilo DataGrip — SQL Server, Azure SQL e MongoDB) para Desktop.
- **Tecnologias**:
  - **Frontend**: HTML5, CSS3 Vanilla (com variáveis CSS e design moderno), JavaScript nativo (ES Modules).
  - **Backend / Desktop Frame**: Rust + Tauri v2.
  - **Ícones**: FontAwesome 6 (via CDN).
  - **Fontes**: Google Fonts (Poppins).

---

## 2. Estrutura de Diretórios e Arquivos

```
todo-rs/
├── .github/workflows/release.yml # CI/CD automático via GitHub Actions para releases Linux e Windows
├── AGENTS.md                  # Este guia de contexto para agentes de IA
├── build_linux.sh             # Script de build de release para Linux (.deb, .rpm, .AppImage)
├── build_windows.ps1          # Script de build de release para Windows (.exe/.msi)
├── build_windows.sh           # Script de cross-compilação para Windows via Linux
├── circle-check-solid-full.svg # Ícone fonte do app (gerado em src-tauri/icons via `_gen_icons.ps1`)
├── _gen_icons.ps1             # Gera todos os ícones do bundle com `cargo tauri icon` a partir do SVG
├── clean.sh                   # Script para limpar cache de build no Linux (cargo clean)
├── clean.ps1                  # Script para limpar cache de build no Windows
├── tests/db-utils.test.mjs    # Testes dos utilitários da aba Banco (`node tests/db-utils.test.mjs`)
├── tests/mongo.test.mjs       # Testes do parser mongosh e da conversão de documentos (`node tests/mongo.test.mjs`)
├── tests/code-block.test.mjs  # Testes dos blocos de código das Notas: dobras, realce, linguagens (`node tests/code-block.test.mjs`)
├── src/                       # Frontend da Aplicação
│   ├── index.html             # Estrutura HTML principal (views, modais e barra de navegação)
│   ├── theme.css              # Tokens de tema claro/escuro (html[data-theme]) e paleta de realce --syn-*
│   ├── styles.css             # Estilos CSS globais, modais, configurações e layout da bandeja
│   ├── notes.css              # Estilos das Notas (modo bandeja compacto + modo desktop estilo macOS)
│   ├── http.css               # Estilos da aba HTTP (reaproveita o layout .notes-app/.nt-* das Notas)
│   ├── json.css               # Estilos do Formatter JSON
│   ├── tasks.css              # Estilos das Tarefas (bandeja em pilha + desktop em 3 colunas)
│   ├── code.css               # Editor de código compartilhado (.ce) e tokens de realce (.tok-*)
│   ├── db.css                 # Aba Banco: Explorer, abas, DataGrid, console, log e diálogos
│   ├── main.js                # Entry point JS: inicialização e eventos globais
│   ├── vendor/mermaid/        # Mermaid 11 (UMD, MIT) carregado sob demanda pelos diagramas das Notas (offline)
│   └── js/                    # Módulos JS organizados por responsabilidade
│       ├── api.js             # Bridge IPC Tauri (`load_todos`, `save_todos`, etc.)
│       ├── state.js           # Estado global reativo da aplicação
│       ├── navigation.js      # Troca de view principal (dispara o evento "mainviewchange")
│       ├── utils/
│       │   ├── date.js        # Utilitários de data e formatação de tempo
│       │   ├── dom.js         # Helper `el()` para montar DOM (compartilhado pelos componentes)
│       │   ├── highlight.js   # Realce por regex (JSON, JS/TS, XML/HTML, GraphQL, SQL, CSS, Python, Bash, PowerShell, C#/Java/Go/Rust/C++, YAML, diff, Mermaid) + CODE_LANGS
│       │   ├── codeBlock.js   # Blocos de código das Notas: regiões dobráveis, linhas realçadas, detecção da linguagem
│       │   ├── audio.js       # Gerador de som WebAudio para o alarme do Pomodoro
│       │   ├── noteContent.js # HTML das notas: migração, título/preview, sanitização, URLs de imagem
│       │   ├── noteImages.js  # Imagens das notas: salvar colagens/data: URLs, importar arquivos do Markdown
│       │   ├── markdown.js    # Conversão HTML das notas <-> Markdown (import/export)
│       │   ├── httpModel.js   # HTTP: modelo/migração, variáveis {{}}, URL<->params, montagem da requisição
│       │   ├── httpConvert.js # HTTP: import cURL, snippets de código, import/export Postman v2.1
│       │   ├── httpScripts.js # HTTP: sandbox dos scripts pre-request/tests (API `pm` + `pm.expect`)
│       │   ├── jsonRepair.js  # JSON: diagnóstico heurístico + pipeline de reparo, parser tolerante e serializador
│       │   ├── dbModel.js     # Banco: databases.json (conexões sem segredo, consoles, abas), connection string ADO/JDBC
│       │   ├── sqlDialect.js  # Banco: dialeto SQL (quoting, literais, paginação OFFSET/FETCH); marcadores DEFAULT/GENERATED
│       │   ├── sqlSplit.js    # Banco: divide scripts em lotes (GO) e comandos; comando sob o cursor
│       │   ├── sqlGen.js      # Banco: UPDATE/INSERT/DELETE das alterações pendentes do grid (pela PK original)
│       │   ├── mongoShell.js  # MongoDB: parser da sintaxe do mongosh → operação JSON (Extended JSON); divisão do script
│       │   ├── mongoValue.js  # MongoDB: Extended JSON ↔ células, formatação mongosh, updateOne/insertOne/deleteOne do grid
│       │   ├── gridModel.js   # DataGrid: linhas, visão filtrada/ordenada, pendências, agregados (sem DOM)
│       │   └── gridExport.js  # DataGrid: TSV/CSV/JSON/Markdown/SQL INSERT e leitura de TSV colado (Excel)
│       └── components/
│           ├── tasks.js       # Tarefas: listas Meu Dia/Pendentes/Histórico, detalhe, atalhos
│           ├── codeEditor.js  # Editor de código (textarea + realce + numeração de linhas + recuo inteligente)
│           ├── theme.js       # Tema claro/escuro/sistema (botões [data-theme-toggle] e seletor nas Configurações)
│           ├── notes.js       # Notas: pastas, lista agrupada, busca, lixeira, menus
│           ├── noteEditor.js  # Editor rico (contenteditable): estilos, listas, checklist, tabelas, colar imagens
│           ├── noteHistory.js # Desfazer/refazer das notas (snapshots do HTML, agrupados por palavra)
│           ├── noteCode.js    # Blocos de código das Notas (widget): linhas numeradas, dobrar/desdobrar, edição no lugar, Mermaid
│           ├── mermaidView.js # Mermaid: carga sob demanda, fila de renderização, visualização com zoom/arrastar
│           ├── http.js        # HTTP: coleções/pastas, lista, histórico, envio, menus, atalhos
│           ├── httpEditor.js  # HTTP: barra de URL, abas da requisição e visualizador da resposta
│           ├── httpDialogs.js # HTTP: modais (ambientes, coleção, importar, código, runner)
│           ├── httpWidgets.js # HTTP: tabela chave/valor, auth, autocomplete de variáveis, realce JSON
│           ├── jsonFormatter.js # Formatter JSON: editor, formatar no lugar, copiar formatado/minificado, opções
│           ├── modal.js       # Modal compartilhado (HTTP e Banco): createModalHost(overlay)
│           ├── db.js          # Banco: orquestrador (conexões, abas, log de consultas, menus, atalhos, layout)
│           ├── dbExplorer.js  # Banco: Database Explorer (árvore lazy conexão → banco → schema → objetos → colunas/chaves)
│           ├── dbTableTab.js  # Banco: aba de tabela (paginação, WHERE/ORDER BY, edição, Submit/Revert, transação)
│           ├── dbConsole.js   # Banco: console (Ctrl+Enter, result sets, Saída, cancelar) e aba de DDL
│           ├── dbLanguages.js # Banco: adaptadores do console por conexão (SQL | mongosh): divisão, editor, autocomplete
│           ├── dbMongoTab.js  # Banco: aba de coleção MongoDB (filtro/sort/projeção, edição tipada, JSON)
│           ├── dbShared.js    # Banco: rodapé com agregados, "copiar como", exportação, controles Tx
│           ├── dbDialogs.js   # Banco: diálogo de conexão, revisão do SQL antes de gravar
│           ├── dataGrid.js    # DataGrid genérico virtualizado (2 eixos): seleção estilo Excel, edição, colar, busca
│           ├── dataGridFilter.js # DataGrid: popup de filtro local (valores distintos + contagem)
│           ├── dataGridEditor.js # DataGrid: editor sobre a célula e editor de valor (texto longo/JSON/XML)
│           ├── sqlComplete.js # Autocomplete SQL (tabelas, colunas por alias, palavras-chave) e de colunas em inputs
│           ├── windowMode.js  # Alterna modo bandeja <-> modo desktop (evento "windowmodechange")
│           ├── pomodoro.js    # Lógica de contagem e modal do Timer Pomodoro
│           ├── settings.js    # Gerenciamento de configurações (autostart, minimizado)
│           ├── windowControls.js # Controles da janela frameless e menu dropdown
│           └── reschedule.js  # Modal para reagendar tarefas pendentes
└── src-tauri/                 # Backend Rust (Tauri)
    ├── Cargo.toml             # Dependências Rust (tauri, serde, etc.)
    ├── tauri.conf.json        # Configuração do aplicativo (tamanho, frameless, tray)
    └── src/
        ├── main.rs            # Comandos Rust IPC e lógica de persistência JSON no disco
        ├── http.rs            # Cliente HTTP (reqwest), cancelamento, cookies, http.json e arquivos
        ├── note_images.rs     # Imagens das notas em note-images/ + protocolo noteimg://
        ├── persist.rs         # Fila de gravação em thread própria (atômica, sem travar a UI)
        ├── (vendor/tiberius)  # tiberius 0.13 com patch "TodoRS patch" (contagem por comando); ver [patch.crates-io]
        └── db/                # Cliente de banco de dados (aba Banco)
            ├── mod.rs         # Comandos Tauri, sessões (session_id) e cancelamento
            ├── driver.rs      # Traits Driver/Session + tipos neutros (ColumnMeta, ExecEvent, ObjectNode, TableInfo)
            ├── mssql.rs       # SQL Server/Azure SQL via tiberius: conexão, streaming, conversão de tipos
            ├── mssql_meta.rs  # Introspecção (sys.*) e geração de DDL
            ├── mongo.rs       # MongoDB (driver oficial): Client por conexão, operações, Docs em Extended JSON
            ├── entra.rs       # Login Microsoft Entra interativo (OAuth Auth Code + PKCE, refresh token)
            ├── secrets.rs     # Senhas/tokens no cofre do sistema (keyring)
            └── it_tests.rs    # Testes de integração (precisam de TODORS_MSSQL_TEST)
```

---

## 3. Contratos de Dados & Persistência (Backend Rust)

O backend Rust (`src-tauri/src/main.rs`) expõe os seguintes comandos via Tauri IPC:

| Comando IPC | Parâmetros | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `load_todos` | - | `Vec<Todo>` | Carrega tarefas de `todos.json` |
| `save_todos` | `{ todos: Vec<Todo> }` | `Result<(), String>` | Persiste a lista de tarefas no disco |
| `load_notes` | - | `Vec<Note>` | Carrega notas de `notes.json` |
| `save_notes` | `{ notes: Vec<Note> }` | `Result<(), String>` | Persiste as notas no disco |
| `load_folders` | - | `Vec<Folder>` | Carrega pastas de notas de `folders.json` |
| `save_folders` | `{ folders: Vec<Folder> }` | `Result<(), String>` | Persiste as pastas no disco |
| `load_settings` | - | `AppSettings` | Carrega configurações de `settings.json` |
| `save_settings` | `{ settings: AppSettings }` | `Result<(), String>` | Salva configurações e ajusta autostart do sistema |
| `hide_window` | - | `()` | Oculta a janela principal na bandeja (System Tray) |
| `exit_app` | - | `()` | Encerra a aplicação |
| `set_desktop_mode` | `{ enabled: bool, visible: bool }` | `()` | Janela grande/redimensionável na taskbar (`true`) ou compacta presa à tray (`false`) |
| `minimize_window` | - | `()` | Minimiza a janela (modo desktop) |
| `toggle_maximize` | - | `bool` | Maximiza/restaura; retorna se ficou maximizada |
| `send_http_request` | `{ request: HttpRequest }` | `Result<HttpResponse, String>` | Executa a requisição no Rust (sem CORS) |
| `cancel_http_request` | `{ id: String }` | `()` | Cancela a requisição em andamento com esse id |
| `clear_http_cookies` | - | `()` | Limpa o cookie jar da sessão |
| `load_http_data` / `save_http_data` | `{ data: Value }` | `Value` / `Result` | Documento único `http.json` (formato definido em `httpModel.js`) |
| `read_text_file` / `write_file` | `{ path, text?, base64? }` | `Result` | Importação/exportação e salvar corpo de resposta |
| `save_note_image` | bytes crus no corpo + header `x-ext` | `Result<String>` | Salva imagem colada em `note-images/<hash>.<ext>` e retorna o nome |
| `import_note_image` | `{ path }` | `Result<String>` | Copia uma imagem do disco (import de Markdown) |
| `export_note_images` | `{ names, dir }` | `Result` | Copia imagens para a pasta `<nome>.assets` do export |
| `gc_note_images` | `{ keep }` | `Result<u32>` | Apaga imagens órfãs com mais de 24 h (chamado após carregar as notas) |

Imagens das notas são servidas pelo protocolo `noteimg` (`http://noteimg.localhost/<nome>` no Windows, `noteimg://localhost/<nome>` no Linux/macOS); o HTML guarda só a URL e `normalizeNote` converte entre as duas formas.

Diálogos de arquivo usam `tauri-plugin-dialog` (`plugin:dialog|open` / `plugin:dialog|save`).

### Banco de dados (`src-tauri/src/db/`)

Todos os comandos que tocam a rede são `async`. Os que rodam SQL recebem `target = { session_id, conn: ConnConfig, database }`: a sessão é aberta no primeiro uso e reaberta sozinha se cair. Sessões: `meta:<conn>:<db>` (Explorer/autocomplete), `tab:<tabId>` (tabelas), `console:<consoleId>`.

| Comando IPC | Parâmetros | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `load_db_data` / `save_db_data` | `{ data: Value }` | `Value` / `Result` | Documento `databases.json` (formato em `dbModel.js`, sem segredos) |
| `db_set_password` / `db_has_password` / `db_forget_secrets` | `{ connId, password? }` | `Result` | Senha (e refresh token do Entra) no cofre do sistema |
| `db_test_connection` | `{ conn, password? }` | `Result<ServerInfo>` | Testa a configuração do diálogo |
| `db_connect` | `{ target }` | `Result<ServerInfo>` | Abre a sessão (pode abrir o navegador para o login do Entra) |
| `db_disconnect` | `{ prefix }` | `()` | Fecha as sessões com esse prefixo |
| `db_introspect` | `{ target, path: {kind, schema, name} }` | `Result<Vec<ObjectNode>>` | `databases` / `schemas` / `schema` / `table` / `view` / `procedure` / `function` |
| `db_table_info` / `db_ddl` | `{ target, schema, name }` / `{ target, path }` | `Result` | Colunas com PK/identity/FK; DDL do objeto |
| `db_execute` | `{ target, queryId, sql, maxRows?, onEvent: Channel }` | `Result<ExecSummary>` | Result sets em lotes pelo Channel (`result_start`/`rows`/`docs`/`result_end`); `sql` = SQL ou, no MongoDB, a operação JSON |
| `db_cancel` | `{ queryId }` | `()` | Cancela fechando o socket (o servidor aborta e desfaz a transação) |
| `db_tx` | `{ target, action: begin\|commit\|rollback }` | `Result<u32>` | Devolve @@TRANCOUNT |
| `db_apply` | `{ target, statements, atomic }` | `Result<Vec<u64>>` | Alterações do grid (tudo ou nada quando `atomic`) |

### Estruturas de Dados (JSON / Rust Structs)

- **Todo**: `{ id: u64, text: String, done: bool, date: String ("YYYY-MM-DD"), is_my_day: bool, completed_date?: String, note?: String }`
- **Note**: `{ id: u64, title: String, content: String (HTML), created_at: String, updated_at: u64 (ms), pinned: bool, folder_id: u64 (0 = "Notas"), deleted_at?: u64 }`
- **Folder**: `{ id: u64, name: String }`
- **AppSettings**: `{ autostart: bool, start_minimized: bool, theme: "system" | "light" | "dark" }`
- **HttpRequest** (IPC): `{ id, method, url, headers: [{key,value}], body: {kind: none|text|multipart|file}, timeout_ms, follow_redirects, verify_ssl, use_cookies }`
- **http.json**: `{ version, collections: [{id,name,description,auth,variables,scripts,folders}], requests: [...], environments, active_env, globals, history, settings }`

---

## 4. Regras de Negócio Importantes

1. **Aba "Meu Dia" vs "Histórico"**:
   - **Meu Dia**: Exibe tarefas pendentes agendadas para hoje (`date === today` ou `is_my_day === true`). Exibe tarefas concluídas SOMENTE se a data agendada for hoje E tiverem sido concluídas hoje (`completed_date === today`).
   - **Histórico**: Exibe TODAS as tarefas (pendentes e concluídas), servindo como registro completo.
   - **Pendentes**: todas as tarefas não concluídas, agrupadas em Atrasadas / Hoje / Amanhã / próximas datas.
   - **Tarefas de outros dias concluídas**: Quando uma tarefa que não é de hoje (ex: tarefa atrasada) é concluída, ela sai de "Meu Dia" e fica guardada em "Histórico".
   - **Layout**: igual ao das Notas. Bandeja: lista (seletor Meu Dia/Pendentes/Histórico) → detalhe em pilha. Desktop: listas | tarefas | detalhe (o detalhe só aparece com uma tarefa selecionada). O detalhe edita título, Meu Dia, data, Pomodoro e anotação (`note`).

2. **Timer Pomodoro**:
   - Cada tarefa pendente possui um botão de relógio para abrir o Timer Pomodoro.
   - Alterna automaticamente entre modo **Foco** (ex: 25 min) e modo **Pausa** (ex: 5 min).
   - Toca um alarme (*chime*) síntetizado via WebAudio API ao término de cada ciclo.

3. **Notas Rápidas (cópia do app Notas do macOS)**:
   - O conteúdo é HTML gerado pelo editor (`h1/h2/h3/p/pre/blockquote/ul/ol/li/table/b/i/u/s`). A primeira linha é o título; `title` é derivado e salvo só por compatibilidade. Notas antigas em texto puro são migradas por `normalizeNote`.
   - Listas: `ul` (marcadores), `ul.dashed` (traços), `ol` (numerada), `ul.checklist` com `li.checked`. Tabelas usam `table.nt-table`.
   - Imagens coladas (print, "Copiar imagem", HTML com `data:`) viram arquivos via `save_note_image`; nunca guardar base64 no `notes.json`. `<img>` leva `width/height` (sem reflow) e `loading="lazy"`.
   - **Blocos de código**: salvos como `<pre data-lang="sql">texto</pre>` (`pre` sem `data-lang` = estilo Monoespaçado). No editor viram um widget `div.nt-code` (`contenteditable=false`, `noteCode.js`): linhas numeradas e realçadas, regiões dobráveis (chaves ou recuo, `codeBlock.js`), clique no código troca para o `codeEditor()` no lugar. Criar: botão `</>`, Ctrl+Shift+K ou ```` ```lang ```` + Enter. O HTML da nota sempre passa por `serializeEditorHtml()` (nunca `editor.innerHTML` direto) e todo HTML carregado/desfeito/colado passa por `hydrateCodeBlocks()`.
   - **Mermaid**: bloco `data-lang="mermaid"` alterna Visualizar / Código / Live (canto superior direito; Live = código e diagrama lado a lado, redesenhado ao digitar, mantendo o último diagrama válido se houver erro). A visualização tem zoom (Ctrl+roda, botões), arrastar e tela cheia (sobreposição em `document.body`, roda dá zoom, Esc sai). A biblioteca (`src/vendor/mermaid`) só carrega quando há diagrama e segue o tema claro/escuro; só redesenhar quando fonte ou tema mudarem de fato (`data-theme` é regravado com o mesmo valor ao carregar settings), senão zoom/posição se perdem.
   - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y usam `noteHistory.js`, não o undo nativo (que quebra com as edições diretas no DOM). Toda alteração deve passar por `changed()` no editor para entrar no histórico.
   - Markdown: menu "…" (e menus de contexto) importa `.md` como novas notas e exporta a nota (imagens copiadas para `<nome>.assets/`).
   - Notas vazias são descartadas ao sair delas. Apagar move para "Apagadas Recentemente" (`deleted_at`); após 30 dias são removidas.
   - **Modo bandeja**: navegação em pilha Pastas → Lista → Nota dentro da janela 370x530. **Modo desktop**: botão de expandir chama `set_desktop_mode(true)`; layout de 3 colunas com barra unificada e botões de janela no estilo do SO (fechar = volta à bandeja e oculta). Ao entrar na aba Notas no modo bandeja, sempre abre a lista "Todas as Notas".

4. **HTTP (cópia do Postman, visual das Notas)**:
   - Coleções com pastas (1 nível), "Todas as Requisições", Histórico (agrupado por data) e Ambientes. Edições são salvas automaticamente.
   - Variáveis `{{nome}}` com prioridade local (scripts) > ambiente > coleção > globais, além de dinâmicas (`{{$guid}}`, `{{$timestamp}}`...).
   - Auth "Herdar da coleção" é o padrão das requisições. Colar um cURL na barra de URL substitui a requisição.
   - **Modo bandeja**: pilha Coleções → Lista → Requisição, com alternância Requisição/Resposta. **Modo desktop**: 3 colunas, requisição e resposta divididas por um separador arrastável; o seletor no topo da barra alterna entre Notas, HTTP e JSON.

5. **Formatter JSON**:
   - Um único campo (sem entrada/saída separadas). "Formatar" (Ctrl+Enter) diagnostica o texto, repara e substitui o conteúdo no lugar (Ctrl+Z desfaz). Botões copiam formatado ou minificado (Ctrl+Shift+C / Ctrl+Shift+M) mesmo sem formatar antes.
   - Pipeline local em `jsonRepair.js`, por camada: caracteres invisíveis e mojibake (UTF-8 lido como Latin-1/CP1252) → invólucros (```, JWT, Base64, URL-encoding, entidades HTML) → lixo antes do JSON (logs, `var x =`, JSONP) → escapes sem aspas externas → parser tolerante (JSON5/JS/Python/Mongo shell, comentários, vírgulas, aspas internas, truncado, JSON Lines) → se o resultado é uma string com JSON, repete.
   - O parser gera AST própria (não usa `JSON.parse`) para preservar ordem das chaves e números grandes. Cada reparo vira um passo (`info` | `fix` | `warn`) exibido no diagnóstico.
   - Opções (indentação, ordenar chaves, expandir JSON em strings, formatar ao colar) e o texto ficam no `localStorage` (conveniência local, não vai para o Rust).

6. **Tema claro/escuro**:
   - Preferência em `AppSettings.theme` (com cópia em `localStorage` para o script do `<head>` aplicar antes da primeira pintura). O tema resolvido fica em `<html data-theme>`.
   - CSS novo deve usar tokens: `rgba(var(--fg-rgb), a)` para camadas translúcidas, `calc(a * var(--shade-k))` no alfa de sombras/poços escuros, `--nt-*`/`--c-*` para superfícies e `--syn-*` para realce. Cores claras específicas de cada app ficam em `theme.css`.

7. **Editor de código**: campos de código (body raw/GraphQL e scripts do HTTP, Formatter JSON, console SQL) usam `codeEditor()`, com numeração de linhas, realce, Tab/Shift+Tab e Enter com recuo.

8. **Banco de Dados (cópia do DataGrip)**:
   - **Registros afetados**: toda escrita mostra "(N) registro(s) afetado(s)" na Saída do console e no log (`affectedText`). No SQL Server a contagem vem do DONE de cada comando filtrado por tipo (INSERT/UPDATE/DELETE/MERGE), via `simple_query_counted` do tiberius vendorizado — exata em qualquer script (transação, variáveis, CTE), sem contar SELECT nem atribuições. No MongoDB vem de inserted/modified/deleted.
   - **MongoDB** (driver `mongo`): connection string (Atlas `mongodb+srv://`, servidor/replica set, Azure Cosmos DB) salva SEM a senha (vai para o cofre). Console em sintaxe do mongosh (`mongoShell.js` → operação JSON → `mongo.rs`); grid com campos de topo como colunas (descobertas no streaming), campo ausente ≠ NULL, edição preserva o tipo BSON original (long, double, Decimal128, ObjectId, datas). Gravação por `_id`, em ordem e sem transação. Views são somente leitura.
   - SQL Server e Azure SQL (driver `tiberius`, TLS rustls). Auth: login SQL ou Microsoft Entra interativo/MFA. Senhas e tokens NUNCA vão para JSON (cofre do sistema via `keyring`).
   - Novo banco = implementar `Driver`/`Session` em `src-tauri/src/db/` + um dialeto em `sqlDialect.js`. O frontend só conhece `ColumnMeta.kind` (int, num, dec, bool, str, date, time, datetime, guid, bin, xml, other).
   - Valores sem perder precisão: bigint fora do intervalo seguro, decimal/money e datas chegam como string; binário como `0x…` (truncado em 4 KB → somente leitura).
   - Azure SQL não aceita nomes de três partes: cada banco da árvore usa uma sessão própria; a introspecção roda no banco da sessão.
   - Grid: virtualizado nos dois eixos (só células visíveis viram HTML), filtro/ordenação locais trabalham em índices (`GridModel.view`). Edição só com PK e conexão não somente leitura; o SQL é revisado antes de gravar (`reviewChangesDialog`).
   - Tabelas paginam no servidor (`OFFSET n ROWS FETCH NEXT page+1`); o console limita linhas por result set (excedentes descartados, o lote segue rodando).
   - Cancelar fecha a conexão da aba (o Attention do tiberius deixa a conexão dessincronizada); a sessão é reaberta no próximo comando.
   - Modo bandeja mostra só a lista de conexões; o cliente completo é desktop-only.

9. **Janela Frameless & System Tray**:
   - A janela não possui barra de título do sistema operacional (`decorations: false`). A barra de arrastar é estilizada via `data-tauri-drag-region`.
   - O aplicativo minimiza para a bandeja do sistema ao fechar ou ao clicar em ocultar.

---

## 5. Instruções para Manutenção

- Ao adicionar novos recursos JS, coloque a lógica em componentes desacoplados na pasta `src/js/components/`.
- Mantenha o arquivo `src/main.js` apenas para carregar o estado inicial e vincular ouvintes globais.
- Sempre rode `./build_linux.sh` ou `cargo check` em `src-tauri` para validar alterações no código Rust ou builds.
- Notas: `node tests/code-block.test.mjs` (blocos de código e realce).
- Banco: `node tests/db-utils.test.mjs` e `node tests/mongo.test.mjs` (utilitários JS) e `cargo test` em `src-tauri`; MongoDB: `docker run -d -p 27019:27017 -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=TodoRs#Mongo2026 mongo:7` e `TODORS_MONGO_TEST="mongodb://admin@localhost:27019/?authSource=admin|TodoRs#Mongo2026" cargo test it_mongo`; os testes de integração precisam de um SQL Server: `docker run -d -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=TodoRs#Test2026" -p 14333:1433 mcr.microsoft.com/mssql/server:2022-latest` e `TODORS_MSSQL_TEST="localhost,14333,sa,TodoRs#Test2026" cargo test it_ -- --test-threads=1`.
- **Desempenho**: comandos Tauri síncronos rodam na thread da UI. Gravações em disco devem usar `persist::write` (nunca `fs::write` direto num comando), e efeitos caros (ex.: `reg.exe` do autostart) só quando o valor muda.
- Não salvar em disco ao navegar entre abas: só gravar quando houver alteração pendente.
- Abas ocultas usam `display: none`. Não usar `content-visibility: hidden` nelas: com a aba JSON grande, todos os frames do app ficam ~45 ms mais lentos.
