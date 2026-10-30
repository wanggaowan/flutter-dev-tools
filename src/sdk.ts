import * as vscode from "vscode";
import * as fs from "fs";
import * as yaml from "yaml";
import { importRegex, partRegex } from "./utils/regexp-utils";
import path from "path";

export class FlutterSdk {
  readonly dartSdk: DartSdk | undefined;
  // 记录所有Flutter项目信息(包含主项目)
  readonly modules: FlutterModule[];

  constructor(
    readonly context: vscode.ExtensionContext,
    readonly workspace: vscode.Uri,
  ) {
    let dartExt = vscode.extensions.getExtension("Dart-Code.dart-code");
    if (dartExt) {
      this.dartSdk = new DartSdk(dartExt);
    }

    const modules: FlutterModule[] = [new FlutterModule(context, workspace)];
    const dirs = fs.readdirSync(workspace.fsPath);
    for (const element of dirs) {
      let exist = fs.existsSync(
        vscode.Uri.joinPath(workspace, element, "pubspec.yaml").fsPath,
      );
      if (exist) {
        modules.push(
          new FlutterModule(context, vscode.Uri.joinPath(workspace, element)),
        );
      }
    }
    this.modules = modules;
  }

  deactivate() {}

  /**
   * 根据路径获取文件所处模块
   * @param path 如果传string,需要文件的path路径
   * @returns
   */
  getModule(uri: string | vscode.Uri): FlutterModule | null {
    const filePath = typeof uri === "string" ? uri : uri.path;
    for (let index = 1; index < this.modules.length; index++) {
      // this.workspace路径最短，因此先忽略，之后未找到再单独匹配，要匹配最长路径。除了this.workspace外，
      // 其余FlutterModule都是在this.workspace路径之下，不处理除this.workspace之外的FlutterModule路径
      // 之下嵌套FlutterModule的情况
      const element = this.modules[index];
      if (
        element.workspace != this.workspace &&
        filePath.startsWith(element.workspace.path)
      ) {
        return element;
      }
    }

    if (filePath.startsWith(this.workspace.path)) {
      return this.modules[0];
    }

    return null;
  }
}

export class FlutterModule {
  constructor(
    readonly context: vscode.ExtensionContext,
    readonly workspace: vscode.Uri,
  ) {}

  deactivate() {}

  /**
   * 获取项目指定的模板Arb文件地址
   */
  getL10nYaml(): yaml.Document | undefined {
    let l10nFilePath = vscode.Uri.joinPath(this.workspace, "l10n.yaml");
    if (fs.existsSync(l10nFilePath.fsPath)) {
      let contents = fs.readFileSync(l10nFilePath.fsPath, "utf-8");
      let result = yaml.parseDocument(contents);
      return result;
    }
    return undefined;
  }

  /**
   * 获取项目l10n.yaml指定的arb-dir目录地址
   */
  getL10nYamlArbDirUri(document?: yaml.Document): vscode.Uri | undefined {
    if (!document) {
      document = this.getL10nYaml();
    }

    if (!document) {
      return undefined;
    }

    let rootDirPath = this.workspace.path;
    let resDirPath = "lib/l10n";

    let projectDir = document.get("project-dir");
    if (typeof projectDir === "string" && projectDir.length > 0) {
      rootDirPath = projectDir.replace(path.sep, "/");
    }

    let arbDir = document.get("arb-dir");
    if (typeof arbDir === "string" && arbDir.length > 0) {
      resDirPath = arbDir.replace(path.sep, "/");
    }

    return vscode.Uri.parse(path.join(rootDirPath, resDirPath));
  }

  /**
   * 获取项目l10n.yaml指定的template-arb-file文件地址
   */
  getL10nYamlArbFileUri(document?: yaml.Document): vscode.Uri | undefined {
    if (!document) {
      document = this.getL10nYaml();
    }

    if (!document) {
      return undefined;
    }

    let dirUri = this.getL10nYamlArbDirUri(document);
    if (!dirUri) {
      return undefined;
    }

    let resName = "app_en.arb";
    let templateArbFile = document.get("template-arb-file");
    if (typeof templateArbFile === "string" && templateArbFile.length > 0) {
      resName = templateArbFile;
    }

    return vscode.Uri.joinPath(dirUri, resName);
  }

