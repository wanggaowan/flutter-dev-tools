import * as vscode from "vscode";
import { URI } from "vscode-uri";
import Logger from "./utils/logger";
import { setContext } from "./utils/build-in-command-utils";
import { EXIST_VSCODEFLUTTERTOOL } from "./constants.contexts";

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

  getOutline(uri: vscode.Uri): Outline | undefined {
    return this.dartExt.exports._privateApi.fileTracker.getOutlineFor(
      URI.parse(uri.fsPath)
    );
  }

  public async waitForOutline(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken
  ): Promise<Outline | undefined> {
    return this.dartExt.exports._privateApi.fileTracker.waitForOutline(
      document,
      token
    );
  }

  // TODO: Change this to withVersion when server sends versions.
  public async waitForOutlineWithLength(
    document: vscode.TextDocument,
    length: number,
    token: vscode.CancellationToken
  ): Promise<Outline | undefined> {
    return this.dartExt.exports._privateApi.fileTracker.waitForOutlineWithLength(
      document,
      length,
      token
    );
  }

  public getFlutterOutlineFor(uri: URI): FlutterOutline | undefined {
    return this.dartExt.exports._privateApi.fileTracker.getFlutterOutlineFor(
      URI.parse(uri.fsPath)
    );
  }

  // TODO: Change this to withVersion when server sends versions.
  public async waitForFlutterOutlineWithLength(
    document: vscode.TextDocument,
    length: number,
    token: vscode.CancellationToken
  ): Promise<FlutterOutline | undefined> {
    return this.dartExt.exports._privateApi.fileTracker.getFlutterOutlineFor(
      document,
      length,
      token
    );
  }

  /**
   * 将dart sdk返回的range转化为vscode.Range
   */
  static range2VsRange(range: Range): vscode.Range {
    let start = this.position2VsPosition(range.start);
    let end = this.position2VsPosition(range.end);
    return new vscode.Range(start, end);
  }

  /**
   * 将dart sdk返回的Position转化为vscode.Position
   */
  static position2VsPosition(pos: Position): vscode.Position {
    return new vscode.Position(pos.line, pos.character);
  }

  static getSymbolKindForElementKind(
    kind: ElementKind | string
  ): vscode.SymbolKind {
    switch (kind) {
      case "CLASS":
      case "CLASS_TYPE_ALIAS":
      case "MIXIN":
        return vscode.SymbolKind.Class;
      case "COMPILATION_UNIT":
      case "EXTENSION":
        return vscode.SymbolKind.Module;
      case "CONSTRUCTOR":
      case "CONSTRUCTOR_INVOCATION":
        return vscode.SymbolKind.Constructor;
      case "ENUM":
        return vscode.SymbolKind.Enum;
      case "ENUM_CONSTANT":
        return vscode.SymbolKind.EnumMember;
      case "FIELD":
        return vscode.SymbolKind.Field;
      case "FILE":
        return vscode.SymbolKind.File;
      case "FUNCTION":
      case "FUNCTION_INVOCATION":
      case "FUNCTION_TYPE_ALIAS":
        return vscode.SymbolKind.Function;
      case "GETTER":
        return vscode.SymbolKind.Property;
      case "LABEL":
        return vscode.SymbolKind.Module;
      case "LIBRARY":
        return vscode.SymbolKind.Namespace;
      case "LOCAL_VARIABLE":
        return vscode.SymbolKind.Variable;
      case "METHOD":
        return vscode.SymbolKind.Method;
      case "PARAMETER":
      case "PREFIX":
        return vscode.SymbolKind.Variable;
      case "SETTER":
        return vscode.SymbolKind.Property;
      case "TOP_LEVEL_VARIABLE":
      case "TYPE_PARAMETER":
        return vscode.SymbolKind.Variable;
      case "UNIT_TEST_GROUP":
        return vscode.SymbolKind.Module;
      case "UNIT_TEST_TEST":
        return vscode.SymbolKind.Method;
      case "UNKNOWN":
        return vscode.SymbolKind.Object;
      default:
        Logger.e(`Unknown kind: ${kind}`);
        return vscode.SymbolKind.Object;
    }
  }
}

export interface Position {
  // Zero-based line number.
  line: number;
  // Zero-based line number.
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Outline {
  readonly element: Element;
  readonly range: Range;
  readonly codeRange: Range;
  readonly children: Outline[] | undefined;
}

export interface Element {
  readonly name: string;
  readonly range: Range | undefined;
  readonly kind: ElementKind;
  readonly parameters?: string;
  readonly typeParameters?: string;
  readonly returnType?: string;
}

export interface FlutterOutline {
  readonly attributes?: FlutterOutlineAttribute[];
  readonly variableName?: string;
  readonly className?: string;
  readonly label?: string;
  readonly dartElement?: Element;
  readonly range: Range;
  readonly codeRange: Range;
  readonly children?: FlutterOutline[];
  readonly kind: ElementKind;
}

export interface FlutterOutlineAttribute {
  name: string;
  label: string;
  valueRange: Range;
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
