import * as vscode from "vscode";
import * as fs from "fs";
import { FlutterModule, FlutterSdk } from "../../sdk";
import { disposeAll } from "../../utils/utils";
import Logger from "../../utils/logger";
import { jsonKeyRegex, strCallRegex } from "../../utils/regexp-utils";
import path from "path";

const _tag = "L10nDefinitionProvider";

/**
 * 国际化语言跳转定义位置实现
 */
export class L10nDefinitionProvider
  implements vscode.DefinitionProvider, vscode.Disposable
{
  private disposableList: vscode.Disposable[] = [];
  private providers: Map<string, L10nDefinitionProviderModule> = new Map<
    string,
    L10nDefinitionProviderModule
  >();

  constructor(private readonly sdk: FlutterSdk) {
    let disposable = vscode.languages.registerDefinitionProvider(
      { language: "dart", scheme: "file" },
      this,
    );
    this.disposableList.push(disposable);
  }

  dispose() {
    for (const element of this.providers.values()) {
      element.dispose();
    }
    this.providers.clear();
    disposeAll(this.disposableList);
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    let path = document.uri.path;
    let provider = this.providers.get(path);
    if (provider != null) {
      return provider.findDefinition(document, position, token);
    }

    let module = this.sdk.getModule(path);
    if (module == null) {
      return null;
    }

    provider = new L10nDefinitionProviderModule(module);
    this.providers.set(path, provider);
    return provider.findDefinition(document, position, token);
  }
}

class L10nDefinitionProviderModule
  implements vscode.DefinitionProvider, vscode.Disposable
{
  private arbFiles: vscode.Uri[] | undefined;
  private arbDir: vscode.Uri | undefined;
  private arbDirWatcher: vscode.Disposable | undefined;
  private arbConfigWatcher: vscode.Disposable | undefined;
  private _moduleName: string;

  constructor(private readonly module: FlutterModule) {
    this._moduleName = path.basename(this.module.workspace.fsPath);
  }

  dispose() {
    this.arbFiles = undefined;
    this.arbDir = undefined;
    this.closeWatcher();
    this.closeConfigWatcher();
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    return this.findDefinition(document, position, token);
  }

  async findDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | null> {
    let textLine = document.lineAt(position.line);
    let text = document.getText(textLine.range);
    let matchAll = text.matchAll(strCallRegex);
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
    let translateList: vscode.Location[] = [];
    let arbFiles = this.getArbFiles();
    for (const element of arbFiles) {
      if (token.isCancellationRequested) {
        return null;
      }

      try {
        let content = fs.readFileSync(element.fsPath, "utf-8");
        if (!content || content.length == 0) {
          continue;
        }

        let lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          let match = line.match(jsonKeyRegex);
          if (match) {
            let key2 = match[0].substring(0, match[0].length - 1).trim();
            if (key2 == `"${key}"`) {
              let location = new vscode.Location(
                element,
                new vscode.Position(i, match.index ?? 0),
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

    let arbDir = this.module.getL10nYamlArbDirUri();
    if (!arbDir || !fs.existsSync(arbDir.fsPath)) {
      this.arbDir = undefined;
      this.closeWatcher();
      return [];
    }

    let children = fs.readdirSync(arbDir.fsPath);
    let uris: vscode.Uri[] = [];
    for (const element of children) {
      if (element.toLowerCase().endsWith(".arb")) {
        uris.push(vscode.Uri.joinPath(arbDir, element));
      }
    }

    if (uris.length == 0) {
      return uris;
    }

    this.arbFiles = uris;
    if (!this.arbConfigWatcher) {
      this.setupConfigWatcher();
    }

    if (this.arbDir != arbDir || !this.arbDirWatcher) {
      this.arbDir = arbDir;
      this.setWatcher(arbDir);
    }

    return uris;
  }

  private setWatcher(arbDir: vscode.Uri) {
    this.closeWatcher();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(arbDir, "**"),
    );

    let change = (uri: vscode.Uri) => {
      this.arbFiles = undefined;
    };
    // 监听创建事件
    watcher.onDidCreate(change);
    // 监听修改事件
    watcher.onDidChange(change);
    // 监听删除事件
    watcher.onDidDelete(change);
    this.arbDirWatcher = watcher;
    Logger.d(`${this._moduleName}-${_tag}:已开启arb目录监听`);
  }

  private closeWatcher() {
    if (this.arbDirWatcher) {
      this.arbDirWatcher?.dispose();
      this.arbDirWatcher = undefined;
      Logger.d(`${this._moduleName}-${_tag}:已关闭arb目录监听`);
    }
  }

  private setupConfigWatcher() {
    this.closeConfigWatcher();
    let l10nFilePath = vscode.Uri.joinPath(this.module.workspace, "l10n.yaml");
    if (!fs.existsSync(l10nFilePath.fsPath)) {
      return;
    }

    // 监听文件系统变化（包括编辑器保存、fs.writeFileSync 等所有写入操作）
    const pattern = new vscode.RelativePattern(
      this.module.workspace,
      path.relative(this.module.workspace.fsPath, l10nFilePath.fsPath),
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern, true);
    watcher.onDidChange(() => {
      Logger.d(`${this._moduleName}-${_tag}:l10n.yaml发生了变化`);
      this.arbFiles = undefined;
      this.arbDir = undefined;
      this.closeWatcher();
    });
    watcher.onDidDelete(() => {
      Logger.d(`${this._moduleName}-${_tag}:l10n.yaml被删除了`);
      this.arbFiles = undefined;
      this.arbDir = undefined;
      this.closeWatcher();
      this.closeConfigWatcher();
    });
    this.arbConfigWatcher = watcher;
    Logger.d(`${this._moduleName}-${_tag}:已开启arb配置文件监听`);
  }

  private closeConfigWatcher() {
    if (this.arbConfigWatcher) {
      this.arbConfigWatcher?.dispose();
      this.arbConfigWatcher = undefined;
      Logger.d(`${this._moduleName}-${_tag}:已关闭arb配置文件监听`);
    }
  }
}
