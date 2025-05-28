import * as vscode from "vscode";
import * as fs from "fs";
import * as yaml from "yaml";
import pathUtils from "path";
import { FlutterSdk } from "../../sdk";
import { disposeAll } from "../../utils/utils";
import Logger from "../../utils/logger";
import { executeReferenceProvider } from "../../utils/build-in-command-utils";

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
  private arbFiles: string[] | undefined;
  private outputLocalizationFile: string | undefined;
  private arbDirWatcher: vscode.Disposable | undefined;
  private l10nFileWatcher: vscode.Disposable | undefined;

  constructor(private readonly sdk: FlutterSdk) {
    let disposable = vscode.languages.registerReferenceProvider(
      { scheme: "file", pattern: "**/*.arb" },
      this
    );
    this.disposableList.push(disposable);

    disposable = vscode.languages.registerDefinitionProvider(
      { scheme: "file", pattern: "**/*.arb" },
      this
    );
    this.disposableList.push(disposable);

    disposable = vscode.workspace.onDidSaveTextDocument(e => {
      if (
        this.outputLocalizationFile &&
        e.uri.path == this.outputLocalizationFile
      ) {
        this.outputLocalizationFile = undefined;
      }
    });
    this.disposableList.push(disposable);
  }

  dispose() {
    this.arbDirWatcher?.dispose();
    this.l10nFileWatcher?.dispose();
    disposeAll(this.disposableList);
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    return this.findReference(document, position, undefined, token);
  }

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Location[]> {
    return this.findReference(document, position, context, token);
  }

  async findReference(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext | undefined,
    token: vscode.CancellationToken
  ): Promise<vscode.Location[] | null> {
    let line = document.lineAt(position.line);
    let text = document.getText(line.range);
    let keyValue = text.split(":");
    if (keyValue.length != 2) {
      return null;
    }

    let key = keyValue[0].replaceAll('"', "").trim();
    let result = this.getArbFiles(context == undefined);
    this.arbFiles = result.arbFiles;
    this.outputLocalizationFile = result.outputLocalizationFile;
    if (!this.outputLocalizationFile) {
      return null;
    }

    let readText = fs.readFileSync(this.outputLocalizationFile, "utf-8");
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
      let finds = await executeReferenceProvider(
        vscode.Uri.file(this.outputLocalizationFile),
        pos
      );

      if (token.isCancellationRequested) {
        return null;
      }

      if (finds) {
        refrences.push(...finds);
      }
    }

    if (context || !this.arbFiles) {
      // 查找引用
      return refrences;
    }

    for (const element of this.arbFiles) {
      if (token.isCancellationRequested) {
        return null;
      }

      try {
        if (element == document.uri.path) {
          continue;
        }

        let content = fs.readFileSync(element, "utf-8");
        if (!content || content.length == 0) {
          continue;
        }

        let values = content.split(/\r?\n/);
        for (let i = 0; i < values.length; i++) {
          let element2 = values[i];
          let keyValue = element2.split(":");
          if (keyValue.length == 2) {
            let key2 = keyValue[0].trim();
            if (key2 == `"${key}"`) {
              let location = new vscode.Location(
                vscode.Uri.file(element),
                new vscode.Position(i, keyValue[0].length - key2.length + 1)
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
    return refrences.length == 0 ? null : refrences;
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

    let rootDirPath = this.sdk.workspace.path;
    let resDirPath = "lib/l10n";
    var outputDir = "lib/l10n";
    var outputLocalizationFile = "app_localizations.dart";

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

      if (findArb) {
        let arbDir = result.get("arb-dir");
        if (typeof arbDir === "string" && arbDir && arbDir.length > 0) {
          resDirPath = arbDir;
        }
      }

      let outputDir2 = result.get("output-dir");
      if (
        typeof outputDir2 === "string" &&
        outputDir2 &&
        outputDir2.length > 0
      ) {
        outputDir = outputDir2;
      }

      let outputLocalizationFile2 = result.get("output-localization-file");
      if (
        typeof outputLocalizationFile2 === "string" &&
        outputLocalizationFile2 &&
        outputLocalizationFile2.length > 0
      ) {
        outputLocalizationFile = outputLocalizationFile2;
      }
    }

    this.l10nFileWatcher?.dispose();
    const watcher2 = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        pathUtils.join(rootDirPath, outputDir),
        outputLocalizationFile
      ),
      true, // 是否忽略创建事件
      true, // 是否忽略修改事件
      false // 是否忽略删除事件
    );
    watcher2.onDidDelete(uri => (this.outputLocalizationFile = undefined));
    this.l10nFileWatcher = watcher2;

    if (!findArb) {
      return {
        outputLocalizationFile: pathUtils.join(
          rootDirPath,
          outputDir,
          outputLocalizationFile
        ),
        arbFiles: this.arbFiles,
      };
    }

    let arbDir = pathUtils.join(rootDirPath, resDirPath);
    let children = fs.readdirSync(arbDir);
    let uris: string[] = [];
    for (const element of children) {
      if (element.toLowerCase().endsWith(".arb")) {
        uris.push(pathUtils.join(arbDir, element));
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

    return {
      outputLocalizationFile: pathUtils.join(
        rootDirPath,
        outputDir,
        outputLocalizationFile
      ),
      arbFiles: uris,
    };
  }
}
