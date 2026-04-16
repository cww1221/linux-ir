# Linux IR Console

面向 **Linux 应急响应 / 靶场取证** 的桌面端工具：通过 **SSH** 连接远端主机，集成 **一键检查剧本**、**交互式 Shell**、**SFTP / MySQL**、**Flag 与关键字搜索**、**弱口令哈希验证**、**离线包完整性修复** 等能力。界面为 **Wails + React + TypeScript**，后端为 **Go**。

---

## 目录结构

```
linux-ir-console/
├── main.go                 # Wails 入口
├── app.go                  # 核心 App：SSH、Shell、剧本执行
├── app_ext.go              # SFTP、本地目录、Shadow 破解、转发等扩展 API
├── app_mysql.go            # MySQL 连接与查询 API
├── app_search.go           # 远端 Flag 搜索、grep -rni、守护分析、PID 信号
├── app_ai.go               # AI 对话与工具调用（可选）
├── internal/
│   ├── ssh/                # SSH 会话、SFTP、端口转发、DialTCP（MySQL 隧道）
│   ├── playbook/           # 嵌入的 YAML 剧本（*.yaml）
│   ├── mysqlmgr/           # MySQL 驱动封装、关键字跨表搜索
│   ├── passwordcrypt/      # Shadow crypt 词表验证
│   ├── config/             # 本地设置存储
│   └── ai/                 # Ollama / 兼容 OpenAI 的调用
├── frontend/               # React 前端（Vite）
│   ├── src/
│   │   ├── App.tsx         # 主界面与各功能面板
│   │   ├── MySQLWorkbench.tsx
│   │   ├── TaskOutputHighlight.tsx
│   │   ├── wailsReady.ts   # 等待 Wails 注入，避免黑屏
│   │   └── ...
│   └── dist/               # 生产构建产物（由 wails build 嵌入）
├── build/bin/              # 打包后的可执行文件（如 linux-ir-console.exe）
├── wails.json
├── go.mod
└── README.md
```

---

## 环境要求

| 项目 | 说明 |
|------|------|
| Go | 见 `go.mod`（如 1.25+） |
| Node.js | 用于构建前端（`npm install` / `npm run build`） |
| Wails CLI | **v2.9.x**（与依赖一致，见下文） |
| Windows 运行 | 需 **WebView2 Runtime**（一般系统已自带） |

