# Notist for Visual Studio Code

为 `.not`（Markup）和 `.notc`（Code）提供 TextMate 语法高亮，并连接 `notist lsp`，使用服务端提供的诊断、悬停、跳转定义和文档符号功能。不包含预览，也不捆绑 Notist CLI。

## 使用

先安装启用了 `lsp` feature 的 Notist CLI（默认启用），确保 `notist` 在 VS Code 扩展宿主的 PATH 中。打开 `.not` / `.notc` 文件即可启动语言服务器。

也可以在 VS Code 设置中指定可执行文件：

```json
{
  "notist.server.path": "/absolute/path/to/notist",
  "notist.server.args": ["lsp"]
}
```

`server.path` 是可执行文件路径，不是 shell 命令。参数独立放在 `server.args` 中；指定项目配置可使用 `["lsp", "--config", "/absolute/path/to/Notist.toml"]`。默认以所在工作区文件夹为工作目录，多根工作区分别启动服务器；未属于工作区的本地文件按所在目录启动。设置变化后自动重启，也可执行 **Notist: Restart Language Server**。启动失败和通信日志可在 **输出 → Notist** 中查看；`notist.trace.server` 控制协议跟踪。

未受信任的工作区只提供高亮，不启动 CLI。Remote SSH / WSL / Dev Container 中，扩展和 Notist CLI 应安装在远端。

## 开发与安装

需要 Node.js 22+ 和 npm。

```sh
npm ci
npm run build
npm test
```

在 VS Code 中打开本仓库，按 F5 启动扩展开发窗口。持续构建使用 `npm run watch`。

```sh
npm run package
code --install-extension notist-vscode-0.1.0.vsix
```

高亮测试使用真实 TextMate / Oniguruma 引擎，覆盖 Markup、Code、嵌套注释和模式切换。高亮是词法近似，不替代 Notist 解析器；服务端目前未提供语义高亮。
