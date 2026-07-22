# Strategos（策略家）

Strategos 是一个本地优先的多 AI 编程代理调度器，面向 Claude Code、
OpenAI Codex CLI 和 GitHub Copilot CLI。

你给出一个目标和任务依赖图，Strategos 会把已经就绪的任务分派给不同
CLI，并为每个任务建立独立 Git worktree。项目上下文、上游任务报告、
日志、分支和变更文件都会留在本机，供你最终审查。

<p align="center">
  <img src="docs/assets/strategos-social-preview.jpg" alt="Strategos 将开发目标分发到三个隔离的 Agent worktree，保存恢复上下文，并由人审查结果。" />
</p>

<p align="center"><em>一个目标 → 校验计划 → 并行 worktree → 人工审查。</em></p>

> 当前为早期 MVP。默认不自动合并，也不自动推送 Agent 生成的分支。

## 解决什么问题

- 用 `AGENTS.md`、项目上下文、团队记忆和上游报告形成共享上下文。
- 由一个只读 strategist CLI 生成任务依赖图，再由 Strategos 校验并展示。
- 默认使用 `hybrid` 参与模式：strategist 完成规划后也会进入健康 Worker 池；
  需要严格角色隔离时仍可配置为 `separated`。
- 默认使用 `auto` 执行模式：生成计划后自动展示 preview 并立即运行；输入
  `/mode manual` 可恢复人工确认。
- 目标、计划、任务进度和错误会在本机持续保存；断网或中断后可用 `/resume`
  把原有上下文交给 strategist，继续规划剩余工作。
- 可通过 `/attach <路径>` 把 PNG、JPEG、GIF 或 WebP 图片同时交给 strategist
  和每个隔离的 worker。
- 即使电脑上只有一款健康 CLI，也会自动拆成多个独立 session/process、worktree
  和报告，在任务安全独立时继续并行。
- 无依赖任务并行执行，数量由 `maxParallel` 限制。
- 每个任务一个 worktree 和分支，避免三个 Agent 同时覆盖文件。
- Claude、Codex、Copilot 使用本机已经登录的 CLI，不额外代理账号和密钥。
- 所有运行证据保存在 `.strategos/runs/<run-id>/`。
- 提供本地 Vite+ Web UI，用来查看对话、历史 Session、运行证据、设置和图片上下文。

## 工作流程

```mermaid
flowchart LR
    G["开发目标"] --> S["只读策略 Agent"]
    C["仓库上下文"] --> S
    S --> P["经过校验的任务图"]
    P --> A["Claude 任务<br/>worktree A"]
    P --> B["Codex 任务<br/>worktree B"]
    P --> D["Copilot 任务<br/>worktree C"]
    A --> E["报告、日志<br/>与分支"]
    B --> E
    D --> E
    E --> H["人工审查<br/>与集成"]
```

已就绪的任务会并行执行，有依赖的任务则等待上游报告。每个 worker 都留在
独立分支和 worktree 中，最终由你决定集成哪些结果。

## 快速开始

需要 Node.js 24+、Git，以及至少一个支持的 Agent CLI。使用 `fnm` 时，
在仓库中运行 `fnm use` 即可切换到项目指定的大版本。

### 已验证的 CLI 兼容基线

| CLI | 已验证版本 |
| --- | ---: |
| Claude Code | `2.1.215` |
| OpenAI Codex CLI | `0.144.6` |
| GitHub Copilot CLI | `1.0.71` |

以上版本是当前实际验证基线，并非强制锁定版本。兼容和升级策略详见
[COMPATIBILITY.md](COMPATIBILITY.md)（英文标准文档）。

### 启动交互式指令台

推荐直接在 Git 仓库中启动 Strategos，然后输入开发目标：

```bash
cd /你的/项目目录
strategos
```

```text
STRATEGOS v0.13.0
Multi-agent strategy console · codex plans
~/你的/项目目录

Agents   ● claude  ·  ● codex  ·  ● copilot
Runtime  Node v24.18.0 · Git 2.55.0

What are we building?
Describe a goal. Strategos previews the plan, then runs it automatically.

────────────────────────────────────────────────────────
/help commands  ·  /mode auto  ·  preview → run
❯ 为订单列表增加 CSV 导出并补齐测试

Planning  codex is reading the repository in read-only mode...
Plan ready  proposed by codex
Flow  1 implementation  →  2 review
Auto mode  Previewing before execution...
Preview  Max parallel: 3
Executing  Starting the current plan...
```

