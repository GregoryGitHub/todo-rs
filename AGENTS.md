# AGENTS.md - Guia do Projeto para Agentes de IA

Este documento fornece um mapa conciso e abrangente da arquitetura, estrutura de código, comandos backend e regras de negócio do **TodoRS**, otimizando o contexto para assistentes e agentes de IA (como o Antigravity).

---

## 1. Visão Geral do Projeto

- **Nome**: todo-rs
- **Tipo**: Aplicativo de produtividade (Tarefas, Notas Rápidas, Timer Pomodoro, cliente HTTP estilo Postman e Formatter JSON) para Desktop.
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
├── src/                       # Frontend da Aplicação
│   ├── index.html             # Estrutura HTML principal (views, modais e barra de navegação)
│   ├── styles.css             # Estilos CSS globais, temas, modais e layout responsivo
│   ├── notes.css              # Estilos das Notas (modo bandeja compacto + modo desktop estilo macOS)
│   ├── http.css               # Estilos da aba HTTP (reaproveita o layout .notes-app/.nt-* das Notas)
│   ├── json.css               # Estilos do Formatter JSON (campo único: textarea + camada de realce)
│   ├── main.js                # Entry point JS: inicialização e eventos globais
│   └── js/                    # Módulos JS organizados por responsabilidade
│       ├── api.js             # Bridge IPC Tauri (`load_todos`, `save_todos`, etc.)
│       ├── state.js           # Estado global reativo da aplicação
│       ├── navigation.js      # Troca de view principal (dispara o evento "mainviewchange")
│       ├── utils/
│       │   ├── date.js        # Utilitários de data e formatação de tempo
│       │   ├── audio.js       # Gerador de som WebAudio para o alarme do Pomodoro
│       │   ├── noteContent.js # HTML das notas: migração, título/preview, sanitização de colagem
│       │   ├── httpModel.js   # HTTP: modelo/migração, variáveis {{}}, URL<->params, montagem da requisição
│       │   ├── httpConvert.js # HTTP: import cURL, snippets de código, import/export Postman v2.1
│       │   ├── httpScripts.js # HTTP: sandbox dos scripts pre-request/tests (API `pm` + `pm.expect`)
│       │   └── jsonRepair.js  # JSON: diagnóstico heurístico + pipeline de reparo, parser tolerante e serializador
│       └── components/
│           ├── tasks.js       # Lógica e renderização das abas "Meu Dia" e "Histórico"
│           ├── notes.js       # Notas: pastas, lista agrupada, busca, lixeira, menus
│           ├── noteEditor.js  # Editor rico (contenteditable): estilos, listas, checklist, tabelas
│           ├── http.js        # HTTP: coleções/pastas, lista, histórico, envio, menus, atalhos
│           ├── httpEditor.js  # HTTP: barra de URL, abas da requisição e visualizador da resposta
│           ├── httpDialogs.js # HTTP: modais (ambientes, coleção, importar, código, runner)
│           ├── httpWidgets.js # HTTP: tabela chave/valor, auth, autocomplete de variáveis, realce JSON
│           ├── jsonFormatter.js # Formatter JSON: editor, formatar no lugar, copiar formatado/minificado, opções
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
        └── http.rs            # Cliente HTTP (reqwest), cancelamento, cookies, http.json e arquivos
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

Diálogos de arquivo usam `tauri-plugin-dialog` (`plugin:dialog|open` / `plugin:dialog|save`).

### Estruturas de Dados (JSON / Rust Structs)

- **Todo**: `{ id: u64, text: String, done: bool, date: String ("YYYY-MM-DD"), is_my_day: bool, completed_date?: String }`
- **Note**: `{ id: u64, title: String, content: String (HTML), created_at: String, updated_at: u64 (ms), pinned: bool, folder_id: u64 (0 = "Notas"), deleted_at?: u64 }`
- **Folder**: `{ id: u64, name: String }`
- **AppSettings**: `{ autostart: bool, start_minimized: bool }`
- **HttpRequest** (IPC): `{ id, method, url, headers: [{key,value}], body: {kind: none|text|multipart|file}, timeout_ms, follow_redirects, verify_ssl, use_cookies }`
- **http.json**: `{ version, collections: [{id,name,description,auth,variables,scripts,folders}], requests: [...], environments, active_env, globals, history, settings }`

---

## 4. Regras de Negócio Importantes

1. **Aba "Meu Dia" vs "Histórico"**:
   - **Meu Dia**: Exibe tarefas pendentes agendadas para hoje (`date === today` ou `is_my_day === true`). Exibe tarefas concluídas SOMENTE se a data agendada for hoje E tiverem sido concluídas hoje (`completed_date === today`).
   - **Histórico**: Exibe TODAS as tarefas (pendentes e concluídas), servindo como registro completo.
   - **Tarefas de outros dias concluídas**: Quando uma tarefa que não é de hoje (ex: tarefa atrasada) é concluída, ela sai de "Meu Dia" e fica guardada em "Histórico".

2. **Timer Pomodoro**:
   - Cada tarefa pendente possui um botão de relógio para abrir o Timer Pomodoro.
   - Alterna automaticamente entre modo **Foco** (ex: 25 min) e modo **Pausa** (ex: 5 min).
   - Toca um alarme (*chime*) síntetizado via WebAudio API ao término de cada ciclo.

3. **Notas Rápidas (cópia do app Notas do macOS)**:
   - O conteúdo é HTML gerado pelo editor (`h1/h2/h3/p/pre/blockquote/ul/ol/li/table/b/i/u/s`). A primeira linha é o título; `title` é derivado e salvo só por compatibilidade. Notas antigas em texto puro são migradas por `normalizeNote`.
   - Listas: `ul` (marcadores), `ul.dashed` (traços), `ol` (numerada), `ul.checklist` com `li.checked`. Tabelas usam `table.nt-table`.
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

6. **Janela Frameless & System Tray**:
   - A janela não possui barra de título do sistema operacional (`decorations: false`). A barra de arrastar é estilizada via `data-tauri-drag-region`.
   - O aplicativo minimiza para a bandeja do sistema ao fechar ou ao clicar em ocultar.

---

## 5. Instruções para Manutenção

- Ao adicionar novos recursos JS, coloque a lógica em componentes desacoplados na pasta `src/js/components/`.
- Mantenha o arquivo `src/main.js` apenas para carregar o estado inicial e vincular ouvintes globais.
- Sempre rode `./build_linux.sh` ou `cargo check` em `src-tauri` para validar alterações no código Rust ou builds.
