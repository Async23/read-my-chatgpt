# Contributing

感谢你愿意改进 Conversation Reader MCP。

## 开始之前

- 使用 Node.js 22 或更高版本。
- Bug 和功能建议请先搜索现有 Issue。
- 安全问题、access token、cookie、私人会话或其他敏感材料，不要放进公开
  Issue；请使用仓库的 **Security → Report a vulnerability**。
- 测试和复现只能使用假 token、脱敏日志及虚构会话数据。

## 本地开发

```bash
git clone https://github.com/Async23/conversation-reader-mcp.git
cd conversation-reader-mcp
npm ci
npm run check
```

真实账号联调不是普通贡献的前置条件。确需联调时，token 只能通过本机环境变量
提供，不能写入测试、fixture、提交或 CI：

```bash
READ_MY_CHATGPT_ACCESS_TOKEN='…' npm run smoke
```

## 提交 Pull Request

1. 从最新 `main` 创建一个范围明确的分支。
2. 一个 PR 只解决一个问题，说明动机、行为变化和风险。
3. 新行为应带测试；修改客户端配置格式时，应覆盖保留用户已有配置的场景。
4. 修改安装、服务管理、token 或下载逻辑时，应说明失败与回滚路径。
5. 确保 `npm run check` 通过，并确认 diff 中没有凭据、个人路径或生成文件。

提交信息建议使用简洁的 Conventional Commits 风格，例如：

```text
fix: preserve existing Cursor MCP settings
test: cover Linux service uninstall
docs: clarify token rotation
```

## 项目边界

本项目保持：

- 只读，不发送、修改、归档或分享会话；
- MCP HTTP endpoint 只绑定 loopback；
- 不提供云端中转或遥测；
- 不把 ChatGPT access token 放入进程参数、日志或客户端配置；
- 不支持绕过服务条款、安全验证或账号限制的功能。

不符合这些边界的功能请求可能会被拒绝。

## 发布

版本号、Git tag、GitHub Release 和 npm 发布由维护者完成。不要在普通 PR 中
自行修改版本或创建发布 tag，除非该 PR 明确用于发版。