输入普通文本后，Strategos 会立即以只读模式调用配置的 strategist CLI，让它
检查仓库并返回 JSON 任务图。默认 `hybrid` 模式会在规划结束后把 strategist
也加入健康 Worker 池，因此 Claude、Codex、Copilot 都可以接收执行任务。
Strategos 自身不接入模型 SDK、模型 API 或额外密钥。默认 `auto` 执行模式会
校验并展示 preview，随后立即创建 worker worktree 并运行任务。如果希望先人工
检查，可在输入目标前执行 `/mode manual`，之后再用 `/run` 批准执行。规划过程中
第一次按 `Ctrl+C` 只会提示中断风险，三秒内再次按下才会取消 strategist 调用；
空闲时按 `Ctrl+C` 会退出指令台。中断或失败的任务会保留本地会话记录，下次启动
会提示 `/resume`。在交互式终端中，无参数 `/resume` 会打开 Claude Code 风格的
会话选择器：使用上下键查看带标题和描述的历史会话，按 Enter 恢复，按 Esc 返回。
恢复时 strategist 会收到所选会话的原始目标、旧计划、任务进度和错误原因，并重新
检查当前仓库，只规划剩余工作。脚本或明确选择时仍可使用 `/resume <ID>`。常用命令：

```text
/new [目标]   /mode [auto|manual]  /strategist [agent]  /plan
/attach [路径]  /attachments  /detach <ID|all>  /load <文件>
/save [文件]  /preview               /run        /status [ID]
/sessions     /resume [ID]           /agents     /reload
/context      /init                  /help        /exit
```

完整流程和当前边界详见
[docs/interactive-console.md](docs/interactive-console.md)（英文标准文档）。

### 启动本地 Web UI

Web UI 与终端指令台共用同一套本地配置、Session 记录、planner、worktree
执行器和已经登录的 Agent CLI：

```bash
cd /你的/项目目录
strategos web
```

如果已经进入 Strategos 交互指令台，可以直接输入：

```text
/web
```

使用 `/web 4311` 可以指定其他本地端口。浏览器使用期间请保持指令台运行；
输入 `/exit` 时，内嵌 Web 服务会被正常关闭。

浏览器打开 `http://127.0.0.1:4310`。默认只监听本机地址；确实需要更换监听
地址或端口时再使用 `--host` 和 `--port`。
正式页面不会注入演示数据，而是直接读取当前仓库以及本地持久化的 Strategos
Session；没有历史任务时会显示干净的新任务页面。

通过左侧栏的 Projects 区域，可以添加或切换本地 Git 仓库。Projects 与
Sessions 位于同一导航层级，顶部只保留当前项目上下文。历史任务直接从按项目分组的
Sessions 列表打开，不再提供单独的 Runs 页面。所选路径会同时限定配置、
Session、附件、AI 仓库上下文、规划和 Worker 执行；项目列表只保存在本机的
`~/.strategos/projects.json`。

打开 New task 时，输入框上方会显示当前仓库、本地执行环境和 Git 分支。点击仓库名称
可以切换已注册项目或添加新的本地项目；发送任务前，所选路径会成为 strategist 的项目上下文。

Settings 用于选择默认执行模式、strategist CLI，以及成功或失败任务的桌面通知。
启用通知时浏览器会申请权限，Web UI 需要保持打开才能发送通知。Agent 是否可用由本地健康检查
及其 `enabled` 配置决定；额度和账单信息继续以各厂商 CLI 或控制台为准。
Auto 模式会展示计划后自动执行，
Manual 模式会停在计划阶段等待点击 Run。Session 历史、图片上传、Resume、
运行日志和文件变化均保留在本机。

Vite+ 开发方式和 Web 执行设置详见 [docs/web-ui.md](docs/web-ui.md)（英文标准文档）。

### 添加图片上下文

在输入任务前先附加本地图片：

```text
/attach ./screenshots/checkout-error.png
❯ 按照截图重做这个状态，并修复校验流程
```

macOS 用户也可以先复制图片，再直接输入不带路径的 `/attach`；这一能力需要
先执行 `brew install pngpaste`。`/attachments` 查看当前图片，`/detach <ID>`
移除图片。Warp 等终端不会把 Command+V 粘贴的位图暴露给子 CLI，因此 Strategos
不能直接拦截原始图片粘贴；请使用文件路径或上述剪贴板方式。

图片会校验真实格式、限制为 20 MB，保存到已忽略的
`.strategos/attachments/`，写入持久会话并在 `/resume` 时恢复。Codex 使用原生
`--image`，Copilot 使用原生 `--attachment`，Claude 则读取复制到 worktree 的
本地图片路径。

### 只有一款 CLI 时

当 Claude、Codex、Copilot 中只有一款可用时，默认 `hybrid` Worker 模式会自动
使用“单 CLI 多 session”模式。同一 CLI 的每个任务仍是独立进程/session，拥有不同的 session
ID、worktree、分支、prompt 和报告；互不重叠的任务仍按 `maxParallel` 并行。
共享上下文来自任务报告和 Strategos 会话记录，不依赖厂商自己的多 Agent 历史。

