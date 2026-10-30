import * as vscode from "vscode";
import * as fs from "fs";
import { FlutterModule, FlutterSdk } from "../../sdk";
import { disposeAll } from "../../utils/utils";
import { strCallRegexWithEndSymbol } from "../../utils/regexp-utils";
import { ConfigUtils } from "../../utils/config-utils";
import path from "path";
import Logger from "../../utils/logger";

const _tag = "L10nFoldingProvider";

/**
 * 在 S.current.xxx / S.of(context).xxx 调用位置，用 ARB 真实文本覆盖原始代码显示
 */
export class L10nFoldingProvider implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];
  private providers: Map<string, L10nFoldingProviderModule> = new Map<
    string,
    L10nFoldingProviderModule
  >();

  constructor(private readonly sdk: FlutterSdk) {
    this.disposableList.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.update(editor);
        }
      }, null),
    );

    this.disposableList.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        let editor = vscode.window.activeTextEditor;
        if (editor && e.document === editor.document) {
          this.update(editor);
        }
      }, null),
    );

    this.disposableList.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("flutterDevTools.showL10nText")) {
          let editor = vscode.window.activeTextEditor;
          if (editor) {
            this.update(editor);
          }
        }
      }),
    );

    let editor = vscode.window.activeTextEditor;
    if (editor) {
      this.update(editor);
    }
  }

  dispose() {
    for (const element of this.providers.values()) {
      element.dispose();
    }
    this.providers.clear();
    disposeAll(this.disposableList);
  }

  private update(editor: vscode.TextEditor) {
    if (editor.document.languageId !== "dart") {
      return;
    }

    let documentUri = editor.document.uri;
    let provider = this.getProvider(documentUri);
    if (provider == null) {
      return;
    }

    provider.updateDecorations(editor);
  }

  private getProvider(
    documentUri: vscode.Uri,
  ): L10nFoldingProviderModule | null {
    let provider = this.providers.get(documentUri.path);
    if (provider != null) {
      return provider;
    }

    const module = this.sdk.getModule(documentUri);
    if (module == null) {
      return null;
    }

    provider = new L10nFoldingProviderModule(this.sdk, module);
    this.providers.set(documentUri.path, provider);
    return provider;
  }
}

class L10nFoldingProviderModule implements vscode.Disposable {
  private arbCache: Record<string, any> | undefined;
  private arbFilePath: vscode.Uri | undefined;
  private arbFileWatcher: vscode.Disposable | undefined;
  private arbConfigWatcher: vscode.Disposable | undefined;
  private afterDecoration = vscode.window.createTextEditorDecorationType({});
  private _moduleName: string;

  constructor(
    readonly sdk: FlutterSdk,
    readonly module: FlutterModule,
  ) {
    this._moduleName = path.basename(this.module.workspace.fsPath);
  }

  dispose() {
    this.arbCache = undefined;
    this.arbFilePath = undefined;
    this.closeArbWatcher();
    this.closeConfigWatcher();
    this.afterDecoration.dispose();
  }

  private getArbValue(key: string): string | null {
    if (!this.arbCache) {
      let arbFile = this.getTemplateArbFile();
      if (!arbFile) {
        return null;
      }
      this.arbCache = this.parseArbFile(arbFile.fsPath);
    }

    const value = this.arbCache[key];
    if (typeof value === "string") {
      return value;
    }

    return null;
  }

  private parseArbFile(filePath: string): Record<string, any> {
    try {
      let content = fs.readFileSync(filePath, "utf-8");
      if (!content) {
        return {};
      }

      return JSON.parse(content);
    } catch (e) {
      // ignore
    }
    return {};
  }