安装与项目一致的 Wails CLI：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.9.3
```

---

## 开发与构建

### 开发模式（热更新）

在项目根目录（本 `README.md` 所在目录）执行：

```bash
wails dev
```

**不要**对 Wails 项目使用无标签的裸 `go run` 打包主程序；若需在 IDE 中直接跑 Go，须加 `dev` 标签：

```bash
go run -tags dev .
```

### 发布构建（生成 exe）

**务必使用 Wails 构建**，以嵌入 `frontend/dist` 并生成正确绑定：

```bash
wails build
```

常用选项（Windows 控制台子系统、开发者工具）：

```bash
wails build -clean -devtools -windowsconsole
```

产物示例：`build/bin/linux-ir-console.exe`。  
若构建报「文件被占用」，请先关闭正在运行的 `linux-ir-console.exe` 再构建。

### 仅改前端时

```bash
cd frontend
npm run build
```

改动了 Go 导出方法后需执行：

```bash
wails generate module
```

---

## 功能说明与使用方式

以下均假设已在侧栏 **「连接」** 中填写 **Host / Port / User / Password**（或私钥），并点击 **「连接」** 成功。部分功能（如 **直连 MySQL**）可不依赖 SSH。

### 1. 连接

- **Host / Port / User / Password**：SSH 登录信息；支持跳板、代理等可在后续版本通过配置扩展（以实际代码为准）。
- **连接 / 断开**：建立或关闭 SSH 会话。
- **启动交互式 Shell**：打开下方 **xterm** 终端，与远端交互；支持拖拽分割条调整终端高度、**Ctrl+Shift+C/V** 复制粘贴、右键菜单。

**相关代码**：`app.go`（`SSHConnect`、`SSHStartShell`）、`frontend/src/App.tsx`。

---

### 2. 一键检查 / 单项执行

- **分类**：下拉选择剧本分类（如「矿码检测」「AutoIR」「系统」等）。
- **检查项**：选择具体剧本条目。
- **WebRoot**：部分 Web 相关剧本使用的变量（如网站根路径）。
- **执行选中项**：在远端执行对应 **只读或信息采集类** 命令（以剧本定义为准）。
- **执行关联处置**：若该项配置了 `remediateId`，会执行关联的「加固/采集」类剧本（**不自动删文件**；高危操作需人工判断）。
- **快速探测**：执行简短 `id; whoami; hostname; date` 类命令。

剧本文件位于 `internal/playbook/*.yaml`，加载逻辑见 `internal/playbook/playbook.go`。

**内置剧本分类概览**（以 YAML 为准）：

| 分类示例 | 内容方向 |
|----------|----------|
| 系统 / 账号与权限 / 进程 / 网络 / 持久化 / 日志 | 通用系统与入侵痕迹检查（`linux_full.yaml`） |
| 矿码检测 / 矿码处置 | 挖矿、恶意进程、守护与处置相关（`mining_checks.yaml`） |
| Web 日志分析 | 访问日志、可疑请求（`web_log_analysis.yaml`） |
| WebShell 查找 | Web 目录可疑脚本（`webshell_scan.yaml`） |
| AutoIR | 参考 AutoIR 思路的环境、用户、进程、网络、后门等批量检查（`autoir.yaml`） |
| 离线校验/修复 | `dpkg -V` / `rpm -V` 与离线包安装（`integrity_offline.yaml`） |

---

### 3. MySQL 数据库

- 点击 **「打开 MySQL 工作台」** 打开类 Navicat 的全屏窗口。
- **直连**：填写本机可访问的 **Host、端口、用户名、密码**，可选 **数据库名**。
- **SSH 隧道**：须先 **SSH 已连接**；远端 MySQL 一般为靶机上的 `127.0.0.1:3306`（可按实际修改）。
- 左侧 **库 → 表**；点击表名会 **用新的 `SELECT` 替换编辑器内容**（不追加），并清空上次查询/关键字结果。
- 上方 **关键字搜索**：在选定库（或全部非系统库）中跨表 **LIKE** 查找（适合搜 `flag{` 等）。
- 下方分别为 **SQL 查询结果** 与 **关键字搜索结果**。

**相关代码**：`app_mysql.go`、`internal/mysqlmgr/`、`frontend/src/MySQLWorkbench.tsx`。

---

### 4. SFTP 文件管理

- **远端路径**：当前浏览目录。
- **刷新 / 上级目录 / 上传文件**：与远端交互。
- **打开 XFTP 风格管理器**：双栏（本地 / 远端），可 **编辑远端或本地文本文件**（受大小限制）。

**相关代码**：`app_ext.go`、`internal/ssh/manager.go`（SFTP）。

---

### 5. Shadow 口令哈希（词表验证）

- Linux `$1$` / `$5$` / `$6$` 等为 **单向哈希**，无法「解密」，只能通过 **候选口令** 验证。
- 粘贴 **整行 `/etc/shadow`** 或 **裸哈希**；可填 **内联候选** 或选择 **词表文件**；点击 **开始验证**。

**相关代码**：`app_ext.go`、`internal/passwordcrypt/`。

---

### 6. 离线：系统命令篡改校验/修复

- 在 **已连接 SSH** 的靶机上执行：`dpkg -V` / `rpm -V`（剧本内判断发行版）。
- **上传离线包**：将本机 `.deb` / `.rpm` 传到远端目录，再按界面填写路径执行 **离线修复（安装包）**（`rpm` 可选 `--nodeps`，有风险）。

**相关代码**：`internal/playbook/integrity_offline.yaml`、`app_ext.go`。

---

### 7. SSH 隧道（本地端口转发）

- **本地监听**：如 `127.0.0.1:18080`。
- **远端目标**：如 `127.0.0.1:80`（靶机上的服务）。
- **启动转发 / 关闭转发**：用于临时访问内网服务（与 MySQL 隧道不同，此为通用 TCP 转发）。

**相关代码**：`internal/ssh/manager.go`（`StartLocalForward`）。

---

### 8. AI 设置（可选）

- 支持 **Ollama** 或 **OpenAI 兼容 API**；填写地址、模型与密钥后，可在侧栏 **AI 对话** 中使用（具体以界面为准）。
- 高危工具调用可能需要 **人工确认**。

**相关代码**：`app_ai.go`、`internal/ai/`。

---

### 9. 矿码处置（PID / pkill）

- 填写 **PID**，选择 **SIGTERM(15)** 或 **SIGKILL(9)**，勾选确认后对远端进程发信号。
- **pkill 常见挖矿进程名**：执行预置剧本（**高风险**，会杀匹配进程名，请确认后再用）。

**相关代码**：`app_search.go`（`SSHSignalPids`）、`internal/playbook/mining_checks.yaml`。

---

### 10. 守护/占用分析

- 填写矿码或可疑文件的 **绝对路径**，执行 **守护/占用分析**：结合 `lsof`、`/proc`、`systemd`、`cron`、`lsattr` 等输出 **可复制的处置建议**（杀进程、去不可变属性等）。

**相关代码**：`app_search.go`（`SSHGuardAnalysis`）。

---

### 11. Flag 搜索（远端文件）

**方式 A：多关键字 + 多目录（find / grep 列文件名）**

- **搜索根目录**：每行一个绝对路径，或用逗号分隔。
- **文件名关键字**（可选）：`find -iname`。
- **文件内容关键字**（可选）：`grep -rIlF` 仅列出 **文件名**。
- **最大深度 / 每类最多条数**：防止输出过大。
- 点击 **远端搜索**。

**方式 B：等价 `grep -rni`（显示匹配行）**

- **grep 目录**：单个绝对路径，如 `/var/www`。
- **grep 关键字**：如 `flag{`。
- **最多行数**：限制输出。
- **正则（-E）**：勾选则 `grep -rniE`，否则 **固定字符串** `grep -rniF`（推荐搜字面量 `flag{`）。
- 点击 **执行 grep -rni**，结果在 **任务输出** 中查看。

**相关代码**：`app_search.go`（`SSHSearchFlags`、`SSHGrepRecursive`）。

---

### 12. 本地文本：Flag 形态提取

- 将日志/终端输出粘贴到文本框，**从文本提取** 形如 `flag{...}` 的字符串（可勾选宽松规则）。
- **从任务输出填入**：把当前下方「任务输出」内容填入（不上传 SSH，纯本地解析）。

**相关代码**：`frontend/src/flagUtils.ts`。

---

### 任务输出与右侧终端

- **任务输出**：剧本、命令、SFTP、grep 等结果会追加显示在此；带关键字高亮（异常、Flag 等）。
- **交互式 Shell**：下方终端区域；可拖拽分割条调整高度。

---

## 安全与合规说明

- 本工具可在授权范围内用于 **应急、审计、靶场练习**；对生产环境执行 **kill、pkill、安装包覆盖** 等操作前请 **自行评估风险**。
- **Shadow 破解**、**关键字搜索** 仅用于弱口令核查与取证，请遵守法律法规与授权范围。
- SSH 与 MySQL 密码仅用于本地会话，请注意运行环境安全。

---

## 常见问题

| 现象 | 建议 |
|------|------|
| 启动黑屏 / 「Wails 绑定超时」 | 使用 **`wails build`** 完整打包；确保 `frontend/dist` 已生成；首屏会等待 `window.go.main.App` 注入（见 `frontend/src/wailsReady.ts`）。 |
| 构建 exe 失败「拒绝访问」 | 关闭正在运行的 `linux-ir-console.exe` 后重试。 |
| MySQL SSH 隧道连不上 | 确认 SSH 已连接；靶机 `mysqld` 是否监听 `127.0.0.1:3306`（或你填的地址）；账号是否允许从本机登录。 |

---

## 许可证与致谢

- 依赖包括但不限于：[Wails](https://wails.io/)、[xterm.js](https://xtermjs.org/)、[go-sql-driver/mysql](https://github.com/go-sql-driver/mysql)、[GehirnInc/crypt](https://github.com/GehirnInc/crypt) 等，以各依赖许可证为准。

---

## 更新记录（文档）

- 文档随功能迭代更新；若与界面不一致，以 **当前代码与界面** 为准。
