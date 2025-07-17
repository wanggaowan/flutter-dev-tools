import * as vscode from "vscode";
import { disposeAll, isDartClassName, lowerCamelCase } from "../utils/utils";
import { COMMAND_JSON2DART } from "../constants.contexts";
import Logger from "../utils/logger";
import { ConfigUtils } from "../utils/config-utils";
import { ForamtUtils } from "../utils/format-utils";
import { executeDocumentSymbolProvider } from "../utils/build-in-command-utils";
import { ClassGen } from "./class-gen";

export class JsonToDart implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];

  constructor() {
    let dispose = vscode.commands.registerCommand(COMMAND_JSON2DART, () =>
      this.json2Dart()
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  private async json2Dart() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    let jsonStr = "";
    try {
      jsonStr = await vscode.env.clipboard.readText();
    } catch (e) {
      Logger.e(e);
    }

    if (!jsonStr) {
      Logger.showNotification("未读取到json内容，请选将内容复制到剪切板");
      return;
    }

    let jsonObj: any;
    try {
      let obj = JSON.parse(jsonStr);
      if (Array.isArray(obj)) {
        let child = obj[0];
        if (Object.keys(child).length == 0) {
          Logger.showNotification("json数据内容为空");
          return;
        }
        jsonObj = child;
      } else if (Object.keys(obj).length == 0) {
        Logger.showNotification("json数据内容为空");
        return;
      } else {
        jsonObj = obj;
      }
    } catch (e) {
      Logger.showNotification("json数据格式错误", "error");
      return;
    }

    const selection = editor.selection;
    const symbols = await this.getDocumentSymbols(editor.document);
    let classSymbol = this.getselectionClass(symbols, selection);
    let suffix = ConfigUtils.classSuffix;
    let className: string;
    if (!classSymbol) {
      const name = await vscode.window.showInputBox({
        placeHolder: "请输入类名称",
        prompt:
          "创建dart class" +
          (suffix.length == 0 ? "" : `(默认追加${suffix})后缀，可在设置中修改`),
        validateInput: value => {
          if (!value) {
            return "类名不能为空";
          }

          if (!isDartClassName(value)) {
            return "类名必须以大写字母开头，只能包含字母、数字和下划线，不能以下划线结尾且不能有连续的下划线";
          }

          if (this.existSameClassName(symbols, value + suffix)) {
            return "当前文件已存在此类";
          }
          return null;
        },
      });
      if (!name) {
        return;
      }
      className = name;
    } else {
      className = classSymbol.name;
    }

    vscode.window.withProgress(
      {
        cancellable: false,
        location: vscode.ProgressLocation.Window,
        title: `Converting json to dart`,
      },
      (_, token) => {
        return this.genDartClass(
          editor,
          classSymbol,
          className,
          suffix,
          jsonObj
        );
      }
    );
  }

  private async genDartClass(
    editor: vscode.TextEditor,
    classSymbol: vscode.DocumentSymbol | undefined,
    className: string,
    suffix: string,
    jsonObj: any
  ) {
    let pos = this.findInseartLine(editor, classSymbol);
    let genDoc = ConfigUtils.genDoc;
    let genConstructor = ConfigUtils.genConstructor;
    let genSerialization = ConfigUtils.genSerialization;
    let converts = ConfigUtils.converts;
    let otherClass: Map<string, object>;

    let content = "";
    let succeed = false;
    if (classSymbol) {
      let returnValue = await this.parse(
        jsonObj,
        className + suffix,
        suffix,
        genDoc,
        false,
        false,
        false,
        null
      );

      succeed = await editor.edit(edit => {
        edit.insert(pos, returnValue.content + "\n");
      });
      if (succeed) {
        await editor.document.save();
        await new Promise(resove => setTimeout(resove, 300));
      }

      if (genSerialization) {
        succeed = (await ClassGen.genSerialization()) || succeed;
      } else if (genConstructor) {
        succeed = (await ClassGen.genConstructor()) || succeed;
      }
      otherClass = returnValue.otherClass;
    } else {
      let returnValue = await this.parse(
        jsonObj,
        className + suffix,
        suffix,
        genDoc,
        true,
        genConstructor,
        genSerialization,
        converts
      );
      content = returnValue.content;
      otherClass = returnValue.otherClass;
    }

    let contents = await this.genOtherClass(
      otherClass,
      suffix,
      genDoc,
      genConstructor,
      genSerialization,
      converts
    );

    if (contents.length > 0) {
      content = content + contents.join("\n\n");
    }

    if (content.length > 0) {
      pos = new vscode.Position(editor.document.lineCount + 1, 0);
      succeed =
        (await editor.edit(edit => {
          edit.insert(pos, content + "\n");
        })) || succeed;
    }

    if (genSerialization && !classSymbol) {
      succeed = (await ClassGen.genGPart(editor)) || succeed;
    }

    if (succeed) {
      await ForamtUtils.formatDocument(editor.document.uri);
      await editor.document.save();
    }
  }

  private async genOtherClass(
    otherClass: Map<string, object>,
    classSuffix: string,
    genDoc: boolean,
    genConstructor: boolean,
    genSerialization: boolean,
    converts: string | undefined | null
  ): Promise<string[]> {
    let contents: string[] = [];
    for (const element of otherClass) {
      let returnValue = await this.parse(
        element[1],
        element[0],
        classSuffix,
        true,
        genDoc,
        genConstructor,
        genSerialization,
        converts
      );
      contents.push(returnValue.content);
      if (returnValue.otherClass.size > 0) {
        let result = await this.genOtherClass(
          returnValue.otherClass,
          classSuffix,
          genDoc,
          genConstructor,
          genSerialization,
          converts
        );
        contents.push(...result);
      }
    }
    return contents;
  }

  private async parse(
    jsonObj: any,
    className: string,
    classSuffix: string,
    genDoc: boolean,
    genClass: boolean,
    genConstructor: boolean,
    genSerialization: boolean,
    converts: string | undefined | null
  ): Promise<{ content: string; otherClass: Map<string, object> }> {
    let contents: string[] = [];
    let otherClass: Map<string, object> = new Map();
    for (let key of Object.keys(jsonObj)) {
      let value = jsonObj[key];
      let type = typeof value;
      if (type === "boolean") {
        let defined = genDoc ? `/// ${value}\nbool? ${key};` : `bool? ${key};`;
        contents.push(defined);
      } else if (type === "number") {
        if (Number.isInteger(value)) {
          let defined = genDoc ? `/// ${value}\nint? ${key};` : `int? ${key};`;
          contents.push(defined);
        } else {
          let defined = genDoc
            ? `/// ${value}\ndouble? ${key};`
            : `double? ${key};`;
          contents.push(defined);
        }
      } else if (type == "object") {
        let prop = this.getFieldName(key);
        let classNmae = lowerCamelCase(prop.key + classSuffix);
        let defined =
          !genDoc || prop.doc.length == 0
            ? `${classNmae}? ${lowerCamelCase(prop.key, false)};`
            : `/// ${prop.doc}\n${classNmae}? ${lowerCamelCase(
                prop.key,
                false
              )};`;
        contents.push(defined);

        if (Array.isArray(value)) {
          otherClass.set(classNmae, value[0]);
        } else {
          otherClass.set(classNmae, value);
        }
      } else if (type == "string") {
        let defined = genDoc
          ? `/// ${value}\nString? ${key};`
          : `String? ${key};`;
        contents.push(defined);
      } else {
        let defined = genDoc
          ? `/// ${value}\nObject? ${key};`
          : `Object? ${key};`;
        contents.push(defined);
      }
    }

    let content = contents.join("\n");

    if (genConstructor) {
      let keys = Object.keys(jsonObj);
      let hasField = keys.length > 0;
      let constructor = `\n${className}(${hasField ? "{" : ""}`;
      for (let key of keys) {
        constructor += `this.${key},`;
      }
      constructor += `${hasField ? "}" : ""});\n\n`;
      content = constructor + content;
    }

    if (genSerialization) {
      let serial =
        `factory ${className}.fromJson(Map<String, dynamic> json) =>` +
        `\n    _$${className}FromJson(json);`;

      serial += `\n\nMap<String, dynamic> toJson() => _$${className}ToJson(this);`;

      serial +=
        `\n\nstatic List<${className}> fromJsonList(List<dynamic> json) => json` +
        `\n    .map((e) => ${className}.fromJson(e as Map<String, dynamic>))` +
        "\n    .toList();";

      content += "\n\n" + serial;
    }

    if (genClass) {
      if (genSerialization) {
        let convertStr =
          converts && converts.length > 0 ? `converters: ${converts}` : "";
        content = `\n@JsonSerializable(${convertStr})\nclass ${className} {\n${content}\n}`;
      } else {
        content = `\nclass ${className} {\n${content}\n}`;
      }
    }

    return {
      content,
      otherClass,
    };
  }

  private getFieldName(jsonKey: string): { key: string; doc: string } {
    if (jsonKey.includes("(") && jsonKey.includes(")")) {
      // 兼容周卓接口文档JSON, "dataList (工序列表)":[]
      let index = jsonKey.indexOf("(");
      return {
        key: jsonKey.substring(0, index).replace(" ", ""),
        doc: jsonKey.substring(index + 1, jsonKey.length - 1),
      };
    } else {
      return {
        key: jsonKey,
        doc: "",
      };
    }
  }

  /**
   * 获取文档中的所有符号
   * @param document 当前文档
   * @returns 返回一个Promise，解析为文档中的所有符号
   */
  private async getDocumentSymbols(
    document: vscode.TextDocument
  ): Promise<vscode.DocumentSymbol[]> {
    try {
      const symbols = await executeDocumentSymbolProvider(document.uri);
      return symbols || [];
    } catch (error) {
      Logger.d("获取文档符号时出错:", error);
      return [];
    }
  }

  private getselectionClass(
    symbols: vscode.DocumentSymbol[],
    selection: vscode.Selection
  ): vscode.DocumentSymbol | undefined {
    if (symbols.length == 0) {
      return undefined;
    }

    for (let symbol of symbols) {
      if (symbol.kind != vscode.SymbolKind.Class) {
        continue;
      }

      if (symbol.range.contains(selection)) {
        return symbol;
      }
    }

    return undefined;
  }

  private existSameClassName(
    symbols: vscode.DocumentSymbol[],
    name: string
  ): boolean {
    if (symbols.length == 0) {
      return false;
    }
    for (let symbol of symbols) {
      if (symbol.kind != vscode.SymbolKind.Class) {
        continue;
      }

      if (symbol.name === name) {
        return true;
      }
    }

    return false;
  }

  private findInseartLine(
    editor: vscode.TextEditor,
    classSymbol?: vscode.DocumentSymbol
  ) {
    if (!classSymbol) {
      return new vscode.Position(editor.document.lineCount + 1, 0);
    }

    let children = classSymbol.children;
    if (children.length == 0) {
      let end = classSymbol.range.end;
      return end.translate(0, -1);
    }

    let lastField: vscode.DocumentSymbol | undefined;
    let cnstructor: vscode.DocumentSymbol | undefined;
    for (let child of children) {
      if (child.kind == vscode.SymbolKind.Field) {
        lastField = child;
      } else if (child.kind == vscode.SymbolKind.Constructor) {
        cnstructor = child;
      }
    }

    if (lastField) {
      return lastField.range.end.translate(1, 0);
    }

    if (cnstructor) {
      return cnstructor.range.end;
    }

    let text = editor.document.getText(classSymbol.range);
    let indexOf = text.indexOf("{");
    if (indexOf != -1) {
      let pos = editor.document.positionAt(indexOf);
      return pos.translate(0, 1);
    }

    let end = classSymbol.range.end;
    return end.translate(0, -1);
  }
}