  private getTemplateArbFile(): vscode.Uri | undefined {
    let arbFilePath = this.arbFilePath;
    if (!arbFilePath) {
      arbFilePath = this.module.getL10nYamlArbFileUri();
    }

    if (!arbFilePath || !fs.existsSync(arbFilePath.fsPath)) {
      this.arbFilePath = undefined;
      this.closeArbWatcher();
      return undefined;
    }

    if (!this.arbConfigWatcher) {
      this.setupConfigWatcher();
    }

    if (arbFilePath != this.arbFilePath || !this.arbFileWatcher) {
      this.arbFilePath = arbFilePath;
      this.setupArbWatcher(arbFilePath);
    }

    return arbFilePath;
  }

  private setupArbWatcher(arbFilePath: vscode.Uri) {
    this.closeArbWatcher();
    // 监听文件系统变化（包括编辑器保存、fs.writeFileSync 等所有写入操作）
    const pattern = new vscode.RelativePattern(
      this.module.workspace,
      path.relative(this.module.workspace.fsPath, arbFilePath.fsPath),
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern, true);
    let onChange = () => {
      this.arbCache = undefined;
      Logger.d(`${this._moduleName}-${_tag}:文件发生变化`, arbFilePath);
      this.onConfigChange();
    };
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    this.arbFileWatcher = watcher;
    Logger.d(`${this._moduleName}-${_tag}:已开启arb文件监听`);
  }

  private closeArbWatcher() {
    if (this.arbFileWatcher) {
      this.arbFileWatcher?.dispose();
      this.arbFileWatcher = undefined;
      Logger.d(`${this._moduleName}-${_tag}:已关闭arb文件监听`);
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
      this.arbCache = undefined;
      this.arbFilePath = undefined;
      this.closeArbWatcher();
      this.onConfigChange();
    });
    watcher.onDidDelete(() => {
      Logger.d(`${this._moduleName}-${_tag}:l10n.yaml被删除了`);
      this.arbCache = undefined;
      this.arbFilePath = undefined;
      this.closeArbWatcher();
      this.closeConfigWatcher();
      this.onConfigChange();
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

  private onConfigChange() {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    if (editor.document.languageId !== "dart") {
      return;
    }

    let documentUri = editor.document.uri;
    const module = this.sdk.getModule(documentUri);
    if (module == null || module != this.module) {
      return;
    }
    this.updateDecorations(editor);
  }

  updateDecorations(editor: vscode.TextEditor) {
    let text = editor.document.getText();
    let afterDecorations: vscode.DecorationOptions[] = [];
    for (const match of text.matchAll(strCallRegexWithEndSymbol)) {
      if (!match || !match[0]) {
        continue;
      }

      let key = this.extractKey(match[0]);
      if (!key) {
        continue;
      }

      let arbValue = this.getArbValue(key);
      if (!arbValue) {
        continue;
      }

      let endPos = editor.document.positionAt(match.index! + match[0].length);

      let showValue = arbValue;
      const showL10nTextMaxLength = ConfigUtils.showL10nTextMaxLength;
      if (
        showL10nTextMaxLength > 0 &&
        showValue.length > showL10nTextMaxLength
      ) {
        if (showL10nTextMaxLength <= 3) {
          showValue = "...";
        } else {
          showValue = showValue.substring(0, showL10nTextMaxLength - 3) + "...";
        }
      }

      afterDecorations.push({
        range: new vscode.Range(endPos, endPos),
        renderOptions: {
          after: {
            contentText: ` // ${showValue}`,
            color: new vscode.ThemeColor("descriptionForeground"),
          },
        },
        hoverMessage: new vscode.MarkdownString(
          `\`${match[0]}\` → **${arbValue}**`,
        ),
      });
    }

    editor.setDecorations(this.afterDecoration, afterDecorations);
  }

  private extractKey(matchText: string): string | null {
    let cleaned = matchText.replace(/\(.*\)/, "");
    let splits = cleaned.split(".");
    let key = splits[splits.length - 1]
      ?.replace(";", "")
      .replace(",", "")
      .trim();
    return key && key.length > 0 ? key : null;
  }
}
