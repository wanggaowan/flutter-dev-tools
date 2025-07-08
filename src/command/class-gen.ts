import * as vscode from "vscode";
import { disposeAll } from "../utils/utils";
import {
  COMMAND_GEN_CONSTRUCTOR,
  COMMAND_GEN_SERIALIZATION,
  COMMAND_GETTER,
  COMMAND_GETTER_AND_SETTER,
  COMMAND_SETTER,
} from "../constants.contexts";
import Logger from "../utils/logger";
import { DartSdk } from "../sdk";
import { ForamtUtils } from "../utils/format-utils";
import { ConfigUtils } from "../utils/config-utils";
import path from "path";
import { executeDocumentSymbolProvider } from "../utils/build-in-command-utils";

/**
 * 类生成相关，如生成构造函数，序列化方法等
 */
export class ClassGen {
  private disposableList: vscode.Disposable[] = [];

  constructor() {
    let dispose = vscode.commands.registerCommand(COMMAND_GEN_CONSTRUCTOR, () =>
      vscode.window.withProgress(
        {
          cancellable: false,
          location: vscode.ProgressLocation.Window,
          title: "Gen Constructor",
        },
        async (_, token) => {
          ClassGen.genConstructor(true);
        }
      )
    );
    this.disposableList.push(dispose);

    dispose = vscode.commands.registerCommand(COMMAND_GETTER, () =>
      vscode.window.withProgress(
        {
          cancellable: false,
          location: vscode.ProgressLocation.Window,
          title: "Getter",
        },
        async (_, token) => {
          ClassGen.getter();
        }
      )
    );
    this.disposableList.push(dispose);

    dispose = vscode.commands.registerCommand(COMMAND_SETTER, () =>
      vscode.window.withProgress(
        {
          cancellable: false,
          location: vscode.ProgressLocation.Window,
          title: "Setter",
        },
        async (_, token) => {
          ClassGen.setter();
        }
      )
    );
    this.disposableList.push(dispose);

    dispose = vscode.commands.registerCommand(COMMAND_GETTER_AND_SETTER, () =>
      vscode.window.withProgress(
        {
          cancellable: false,
          location: vscode.ProgressLocation.Window,
          title: "Getter and Setter",
        },
        async (_, token) => {
          ClassGen.getterAndSetter();
        }
      )
    );
    this.disposableList.push(dispose);

    dispose = vscode.commands.registerCommand(COMMAND_GEN_SERIALIZATION, () =>
      vscode.window.withProgress(
        {
          cancellable: false,
          location: vscode.ProgressLocation.Window,
          title: "Gen Serialization",
        },
        async (_, token) => {
          ClassGen.genSerialization(true);
        }
      )
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  private static async getClassOutline(): Promise<
    { editor: vscode.TextEditor; outline: vscode.DocumentSymbol } | undefined
  > {
    let editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let outlines = await executeDocumentSymbolProvider(editor.document.uri);
    if (!outlines) {
      Logger.showNotification("文件解析失败", "error");
      return;
    }

    const selection = editor.selection;
    let classOutline = this.getselectionClass(outlines, selection);
    if (!classOutline) {
      Logger.showNotification("光标所在范围未识别到相关类", "warn");
      return;
    }

    return {
      editor,
      outline: classOutline,
    };
  }

  /**
   * 生成构造函数
   * @param format 生成完成后是否格式化
   */
  static async genConstructor(format?: boolean): Promise<boolean> {
    let editor = await this.genConstructorInner();
    if (editor) {
      if (format) {
        await ForamtUtils.formatDocument(editor.document.uri);
        editor.document.save();
      }
    }
    return editor ? true : false;
  }

  private static async genConstructorInner(): Promise<
    vscode.TextEditor | undefined
  > {
    let value = await this.getClassOutline();
    if (!value) return;

    let editor = value.editor;
    let classOutline = value.outline;

    let children = classOutline.children ?? [];
    let fieldOutlines: vscode.DocumentSymbol[] = [];
    for (let element of children) {
      if (element.kind == vscode.SymbolKind.Field) {
        fieldOutlines.push(element);
      } else if (element.kind == vscode.SymbolKind.Constructor) {
        if (element.name == classOutline.name) {
          // 如果存在工厂构造函数或命名构造函数，则不会阻止创建
          return;
        }
      }
    }

    let hasField = fieldOutlines.length > 0;
    let content = `\n${classOutline.name}(${hasField ? "{" : ""}`;
    fieldOutlines.forEach(outline => {
      let returnType = DartSdk.getReturnType(editor.document, outline);
      if (returnType?.includes("?") == false) {
        content += `required this.${outline.name},`;
      } else {
        content += `this.${outline.name},`;
      }
    });
    content += `${hasField ? "}" : ""});\n`;
    let indexOf = editor.document.getText(classOutline.range).indexOf("{");
    let pos: vscode.Position;
    if (indexOf != -1) {
      let offset = editor.document.offsetAt(classOutline.range.start);
      pos = editor.document.positionAt(indexOf + offset).translate(0, 1);
    } else {
      let end = classOutline.range.end;
      pos = new vscode.Position(end.line, end.character - 1);
    }
    let succeed = await editor.edit(edit => {
      edit.insert(pos, content);
    });
    return succeed ? editor : undefined;
  }

  /**
   * 生成序列化函数
   *
   * @param format 生成完成后是否格式化
   */
  static async genSerialization(format?: boolean): Promise<boolean> {
    let editor: vscode.TextEditor | undefined;
    editor = await this.genConstructorInner();
    if (editor) {
      await editor.document.save();
      await new Promise(resove => setTimeout(resove, 300));
    }

    let editor2 = await this.genSerializationInner();
    if (editor2) {
      editor = editor2;
    }
    if (editor) {
      if (format) {
        await ForamtUtils.formatDocument(editor.document.uri);
        await editor.document.save();
      }
    }

    return editor ? true : false;
  }

  private static async genSerializationInner(): Promise<
    vscode.TextEditor | undefined
  > {
    let value = await this.getClassOutline();
    if (!value) return;

    let editor = value.editor;
    let classOutline = value.outline;
    let children = classOutline.children ?? [];
    let existFromJson = false;
    let existToJson = false;
    let existFromJsonList = false;
    for (let element of children) {
      if (element.kind == vscode.SymbolKind.Method) {
        if (element.name == "toJson") {
          existToJson = true;
        } else if (element.name == "fromJsonList") {
          existFromJsonList = true;
        }
      } else if (element.kind == vscode.SymbolKind.Constructor) {
        if (element.name == `${classOutline.name}.fromJson`) {
          existFromJson = true;
        }
      }
    }

    let content = "";
    if (!existFromJson) {
      content =
        `factory ${classOutline.name}.fromJson(Map<String, dynamic> json) =>` +
        `\n    _$${classOutline.name}FromJson(json);`;
    }

    if (!existToJson) {
      content += `\n\nMap<String, dynamic> toJson() => _$${classOutline.name}ToJson(this);`;
    }

    if (!existFromJsonList) {
      content +=
        `\n\nstatic List<${classOutline.name}> fromJsonList(List<dynamic> json) => json` +
        `\n    .map((e) => ${classOutline.name}.fromJson(e as Map<String, dynamic>))` +
        "\n    .toList();";
    }

    let succeed = false;
    if (content.length > 0) {
      let end = classOutline.range.end;
      let pos = new vscode.Position(end.line, end.character - 1);
      succeed = await editor.edit(edit => {
        edit.insert(pos, "\n\n" + content);
      });
    }

    let text = editor.document.getText(classOutline.range);
    if (!text.includes("@JsonSerializable")) {
      let start = classOutline.range.start;
      let pos = new vscode.Position(start.line, 0);
      let content = "@JsonSerializable(";
      let converts = ConfigUtils.converts;
      if (converts && converts.length > 0) {
        content += `converters: ${converts}`;
      }
      content += ")\n";
      succeed =
        (await editor.edit(edit => {
          edit.insert(pos, `\n${content}`);
        })) || succeed;
    }

    text = editor.document.getText();
    let part = `part '${classOutline.name}.g.dart'`;
    if (!text.includes(part)) {
      let indexOf = text.lastIndexOf("import");
      let pos: vscode.Position;
      if (indexOf == -1) {
        pos = new vscode.Position(0, 0);
      } else {
        let at = editor.document.positionAt(indexOf);
        pos = at.with(at.line + 1, 0);
        part = "\n\n" + part;
      }

      succeed = (await this.genGPart(editor)) || succeed;
    }

    return succeed ? editor : undefined;
  }

  static async genGPart(editor: vscode.TextEditor): Promise<boolean> {
    let fileName = editor.document.fileName;
    let indexOf = fileName.lastIndexOf(path.sep);
    if (indexOf != -1) {
      fileName = fileName.substring(indexOf + 1);
    }
    indexOf = fileName.indexOf(".");
    if (indexOf != -1) {
      fileName = fileName.substring(0, indexOf);
    }

    let part = `part '${fileName}.g.dart'`;
    let text = editor.document.getText();
    if (!text.includes(part)) {
      let indexOf = text.lastIndexOf("import");
      let pos: vscode.Position;
      if (indexOf == -1) {
        pos = new vscode.Position(0, 0);
      } else {
        let at = editor.document.positionAt(indexOf);
        pos = at.with(at.line + 1, 0);
        part = "\n\n" + part;
      }

      return await editor.edit(edit => {
        edit.insert(pos, `${part};\n`);
      });
    }
    return false;
  }

  private static getselectionClass(
    outlines: vscode.DocumentSymbol[] | undefined,
    selection: vscode.Selection
  ): vscode.DocumentSymbol | undefined {
    if (!outlines || outlines.length == 0) {
      return undefined;
    }

    for (let outline of outlines) {
      if (outline.kind != vscode.SymbolKind.Class) {
        continue;
      }

      if (outline.range.contains(selection)) {
        return outline;
      }
    }
    return undefined;
  }

  private static async getter() {
    let result = await this.getDocumentOutline();
    if (!result) {
      return;
    }

    let editor = result.editor;
    let feilds = this.getChosenFields(
      result.editor.document,
      result.outline,
      editor.selection,
      true
    );

    if (!feilds || feilds.length == 0) {
      Logger.showNotification("请选择要执行Getter操作的字段");
      return;
    }

    let succeed = false;
    let insertLineCount = 1;
    for (const element of feilds) {
      for (const field of element.fields) {
        let fieldName = field.name;
        let getName = fieldName.startsWith("_")
          ? fieldName.substring(1)
          : fieldName;
        let findGet = element.getMethod.find(value => value.name == getName);
        if (findGet) {
          continue;
        }

        succeed =
          (await editor.edit(edit => {
            let returnName = fieldName;
            if (!fieldName.startsWith("_")) {
              returnName = `_${field.name}`;
              let range = field.range;
              if (range) {
                edit.replace(range, returnName);
              }
            }

            let pos = new vscode.Position(
              field.range.start.line + insertLineCount,
              0
            );
            let returnType = DartSdk.getReturnType(editor.document, field);
            let content = `${
              returnType ?? ""
            } get ${getName} => ${returnName};\n`;
            edit.insert(pos, content);
            insertLineCount++;
          })) || succeed;
      }
    }

    if (succeed) {
      await ForamtUtils.formatDocument(editor.document.uri);
      await editor.document.save();
    }
  }

  private static async setter() {
    let result = await this.getDocumentOutline();
    if (!result) {
      return;
    }

    let editor = result.editor;
    let feilds = this.getChosenFields(
      result.editor.document,
      result.outline,
      editor.selection,
      true
    );

    if (!feilds || feilds.length == 0) {
      Logger.showNotification("请选择要执行Setter操作的字段");
      return;
    }

    let succeed = false;
    let insertLineCount = 1;
    for (const element of feilds) {
      for (const field of element.fields) {
        let fieldName = field.name;
        let setName = fieldName.startsWith("_")
          ? fieldName.substring(1)
          : fieldName;
        let findSet = element.setMethod.find(value => value.name == setName);
        if (findSet) {
          continue;
        }

        succeed =
          (await editor.edit(edit => {
            let returnName = fieldName;
            if (!fieldName.startsWith("_")) {
              returnName = `_${field.name}`;
              let range = field.range;
              if (range) {
                edit.replace(range, returnName);
              }
            }

            let pos = new vscode.Position(
              field.range.start.line + insertLineCount,
              0
            );

            let returnType = DartSdk.getReturnType(editor.document, field);
            let content = `set ${setName}(${
              returnType ?? ""
            } value) {${returnName} = value;}\n`;
            edit.insert(pos, content);
            insertLineCount++;
          })) || succeed;
      }
    }

    if (succeed) {
      await ForamtUtils.formatDocument(editor.document.uri);
      await editor.document.save();
    }
  }

  private static async getterAndSetter() {
    let result = await this.getDocumentOutline();
    if (!result) {
      return;
    }

    let editor = result.editor;
    let feilds = this.getChosenFields(
      result.editor.document,
      result.outline,
      editor.selection,
      true
    );

    if (!feilds || feilds.length == 0) {
      Logger.showNotification("请选择要执行Getter And Setter操作的字段");
      return;
    }

    let succeed = false;
    let insertLineCount = 1;
    for (const element of feilds) {
      for (const field of element.fields) {
        let fieldName = field.name;
        let setName = fieldName.startsWith("_")
          ? fieldName.substring(1)
          : fieldName;
        let findGet = element.getMethod.find(value => value.name == setName);

        let findSet = element.setMethod.find(value => value.name == setName);

        if (findGet && findSet) {
          continue;
        }

        succeed =
          (await editor.edit(edit => {
            let returnName = fieldName;
            if (!fieldName.startsWith("_")) {
              returnName = `_${field.name}`;
              let range = field.range;
              if (range) {
                edit.replace(range, returnName);
              }
            }

            let pos = new vscode.Position(
              field.range.start.line + insertLineCount,
              0
            );

            let returnType =
              DartSdk.getReturnType(editor.document, field) ?? "";
            let content = "";
            if (!findGet) {
              content += `${returnType} get ${setName} => ${returnName};\n`;
              insertLineCount++;
            }

            if (!findSet) {
              content += `set ${setName}(${returnType} value) {${returnName} = value;}\n`;
              insertLineCount++;
            }

            edit.insert(pos, content);
          })) || succeed;
      }
    }

    if (succeed) {
      await ForamtUtils.formatDocument(editor.document.uri);
      await editor.document.save();
    }
  }

  private static async getDocumentOutline(): Promise<
    { editor: vscode.TextEditor; outline: vscode.DocumentSymbol[] } | undefined
  > {
    let editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let outline = await executeDocumentSymbolProvider(editor.document.uri);
    if (!outline) {
      Logger.showNotification("文件解析失败", "error");
      return;
    }

    return {
      editor,
      outline: outline,
    };
  }

  private static getChosenFields(
    document: vscode.TextDocument,
    outlines: vscode.DocumentSymbol[],
    selection: vscode.Selection,
    judgeRange: boolean
  ): FindField[] | undefined {
    if (!outlines || outlines.length == 0) {
      return undefined;
    }

    let findFields: FindField[] = [];
    let outLines: vscode.DocumentSymbol[] = [];
    let getMethod: vscode.DocumentSymbol[] = [];
    let setMethod: vscode.DocumentSymbol[] = [];
    for (let outline of outlines) {
      if (outline.kind == vscode.SymbolKind.Field) {
        if (!judgeRange) {
          outLines.push(outline);
        } else {
          let range = outline.range;
          if (range.contains(selection) || selection.contains(range)) {
            outLines.push(outline);
          }
        }
      } else if (outline.kind == vscode.SymbolKind.Method) {
        let type = DartSdk.getMethodType(document, outline);
        if (type == "GETTER") {
          getMethod.push(outline);
        } else if (type == "SETTER") {
          setMethod.push(outline);
        }
      } else if (outline.kind == vscode.SymbolKind.Class) {
        let range = outline.range;
        if (range.contains(selection)) {
          let result = this.getChosenFields(
            document,
            outline.children,
            selection,
            true
          );
          if (result) {
            findFields.push(...result);
          }
        } else if (selection.contains(range)) {
          let result = this.getChosenFields(
            document,
            outline.children,
            selection,
            false
          );
          if (result) {
            findFields.push(...result);
          }
        }
      }
    }

    return findFields.length == 0 && outLines.length == 0
      ? undefined
      : [
          {
            fields: outLines,
            getMethod,
            setMethod,
          },
          ...findFields,
        ];
  }
}

type FindField = {
  readonly fields: vscode.DocumentSymbol[];
  readonly getMethod: vscode.DocumentSymbol[];
  readonly setMethod: vscode.DocumentSymbol[];
};