  /**
   * 获取项目l10n.yaml指定的output-dir目录地址
   */
  getL10nYamlOutputDirUri(document?: yaml.Document): vscode.Uri | undefined {
    if (!document) {
      document = this.getL10nYaml();
    }

    if (!document) {
      return undefined;
    }

    let rootDirPath = this.workspace.path;
    var outputDir = "lib/l10n";

    let projectDir = document.get("project-dir");
    if (typeof projectDir === "string" && projectDir.length > 0) {
      rootDirPath = projectDir.replace(path.sep, "/");
    }

    let dir = document.get("output-dir");
    if (typeof dir === "string" && dir.length > 0) {
      outputDir = dir.replace(path.sep, "/");
    }

    return vscode.Uri.parse(path.join(rootDirPath, outputDir));
  }

  /**
   * 获取项目l10n.yaml指定的output-localization-file文件地址
   */
  getL10nYamlOutputFileUri(document?: yaml.Document): vscode.Uri | undefined {
    if (!document) {
      document = this.getL10nYaml();
    }

    if (!document) {
      return undefined;
    }

    let dirUri = this.getL10nYamlOutputDirUri(document);
    if (!dirUri) {
      return undefined;
    }

    var outputLocalizationFile = "app_localizations.dart";
    let templateFile = document.get("output-localization-file");
    if (typeof templateFile === "string" && templateFile.length > 0) {
      outputLocalizationFile = templateFile;
    }

    return vscode.Uri.joinPath(dirUri, outputLocalizationFile);
  }
}

export class DartSdk {
  constructor(private readonly dartExt: any) {}

  get version(): number {
    return this.dartExt.exports.version;
  }

  public async getOutline(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken,
  ): Promise<PublicOutline | undefined> {
    if (this.version < 2) {
      throw Error("please upgrade dart plugin version >= 3.115.20250715");
    } else {
      return this.dartExt.exports.workspace.getOutline(document, token);
    }
  }

  /**
   * 获取文档中最后一个import的范围
   */
  static getLastImportRange(document: vscode.TextDocument) {
    let text = document.getText();
    let matchAll = text.matchAll(importRegex);
    let lastIndexStart = 0;
    let lastIndexEnd = 0;
    for (const element of matchAll) {
      lastIndexStart = element.index;
      lastIndexEnd = element.index + element[0].length;
    }

    if (lastIndexStart == 0 && lastIndexEnd == 0) {
      return;
    }

    return new vscode.Range(
      document.positionAt(lastIndexStart),
      document.positionAt(lastIndexEnd),
    );
  }

  /**
   * 获取文档中最后一个part的范围
   */
  static getLastPartRange(document: vscode.TextDocument) {
    let text = document.getText();
    let matchAll = text.matchAll(partRegex);
    let lastIndexStart = 0;
    let lastIndexEnd = 0;
    for (const element of matchAll) {
      lastIndexStart = element.index;
      lastIndexEnd = element.index + element[0].length;
    }

    if (lastIndexStart == 0 && lastIndexEnd == 0) {
      return;
    }

    return new vscode.Range(
      document.positionAt(lastIndexStart),
      document.positionAt(lastIndexEnd),
    );
  }
}

export interface PublicOutline {
  readonly element: PublicElement;
  readonly range: vscode.Range;
  readonly codeRange: vscode.Range;
  readonly children: PublicOutline[] | undefined;
}

export interface PublicElement {
  readonly name: string;
  readonly range: vscode.Range | undefined;
  readonly kind: ElementKind;
  readonly parameters?: string;
  readonly typeParameters?: string;
  readonly returnType?: string;
}

/**
 * An enumeration of the kinds of elements.
 */
type ElementKind =
  | "CLASS"
  | "CLASS_TYPE_ALIAS"
  | "COMPILATION_UNIT"
  | "CONSTRUCTOR"
  | "CONSTRUCTOR_INVOCATION"
  | "ENUM"
  | "ENUM_CONSTANT"
  | "EXTENSION"
  | "FIELD"
  | "FILE"
  | "FUNCTION"
  | "FUNCTION_INVOCATION"
  | "FUNCTION_TYPE_ALIAS"
  | "GETTER"
  | "LABEL"
  | "LIBRARY"
  | "LOCAL_VARIABLE"
  | "METHOD"
  | "MIXIN"
  | "PARAMETER"
  | "PREFIX"
  | "SETTER"
  | "TOP_LEVEL_VARIABLE"
  | "TYPE_ALIAS"
  | "TYPE_PARAMETER"
  | "UNIT_TEST_GROUP"
  | "UNIT_TEST_TEST"
  | "UNKNOWN";
