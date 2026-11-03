# AGENTS.md: guide for AI agents and contributors

flutter-dev-tools 是一个辅助Flutter开发的vscode插件，采用**ts**语言开发，尽量不要使用**js**进行开发。此插件依赖[Dart](https://github.com/Dart-Code/Dart-Code)插件。


## 1. 项目结构

```text
src/
  utils                      公共的工具类
  command                    插件注册的命令
  provider                   插件注册的Provider，比如提供项目结构树、路由定义，文本定义，图片文档定义等
  views                      插件注册的界面
  test                       测试代码
```

## 2. 常用命令与验证

```bash
npm run check-types   # tsc --noEmit，改完必跑
npm run lint          # eslint src，改完必跑
npm run compile       # check-types + lint + esbuild，产出 dist
npm run package       # 生产构建，发布前使用
npm run watch         # 监听编译，F5 调试时由 .vscode/tasks.json 自动启动
npm test              # 仅有一个示例用例，覆盖极少，不能作为验证依据
```

改动完成后至少执行 `npm run check-types` 和 `npm run lint`。

以下功能必须按 F5（Run Extension）手动验证，静态检查无法覆盖：

- 右键菜单与子菜单（`explorer/context`、`editor/context`）的显示条件
- 资源管理器 Project 视图、Activity Bar 的 Resource Manager webview
- 命令面板中命令的可见性（`when` 条件）
- 涉及文件读写的功能（多语言、图片资源、模板文件）在真实项目上的结果

## 3. rules
 1. 语法规则要符合eslint检查
 2. 不要过度设计，如果觉得很有必要可以先询问，通过再执行
 3. 需求如果明确指定只关心哪个目录下的内容，就不要主动关联/读取其它目录下的内容，如果觉得有必要读取，需要先询问，通过再执行
 4. 代码通用部分最大限度进行复用，可抽取的公共方法或类可单独拎出来放到一个独立文件中

## 4. 禁区

1. 不修改依赖版本、不新增依赖、不更新 `package-lock.json`；确需变更必须先询问。
2. 不手动编辑 `dist/`、`out/`、`*.vsix`，它们均由构建生成且已在 `.gitignore` 中。
3. 不改动或重命名已有命令 ID（属于对外契约）；新增命令必须同时修改 `package.json` 的 `contributes.commands`、对应 `menus`、以及 `src/command` 中的注册。
4. 不修改 `engines`、`extensionDependencies`、`activationEvents`、`extensionKind`、`capabilities` 等清单契约字段，除非需求明确要求。
5. 阿里翻译 AK/SK 只能从配置读取，禁止硬编码、写入日志或提交到仓库。
6. 不修改与需求无关的文件，不顺手重构、不批量格式化。

## 5. 在你完成一项任务之前
对于每次需求的改动，都要在[update](./docs/update)目录下记录改动日志，日期按天分类(如：2026-10-15.md)。内容按照需求进行分类，最新的需求改动放到顶部，同一个需求的改动在后面追加即可。