交互式终端会显示上述紧凑彩色界面；重定向输出和 CI 不会包含 ANSI 控制字符。
可设置 `NO_COLOR=1` 关闭颜色，使用 `/agents` 查看完整版本和健康详情。

### 使用 `npx` 直接运行

首次体验不需要 clone 或全局安装：

```bash
cd /你的/项目目录
npx --yes github:BigBugaboo/strategos
```

需要自动化时仍可使用非交互命令：

```bash
npx --yes github:BigBugaboo/strategos init
npx --yes github:BigBugaboo/strategos doctor
npx --yes github:BigBugaboo/strategos run .strategos/example-plan.json --dry-run
```

在 Strategos 正式发布到 npm 之前，`npx` 会从 GitHub 默认分支获取代码，
后续运行会复用 npm 缓存。

### 从 GitHub 持久安装

无需手动 clone，即可安装可复用的 `strategos` 命令：

```bash
npm install --global github:BigBugaboo/strategos
strategos --help
```

npm 全局包属于当前启用的 Node.js 环境。使用 `fnm`、Vite+、`nvm` 等
版本管理器时，需要在以后运行 Strategos 的同一套终端环境中完成安装。

### 从源码目录安装

```bash
git clone https://github.com/BigBugaboo/strategos.git
cd strategos
fnm use --install-if-missing # 已经启用 Node.js 24 时可省略
npm ci
npm run web:install
npm run verify
npm link
strategos --help
```

参与项目开发时推荐这种链接模式，源码变化会直接反映到全局命令，无需反复安装。

### 初始化目标仓库

```bash
cd /你的/项目目录
strategos init
strategos doctor
```

`strategos init` 会创建配置、共享上下文、团队记忆、示例 Plan 和
`AGENTS.md`，但不会覆盖已有文件。编辑这些文件并提交后再正式执行。

### 预览并执行 Plan

```bash
strategos run .strategos/example-plan.json --dry-run
strategos run .strategos/example-plan.json --max-parallel 3
strategos status
```

真实执行前要求仓库没有未提交变更，因为新 worktree 来自已提交的 `HEAD`。

### 排查 `command not found`

```bash
node --version
npm prefix -g
npm install -g /Strategos/仓库的绝对路径
rehash # 仅 zsh 需要
command -v strategos
strategos --help
```

参与 Strategos 本身的开发时，切换 Node.js 安装后需要重新执行 `npm link`。

### 维护 Strategos CLI

先检查当前安装方式，不执行任何修改：

```bash
strategos update --dry-run
```

确认后升级 npm 全局安装：

```bash
strategos update
strategos --version
strategos reload
```

`strategos upgrade` 仍是等价别名。源码目录、`npm link`、临时 `npx` 包和
项目本地依赖不会被自动覆盖，命令会针对识别出的安装方式打印安全升级步骤。

其他生命周期命令同样遵循保守策略：

```bash
strategos reload                    # 重新读取项目配置和 CLI 健康状态
strategos cache clear --dry-run     # 查看将被清理的 Strategos 缓存路径
strategos cache clear               # 只删除 ~/.strategos/cache
strategos uninstall --dry-run       # 查看当前安装方式对应的卸载步骤
strategos uninstall                 # 删除已确认的 npm 全局安装
```

交互指令台中也可以使用 `/reload`。卸载 CLI 不会删除项目配置、Session、附件
或运行历史；清缓存也会保留这些数据以及 `~/.strategos/projects.json`，并且不会
清理 npm、npx 或厂商 CLI 自己的缓存。安装方式差异、恢复、版本固定和 Agent CLI
升级流程详见
[docs/upgrading.md](docs/upgrading.md)（英文标准文档）。

## 建议分工

- Claude：主功能实现、大范围理解和重构。
- Codex：测试、边界条件、独立实现或代码复核。
- Copilot：GitHub 相关审查、文档和最终检查。

具体职责写在 Plan 中，不由 Strategos 硬编码。

## 安全边界

- Codex 默认使用 `read-only` 或 `workspace-write` 沙箱。
- Claude 只使用 `plan` 或 `auto` 权限模式。
- Copilot 写权限需要使用者在配置中显式增加当前版本支持的参数。
- 默认不使用任何 dangerous bypass 参数。
- 默认不 merge、不 push、不删除 worktree。
- worktree 解决的是代码冲突，不等于完整操作系统沙箱。

完整英文说明、Plan 示例、架构和灵感来源见 [README.md](README.md)。

## License

MIT
