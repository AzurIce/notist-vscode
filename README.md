# Notist for Visual Studio Code

为 `.not`（Markup）、`.notc`（Code）和 `.nmd` / `.notmd`（Notist Markdown）提供 TextMate 语法高亮，并连接 `notist lsp`，使用服务端提供的诊断、悬停、跳转定义和文档符号功能。不包含预览，也不捆绑 Notist CLI。Notist Markdown 复用 VS Code 内置 Markdown 语法，并注入 Notist 调用、导入和注解高亮；普通 Markdown 和代码块不注入。

## 使用

先安装启用了 `lsp` feature 的 Notist CLI（默认启用），确保 `notist` 在 VS Code 扩展宿主的 PATH 中。打开 `.not` / `.notc` / `.nmd` / `.notmd` 文件即可启动语言服务器，无需 `Notist.toml`。

普通 `.md` / `.markdown` 文件保留内置 Markdown 语言关联，不自动连接 Notist LSP。在状态栏语言模式或 **Change Language Mode** 中选择 **Notist Markdown** 后即可连接，无需重命名文件；切回 Markdown 后停止同步该文档。磁盘上的 Markdown 依赖变更仍会通知已运行的服务器。

**输出 → Notist** 会记录启动命令和 `Language server ready`。没有高亮变化不代表 LSP 未启动；可在 Notist 函数调用上验证悬停和定义跳转。

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

推荐使用 Nix：`nix develop` 进入包含 Node.js 22、npm、Git、GitHub CLI 和 actionlint 的开发环境。使用 direnv 时先运行 `direnv allow`，即可通过 `.envrc` 自动加载。`flake.lock` 锁定工具链，CI 和开发构建使用同一环境。也可以自行安装 Node.js 22+ 和 npm。

```sh
npm ci
npm run build
npm test
```

真实编辑器端到端测试使用隔离的用户数据、扩展目录和临时工作区，不修改日常编辑器配置。指定 Electron 可执行文件（不是会立即返回的 CLI 包装器）及 CLI 绝对路径：

```sh
VSCODE_EXECUTABLE=/absolute/path/to/code-electron NOTIST_BIN=/absolute/path/to/notist npm run test:editor
```

测试验证 `.md` 切换语言自动激活、Hover、定义跳转、诊断、切回 Markdown 清除诊断，以及 `.nmd` / `.notmd` 自动识别。测试工作区不含 `Notist.toml`。Linux 无图形环境时可使用 `xvfb-run`。

设置 `VSCODE_MARKDOWN_GRAMMAR` 为编辑器自带的 `extensions/markdown-basics/syntaxes/markdown.tmLanguage.json` 路径后运行 `npm test`，还会验证真实 Markdown grammar 中的注入和代码块隔离。

在 VS Code 中打开本仓库，按 F5 启动扩展开发窗口。持续构建使用 `npm run watch`。

```sh
npm run package
code --install-extension notist-vscode-0.1.0.vsix
```

高亮测试使用真实 TextMate / Oniguruma 引擎，覆盖 Markup、Code、嵌套注释和模式切换。高亮是词法近似，不替代 Notist 解析器；服务端目前未提供语义高亮。

## Release

在 GitHub 的 **Actions → Release → Run workflow** 手动触发。默认启用 `publish_dev`：成功后更新固定 tag `dev-build` 对应的 prerelease，标题为 `Dev Build yyyy-mm-dd`（UTC），覆盖标题、说明、tag 指向和附件，只保留本次构建的 `notist-vscode-dev.vsix`。关闭 `publish_dev` 则仅构建，不修改任何 release 或 tag。

手动构建的 VSIX 标记为扩展预发布版本。推送与 `package.json` 版本完全对应的 `v*` tag（例如 `v0.1.0`）会发布正式 GitHub Release，不标记为扩展预发布版本。两种构建均上传 Actions artifact，保留 7 天；普通分支 push 不触发 Release。

所有 VSIX 均需单独安装 Notist CLI。工作流使用仓库自带的 `GITHUB_TOKEN`，仅发布 job 获得写权限，无需额外配置发布密钥。
