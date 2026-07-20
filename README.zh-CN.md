# Strategos（策略家）

Strategos 是一个本地优先的多 AI 编程代理调度器，面向 Claude Code、
OpenAI Codex CLI 和 GitHub Copilot CLI。

你给出一个目标和任务依赖图，Strategos 会把已经就绪的任务分派给不同
CLI，并为每个任务建立独立 Git worktree。项目上下文、上游任务报告、
日志、分支和变更文件都会留在本机，供你最终审查。

> 当前为早期 MVP。默认不自动合并，也不自动推送 Agent 生成的分支。

## 解决什么问题

- 用 `AGENTS.md`、项目上下文、团队记忆和上游报告形成共享上下文。
- 通过显式任务依赖图控制分工，而不是让一个黑盒模型随意调度。
- 无依赖任务并行执行，数量由 `maxParallel` 限制。
- 每个任务一个 worktree 和分支，避免三个 Agent 同时覆盖文件。
- Claude、Codex、Copilot 使用本机已经登录的 CLI，不额外代理账号和密钥。
- 所有运行证据保存在 `.strategos/runs/<run-id>/`。

## 快速开始

需要 Node.js 24+、Git，以及至少一个支持的 Agent CLI。使用 `fnm` 时，
在仓库中运行 `fnm use` 即可切换到项目指定的大版本。

```bash
git clone https://github.com/BigBugaboo/strategos.git
cd strategos
npm link

cd /你的/项目目录
strategos init
strategos doctor
```

编辑并提交 `.strategos/example-plan.json` 后运行：

```bash
strategos run .strategos/example-plan.json --dry-run
strategos run .strategos/example-plan.json --max-parallel 3
strategos status
```

真实执行前要求仓库没有未提交变更，因为新 worktree 来自已提交的 `HEAD`。

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
