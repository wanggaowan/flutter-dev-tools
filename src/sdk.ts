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

  /**
   * 计算{@link symbol}的真实范围，包含doc和注解等。{@link groups}表示与{@link symbol}同级别的
   * 所有vscode.DocumentSymbol。{@link parent}表示{@link symbol}的父对象，如果{@link symbol}为
   * 文档中顶层对象，则没有parent
   */
  static mapDocumentSymbolRange(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    groups: vscode.DocumentSymbol[],
    parent?: vscode.DocumentSymbol
  ) {
    if (groups.length == 0) {
      return;
    }

    let index = groups.indexOf(symbol);
    if (index == -1) {
      return;
    }

    if (index == 0) {
      if (parent) {
        if (
          parent.kind == vscode.SymbolKind.Class ||
          parent.kind == vscode.SymbolKind.Enum
        ) {
          let text = document.getText(parent.range);
          let indexOf = text.indexOf("{");
          let offset = document.offsetAt(parent.range.start);
          let pos = document.positionAt(offset + indexOf);
          if (pos.line + 1 < symbol.range.start.line) {
            symbol.range = new vscode.Range(
              pos.with(pos.line + 1, 0),
              symbol.range.end
            );
          }
        }
      } else if (symbol.range.start.line > 0) {
        let zero = new vscode.Position(0, 0);
        let range = new vscode.Range(zero, symbol.range.start);
        let regex = new RegExp(/import[\S\s]*?;/g);
        let text = document.getText(range);
        let matchAll = text.matchAll(regex);
        regex = new RegExp(/part[\S\s]*?;/g);
        let matchAll2 = text.matchAll(regex);

        let lastIndex = 0;
        for (const element of matchAll) {
          let end = element.index + element[0].length;
          if (lastIndex < end) {
            lastIndex = end;
          }
        }

        for (const element of matchAll2) {
          let end = element.index + element[0].length;
          if (lastIndex < end) {
            lastIndex = end;
          }
        }

        if (lastIndex == 0) {
          symbol.range = new vscode.Range(zero, symbol.range.end);
        } else {
          let start = document.positionAt(lastIndex);
          if (start.line + 1 < symbol.range.start.line) {
            symbol.range = new vscode.Range(
              start.with(start.line + 1, 0),
              symbol.range.end
            );
          }
        }
      }
      return;
    }
    let preSymbol = groups[index - 1];
    let end = preSymbol.range.end;
    if (end.line + 1 < symbol.range.start.line) {
      symbol.range = new vscode.Range(
        end.with(end.line + 1, 0),
        symbol.range.end
      );
    }
  }

  /**
   * 获取文档中最后一个import的范围
   */
  static getLastImportRange(document: vscode.TextDocument) {
    let regex = new RegExp(/import[\S\s]*?;/g);
    let text = document.getText();
    let matchAll = text.matchAll(regex);
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
    let regex = new RegExp(/part[\S\s]*?;/g);
    let text = document.getText();
    let matchAll = text.matchAll(regex);
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
