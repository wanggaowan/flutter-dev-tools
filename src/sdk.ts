import * as vscode from "vscode";
import { setContext } from "./utils/build-in-command-utils";
import { EXIST_VSCODEFLUTTERTOOL } from "./constants.contexts";
import { importRegex, partRegex } from "./utils/regexp-utils";

export class FlutterSdk {
  readonly dartSdk: DartSdk | undefined;

  constructor(
    readonly context: vscode.ExtensionContext,
    readonly workspace: vscode.Uri,
    readonly example?: vscode.Uri
  ) {
    let dartExt = vscode.extensions.getExtension("Dart-Code.dart-code");
    if (dartExt) {
      this.dartSdk = new DartSdk(dartExt);
    }

    let exist = vscode.extensions.getExtension(
      "undefined_publisher.vscodefluttertool"
    );
    if (exist) {
      setContext(EXIST_VSCODEFLUTTERTOOL, true);
    }
  }

  deactivate() {
    setContext(EXIST_VSCODEFLUTTERTOOL, false);
  }
}

export class DartSdk {
  constructor(private readonly dartExt: any) {}

  get version(): number {
    return this.dartExt.exports.version;
  }

  public async getOutline(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken
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
      document.positionAt(lastIndexEnd)
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
      document.positionAt(lastIndexEnd)
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
