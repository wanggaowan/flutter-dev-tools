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

  static getReturnType(
    document: vscode.TextDocument,
    symbold: vscode.DocumentSymbol
  ) {
    if (
      symbold.kind != vscode.SymbolKind.Method &&
      symbold.kind != vscode.SymbolKind.Field
    ) {
      return;
    }

    let text = document.getText(symbold.range);
    let index = text.indexOf(symbold.name);
    if (index != -1) {
      text = text.substring(0, index);
    }

    //匹配带泛型的返回类型
    let regex = new RegExp(/\w+<[\s\S]*?>/g);
    let match = text.match(regex);
    if (match) {
      return match[0];
    }

    let splits = text.split(/\s+/g);
    for (const element of splits) {
      if (element == "static" || element == "final") {
        continue;
      }
      return element;
    }
  }

  static getMethodType(
    document: vscode.TextDocument,
    symbold: vscode.DocumentSymbol
  ): "SETTER" | "GETTER" | undefined {
    if (symbold.kind != vscode.SymbolKind.Method) {
      return;
    }

    let text = document.getText(symbold.range);
    let index = text.indexOf(symbold.name);
    if (index != -1) {
      text = text.substring(0, index);
    }

    let splits = text.split(/\s+/g);
    for (const element of splits) {
      if (element == "set") {
        return "SETTER";
      } else if (element == "get") {
        return "GETTER";
      }
    }
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
