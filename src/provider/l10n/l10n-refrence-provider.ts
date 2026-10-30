import * as vscode from "vscode";
import * as fs from "fs";
import { FlutterModule, FlutterSdk } from "../../sdk";
import { disposeAll } from "../../utils/utils";
import Logger from "../../utils/logger";
import { executeReferenceProvider } from "../../utils/build-in-command-utils";
import path from "path";
import { jsonKeyRegex } from "../../utils/regexp-utils";

const _tag = "L10nReferenceProvider";

/**
 * 国际化语言跳转引用位置实现
 */
export class L10nReferenceProvider
  implements
    vscode.ReferenceProvider,
    vscode.DefinitionProvider,
    vscode.Disposable
{
  private disposableList: vscode.Disposable[] = [];
  private providers: Map<string, L10nReferenceProviderModule> = new Map<
    string,
    L10nReferenceProviderModule
  >();

  constructor(private readonly sdk: FlutterSdk) {
    let disposable = vscode.languages.registerReferenceProvider(
      { scheme: "file", pattern: "**/*.arb" },
      this,
    );
    this.disposableList.push(disposable);

    disposable = vscode.languages.registerDefinitionProvider(
      { scheme: "file", pattern: "**/*.arb" },
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
    return this.findReference(document, position, undefined, token);
  }

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Location[]> {
    return this.findReference(document, position, context, token);
  }

  async findReference(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext | undefined,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[] | null> {
    let path = document.uri.path;
    let provider = this.providers.get(path);
    if (provider != null) {
      return provider.findReference(document, position, context, token);
    }

    let module = this.sdk.getModule(path);
    if (module == null) {
      return null;
    }

    provider = new L10nReferenceProviderModule(module);
    this.providers.set(path, provider);
    return provider.findReference(document, position, context, token);
  }
}

/**
 * 国际化语言跳转引用位置实现
 */
class L10nReferenceProviderModule implements vscode.Disposable {
  private arbFiles: vscode.Uri[] | undefined;
  private arbDir: vscode.Uri | undefined;
  private outputLocalizationFile: vscode.Uri | undefined;
  private arbDirWatcher: vscode.Disposable | undefined;
  private arbOutputFileWatcher: vscode.Disposable | undefined;
  private arbConfigWatcher: vscode.Disposable | undefined;
  private _moduleName: string;

  constructor(private readonly module: FlutterModule) {
    this._moduleName = path.basename(this.module.workspace.fsPath);
  }

  dispose() {
    this.arbFiles = undefined;
    this.arbDir = undefined;
    this.closeArbDirWatcher();
    this.outputLocalizationFile = undefined;
    this.closeArbOutputDirWatcher();
    this.closeConfigWatcher();
  }

  async findReference(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext | undefined,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[] | null> {
    let line = document.lineAt(position.line);
    let text = document.getText(line.range);
    let keyValue = text.split(":");
    if (keyValue.length != 2) {
      return null;
    }

    let key = keyValue[0].replaceAll('"', "").trim();
    let result = this.getArbFiles(context == undefined);
    let refrences: vscode.Location[] = [];
    let outputLocalizationFile = result.outputLocalizationFile;
    if (outputLocalizationFile) {
      const findFiles = await this.findOutputReference(
        token,
        outputLocalizationFile,
        key,
      );
      if (findFiles) {
        refrences = findFiles;
      }
    }

    let arbFiles = result.arbFiles;
    if (context || !this.arbFiles) {
      // 查找引用
      return refrences;
    }

    let finds = await this.findArbDefinition(document, token, arbFiles!, key);
    if (finds) {
      refrences.push(...finds);
    }
    return refrences.length == 0 ? null : refrences;
  }

  // 获取引用
  private async findOutputReference(
    token: vscode.CancellationToken,
    outputLocalizationFile: vscode.Uri,
    key: string,
  ): Promise<vscode.Location[] | null> {
    let readText = fs.readFileSync(outputLocalizationFile.fsPath, "utf-8");
    let lines = readText.split(/\r?\n/);
    let pos: vscode.Position | undefined;
    for (let i = 0; i < lines.length; i++) {
      if (token.isCancellationRequested) {
        return null;
      }

      let line = lines[i];
      let method = `String get ${key}`;
      let indexOf = line.indexOf(method);
      if (indexOf != -1) {
        pos = new vscode.Position(i, indexOf + "String get ".length + 1);
        break;
      }
    }

    let refrences: vscode.Location[] = [];
    if (pos) {
      let finds = await executeReferenceProvider(outputLocalizationFile, pos);

      if (token.isCancellationRequested) {
        return null;
      }

      if (finds) {
        refrences.push(...finds);
      }
    }

    return refrences;
  }

  // 获取引用
  private async findArbDefinition(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
    arbFiles: vscode.Uri[],
    key: string,
  ): Promise<vscode.Location[] | null> {
    let refrences: vscode.Location[] = [];
    for (const element of arbFiles) {
      if (token.isCancellationRequested) {
        return null;
      }

      try {
        if (element.path == document.uri.path) {
          continue;
        }

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
              refrences.push(location);
            }
          }
        }
      } catch (e) {
        Logger.e(e);
        continue;
      }
    }
    return refrences;
  }

  private getArbFiles(findArb: boolean) {
    if (this.outputLocalizationFile) {
      if (findArb) {
        if (this.arbFiles) {
          return {
            outputLocalizationFile: this.outputLocalizationFile,
            arbFiles: this.arbFiles,
          };
        }
      } else {
        return {
          outputLocalizationFile: this.outputLocalizationFile,
          arbFiles: this.arbFiles,
        };
      }
    }

    let arbDir: vscode.Uri | undefined;
    var outputLocalizationFile: vscode.Uri | undefined;
    const document = this.module.getL10nYaml();
    if (document) {
      arbDir = this.module.getL10nYamlArbDirUri(document);
      outputLocalizationFile = this.module.getL10nYamlOutputFileUri(document);
    }

    if (
      !outputLocalizationFile ||
      !fs.existsSync(outputLocalizationFile.fsPath)
    ) {
      this.outputLocalizationFile = undefined;
      this.closeArbOutputDirWatcher();
    } else if (this.outputLocalizationFile != outputLocalizationFile) {
      this.outputLocalizationFile = outputLocalizationFile;
      this.setArbOutputDirWatcher(outputLocalizationFile);
    }

    if (!findArb) {
      return {
        outputLocalizationFile,
        arbFiles: this.arbFiles,
      };
    }

    let uris: vscode.Uri[] = [];
    if (!arbDir || !fs.existsSync(arbDir.fsPath)) {
      this.arbDir = undefined;
      this.arbFiles = undefined;
      this.closeArbDirWatcher();
    } else {
      let children = fs.readdirSync(arbDir.fsPath);
      for (const element of children) {
        if (element.toLowerCase().endsWith(".arb")) {
          uris.push(vscode.Uri.joinPath(arbDir, element));
        }
      }
      this.arbFiles = uris;
      if (this.arbDir != arbDir) {
        this.arbDir = arbDir;
        this.setArbDirWatcher(arbDir);
      }
    }

    if (!this.arbConfigWatcher) {
      this.setupConfigWatcher();
    }

    return {
      outputLocalizationFile,
      arbFiles: uris,
    };
  }

  private setArbDirWatcher(arbDir: vscode.Uri) {
    this.closeArbDirWatcher();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(arbDir, "**"),
    );

    let change = () => {
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

  private closeArbDirWatcher() {
    if (this.arbDirWatcher) {
      this.arbDirWatcher?.dispose();
      this.arbDirWatcher = undefined;
      Logger.d(`${this._moduleName}-${_tag}:已关闭arb目录监听`);
    }
  }

  private setArbOutputDirWatcher(outputFile: vscode.Uri) {
    this.closeArbOutputDirWatcher();
    const pattern = new vscode.RelativePattern(
      this.module.workspace,
      path.relative(this.module.workspace.fsPath, outputFile.fsPath),
    );

    const watcher = vscode.workspace.createFileSystemWatcher(
      pattern,
      true,
      true,
    );

    let change = () => {
      this.outputLocalizationFile = undefined;
    };
    // 监听创建事件
    watcher.onDidCreate(change);
    // 监听修改事件
    watcher.onDidChange(change);
    // 监听删除事件
    watcher.onDidDelete(change);
    this.arbOutputFileWatcher = watcher;
    Logger.d(`${this._moduleName}-${_tag}:已开启arb output目录监听`);
  }

  private closeArbOutputDirWatcher() {
    if (this.arbOutputFileWatcher) {
      this.arbOutputFileWatcher?.dispose();
      this.arbOutputFileWatcher = undefined;
      Logger.d(`${this._moduleName}-${_tag}:已关闭arb output目录监听`);
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
      this.closeArbDirWatcher();
      this.outputLocalizationFile = undefined;
      this.closeArbOutputDirWatcher();
    });
    watcher.onDidDelete(() => {
      Logger.d(`${this._moduleName}-${_tag}:l10n.yaml被删除了`);
      this.arbFiles = undefined;
      this.arbDir = undefined;
      this.closeArbDirWatcher();
      this.outputLocalizationFile = undefined;
      this.closeArbOutputDirWatcher();
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
