import * as vscode from "vscode";
import * as fs from "fs";
import * as yaml from "yaml";
import pathUtils from "path";
import { FlutterSdk } from "../../sdk";
import { disposeAll } from "../../utils/utils";
import { strCallRegex } from "../../utils/regexp-utils";
import { ConfigUtils } from "../../utils/config-utils";

/**
 * 在 S.current.xxx / S.of(context).xxx 调用位置，用 ARB 真实文本覆盖原始代码显示
 */
export class L10nFoldingProvider implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];
  private templateArbFile: string | undefined;
  private arbCache: Map<string, string> | undefined;
  private arbDirWatcher: vscode.Disposable | undefined;
  private afterDecoration: vscode.TextEditorDecorationType;

  constructor(private readonly sdk: FlutterSdk) {
    this.afterDecoration = vscode.window.createTextEditorDecorationType({});

    this.disposableList.push(
      vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
          if (editor) this.updateDecorations(editor);
        },
        null
      )
    );

    this.disposableList.push(
      vscode.workspace.onDidChangeTextDocument(
        (e) => {
          let editor = vscode.window.activeTextEditor;
          if (editor && e.document === editor.document) {
            this.updateDecorations(editor);
          }
        },
        null
      )
    );

    this.disposableList.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("flutterDevTools.showL10nText")) {
          let editor = vscode.window.activeTextEditor;
          if (editor) this.updateDecorations(editor);
        }
      })
    );

    let editor = vscode.window.activeTextEditor;
    if (editor) this.updateDecorations(editor);
  }

  dispose() {
    this.arbDirWatcher?.dispose();
    this.afterDecoration.dispose();
    disposeAll(this.disposableList);
  }

  private updateDecorations(editor: vscode.TextEditor) {
    if (editor.document.languageId !== "dart") return;

    if (!ConfigUtils.showL10nText) {
      editor.setDecorations(this.afterDecoration, []);
      return;
    }

    let text = editor.document.getText();
    let afterDecorations: vscode.DecorationOptions[] = [];

    for (const match of text.matchAll(strCallRegex)) {
      if (!match || !match[0]) continue;

      let key = this.extractKey(match[0]);
      if (!key) continue;

      let arbValue = this.getArbValue(key);
      if (!arbValue) continue;

      let endPos = editor.document.positionAt(
        match.index! + match[0].length
      );

      afterDecorations.push({
        range: new vscode.Range(endPos, endPos),
        renderOptions: {
          after: {
            contentText: ` // ${arbValue}`,
            color: new vscode.ThemeColor("descriptionForeground"),
          },
        },
        hoverMessage: new vscode.MarkdownString(
          `\`${match[0]}\` → **${arbValue}**`
        ),
      });
    }

    editor.setDecorations(this.afterDecoration, afterDecorations);
  }

  private extractKey(matchText: string): string | null {
    let cleaned = matchText.replace(/\(.*\)/, "");
    let splits = cleaned.split(".");
    let key = splits[splits.length - 1]?.trim();
    return key && key.length > 0 ? key : null;
  }

  private getArbValue(key: string): string | null {
    let arbFile = this.getTemplateArbFile();
    if (!arbFile) return null;

    if (!this.arbCache) {
      this.arbCache = this.parseArbFile(arbFile);
    }

    return this.arbCache.get(key) ?? null;
  }

  private parseArbFile(filePath: string): Map<string, string> {
    let map = new Map<string, string>();
    try {
      let content = fs.readFileSync(filePath, "utf-8");
      if (!content) return map;

      let json = JSON.parse(content);
      for (let k of Object.keys(json)) {
        if (k.startsWith("@")) continue;
        let v = json[k];
        if (typeof v === "string") {
          map.set(k, v);
        }
      }
    } catch (e) {
      // ignore
    }
    return map;
  }

  private getTemplateArbFile(): string | undefined {
    if (this.templateArbFile) return this.templateArbFile;

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

    let arbFilePath = pathUtils.join(rootDirPath, resDirPath, resName);
    if (!fs.existsSync(arbFilePath)) return undefined;

    this.templateArbFile = arbFilePath;
    this.setupWatcher(rootDirPath, resDirPath);
    return arbFilePath;
  }

  private setupWatcher(rootDirPath: string, resDirPath: string) {
    this.arbDirWatcher?.dispose();
    let arbDir = pathUtils.join(rootDirPath, resDirPath);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(arbDir, "**"),
      false,
      false,
      false
    );

    let onChange = () => {
      this.templateArbFile = undefined;
      this.arbCache = undefined;
      this.arbDirWatcher?.dispose();
      this.arbDirWatcher = undefined;
      let editor = vscode.window.activeTextEditor;
      if (editor) this.updateDecorations(editor);
    };

    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    this.arbDirWatcher = watcher;
  }
}
