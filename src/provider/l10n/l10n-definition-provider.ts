import * as vscode from "vscode";
import * as fs from "fs";
import * as yaml from "yaml";
import pathUtils from "path";
import { DartSdk, FlutterSdk } from "../../sdk";
import { disposeAll } from "../../utils/utils";
import Logger from "../../utils/logger";

/**
 * 国际化语言跳转定义位置实现
 */
export class L10nDefinitionProvider
  implements vscode.DefinitionProvider, vscode.Disposable
{
  private disposableList: vscode.Disposable[] = [];
  private arbFiles: string[] | undefined;
  private arbDirWatcher: vscode.Disposable | undefined;

  constructor(private readonly sdk: FlutterSdk) {
    let disposable = vscode.languages.registerDefinitionProvider(
      { language: "dart", scheme: "file" },
      this
    );
    this.disposableList.push(disposable);
  }

  dispose() {
    this.arbDirWatcher?.dispose();
    disposeAll(this.disposableList);
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    let dartSdk = this.sdk.dartSdk;
    if (!dartSdk) {
      return null;
    }
    return this.findDefinition(dartSdk, document, position, token);
  }

  async findDefinition(
    dartSdk: DartSdk,
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | null> {
    let textLine = document.lineAt(position.line);
    let text = document.getText(textLine.range);
    // 匹配S.current.xxx或S.of(xxx).xxx格式字符串
    let regex = new RegExp(
      /S\s*.\s*(of\(.*\)|current)\s*.\s*[a-zA-Z_][a-zA-Z_0-9]*/g
    );
    let matchAll = text.matchAll(regex);
    if (!matchAll) {
      return null;
    }

    let matchText: string | null = null;
    for (const element of matchAll) {
      if (element) {
        let text2 = element[0];
        if (
          element.index <= position.character &&
          position.character <= element.index + text2.length
        ) {
          matchText = text2;
          break;
        }
      }
    }

    if (!matchText || matchText.length == 0) {
      return null;
    }

    let splits = matchText.split(".");
    let key = splits[splits.length - 1];
    let arbFiles = this.getArbFiles();
    let translateList: vscode.Location[] = [];
    for (const element of arbFiles) {
      try {
        let content = fs.readFileSync(element, "utf-8");
        if (!content || content.length == 0) {
          continue;
        }

        let lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          let keyValue = line.split(":");
          if (keyValue.length == 2) {
            let key2 = keyValue[0].trim();
            if (key2 == `"${key}"`) {
              let location = new vscode.Location(
                vscode.Uri.file(element),
                new vscode.Position(i, keyValue[0].length - key2.length + 1)
              );
              translateList.push(location);
            }
          }
        }
      } catch (e) {
        Logger.e(e);
        continue;
      }
    }

    return translateList.length == 0 ? null : translateList;
  }

  private getArbFiles() {
    if (this.arbFiles != undefined) {
      return this.arbFiles;
    }

    let rootDirPath = this.sdk.workspace.path;
    let resDirPath = "lib/l10n";
    let resName = "app_en.arb";
    let l10nFilePath = vscode.Uri.joinPath(this.sdk.workspace, "l10n.yaml");
    if (fs.existsSync(l10nFilePath.path)) {
      let contents = fs.readFileSync(l10nFilePath.fsPath, "utf-8");
      let result = yaml.parseDocument(contents);
      let projectDir = result.get("project-dir");
      if (
        typeof projectDir === "string" &&
        projectDir &&
        projectDir.length > 0
      ) {
        rootDirPath = projectDir;
      }

      let arbDir = result.get("arb-dir");
      if (typeof arbDir === "string" && arbDir && arbDir.length > 0) {
        resDirPath = arbDir;
      }

      let templateArbFile = result.get("template-arb-file");
      if (
        typeof templateArbFile === "string" &&
        templateArbFile &&
        templateArbFile.length > 0
      ) {
        resName = templateArbFile;
      }
    }

    let arbDir = pathUtils.join(rootDirPath, resDirPath);
    let children = fs.readdirSync(arbDir);
    let uris: string[] = [];
    let tempUri: string | undefined;
    for (const element of children) {
      if (element.toLowerCase().endsWith(".arb")) {
        if (element == resName) {
          tempUri = pathUtils.join(arbDir, element);
        } else {
          uris.push(pathUtils.join(arbDir, element));
        }
      }
    }

    this.arbDirWatcher?.dispose();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(arbDir, "**"),
      false, // 是否忽略创建事件
      false, // 是否忽略修改事件
      false // 是否忽略删除事件
    );

    let change = (uri: vscode.Uri) => {
      this.arbFiles = undefined;
      this.arbDirWatcher?.dispose();
      this.arbDirWatcher = undefined;
    };
    // 监听创建事件
    watcher.onDidCreate(change);
    // 监听修改事件
    watcher.onDidChange(change);
    // 监听删除事件
    watcher.onDidDelete(change);
    this.arbDirWatcher = watcher;

    return tempUri ? [tempUri, ...uris] : uris;
  }
}
