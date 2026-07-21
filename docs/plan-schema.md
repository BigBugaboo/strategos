# Plan schema v1

## Root fields

| Field | Required | Description |
|---|---:|---|
| `version` | yes | Must be `1`. |
| `goal` | yes | Overall outcome shared with every worker. |
| `context` | no | Repository-relative files shared with every task. |
| `attachments` | no | Repository-relative image paths managed by Strategos and shared with every task. |
| `tasks` | yes | One or more task objects. |

## Task fields

| Field | Required | Description |
|---|---:|---|
| `id` | yes | Unique alphanumeric, `_`, or `-` identifier. |
| `agent` | yes | `claude`, `codex`, or `copilot`. |
| `mode` | no | `write` (default) or `read-only`. |
| `prompt` | yes | Focused assignment and acceptance criteria. |
| `dependsOn` | no | Task ids that must succeed first. |
| `context` | no | Extra repository-relative context files. |

Dependencies form a directed acyclic graph. If a dependency fails, its
dependants are skipped instead of running with incomplete assumptions.
