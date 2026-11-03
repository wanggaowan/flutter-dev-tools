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
    const filePath = typeof uri === "string" ? uri : uri.fsPath;
    let match: FlutterModule | null = null;
    let matchLength = -1;
    for (const element of this.modules) {
      // 只匹配完整的目录前缀，避免 app 与 app_admin 这类同前缀目录误判；
      // 同时保留最长匹配，兼容模块目录嵌套的情况
      const rootPath = element.workspace.fsPath;
      const prefix = rootPath.endsWith(path.sep)
        ? rootPath
        : `${rootPath}${path.sep}`;
      if (filePath !== rootPath && !filePath.startsWith(prefix)) {
        continue;
      }
      if (rootPath.length > matchLength) {
        match = element;
        matchLength = rootPath.length;
      }
    }
    return match;
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
   * 获取项目 l10n.yaml 的绝对路径配置。
   * project-dir 可能为相对路径，需要相对当前模块根目录解析；
   * output-dir 未配置时 Flutter 默认与 arb-dir 相同。
   */
  getL10nConfig(document?: yaml.Document): L10nConfig | undefined {
    if (!document) {
      document = this.getL10nYaml();
    }

    if (!document) {
      return undefined;
    }

    const moduleRoot = this.workspace.fsPath;
    const projectDirValue = document.get("project-dir");
    const projectDir =
      typeof projectDirValue === "string" && projectDirValue.length > 0
        ? path.resolve(moduleRoot, projectDirValue)
        : moduleRoot;

    const arbDirValue = document.get("arb-dir");
    const arbDirPath = path.resolve(
      projectDir,
      typeof arbDirValue === "string" && arbDirValue.length > 0
        ? arbDirValue
        : "lib/l10n",
    );

    const templateArbFileValue = document.get("template-arb-file");
    const templateArbFilePath = path.resolve(
      arbDirPath,
      typeof templateArbFileValue === "string" &&
        templateArbFileValue.length > 0
        ? templateArbFileValue
        : "app_en.arb",
    );

    const outputDirValue = document.get("output-dir");
    const outputDirPath =
      typeof outputDirValue === "string" && outputDirValue.length > 0
        ? path.resolve(projectDir, outputDirValue)
        : arbDirPath;

    const outputFileValue = document.get("output-localization-file");
    const outputLocalizationFilePath = path.resolve(
      outputDirPath,
      typeof outputFileValue === "string" && outputFileValue.length > 0
        ? outputFileValue
        : "app_localizations.dart",
    );

    const useEscapValue = document.get("use-escaping");
    let useEscaping: boolean = false;
    if (typeof useEscapValue === "boolean") {
      useEscaping = true;
    } else if (typeof useEscapValue === "string") {
      useEscaping = "true" === useEscapValue;
    }

    return {
      arbDirPath,
      templateArbFilePath,
      outputDirPath,
      outputLocalizationFilePath,
      useEscaping,
    };
  }

  /**
   * 获取项目l10n.yaml指定的arb-dir目录地址
   */
  getL10nYamlArbDirUri(document?: yaml.Document): vscode.Uri | undefined {
    const config = this.getL10nConfig(document);
    return config ? vscode.Uri.file(config.arbDirPath) : undefined;
  }

  /**
   * 获取项目l10n.yaml指定的template-arb-file文件地址
   */
  getL10nYamlArbFileUri(document?: yaml.Document): vscode.Uri | undefined {
    const config = this.getL10nConfig(document);
    return config ? vscode.Uri.file(config.templateArbFilePath) : undefined;
  }

  /**
   * 获取项目l10n.yaml指定的output-dir目录地址
   */
  getL10nYamlOutputDirUri(document?: yaml.Document): vscode.Uri | undefined {
    const config = this.getL10nConfig(document);
    return config ? vscode.Uri.file(config.outputDirPath) : undefined;
  }

  /**
   * 获取项目l10n.yaml指定的output-localization-file文件地址
   */
  getL10nYamlOutputFileUri(document?: yaml.Document): vscode.Uri | undefined {
    const config = this.getL10nConfig(document);
    return config
      ? vscode.Uri.file(config.outputLocalizationFilePath)
      : undefined;
  }
}

/**
 * l10n.yaml 解析后的绝对路径配置
 */
export interface L10nConfig {
  arbDirPath: string;
  templateArbFilePath: string;
  outputDirPath: string;
  outputLocalizationFilePath: string;
  useEscaping: boolean;
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
