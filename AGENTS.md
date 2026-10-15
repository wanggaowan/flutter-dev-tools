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

## 2. rules
 1. 语法规则要符合eslint检查
 2. 不要随意修改依赖库的版本，修改前要先询问，通过再执行
 3. 不要过度设计，如果觉得很有必要可以先询问，通过再执行
 4. 需求如果明确指定只关心哪个目录下的内容，就不要主动关联/读取其它目录下的内容，如果觉得有必要读取，需要先询问，通过再执行
 5. 代码通用部分最大限度进行复用，可抽取的公共方法或类可单独拎出来放到一个独立文件中

## 3. 在你完成一项任务之前
对于每次需求的改动，都要在[update](./docs/update)目录下记录改动日志，日期按天分类(如：2026-10-15.md)。内容按照需求进行分类，最新的需求改动放到顶部，同一个需求的改动在后面追加即可。
