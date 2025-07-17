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
import { getSdk } from "../extension";
import { DartSdk, PublicOutline } from "../sdk";
import { ForamtUtils } from "../utils/format-utils";
import { ConfigUtils } from "../utils/config-utils";
import path from "path";

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
    { editor: vscode.TextEditor; outline: PublicOutline } | undefined
  > {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    let sdk = getSdk()?.dartSdk;
    if (!sdk) {
      Logger.showNotification("dart sdk未初始化", "error");
      return;
    }

    let outline: PublicOutline | undefined;
    try {
      outline = await sdk.getOutline(editor.document);
      if (!outline) {
        Logger.showNotification("文件解析失败", "error");
        return;
      }
    } catch (e: any) {
      Logger.showNotification(e.message, "warn");
      return;
    }

    const selection = editor.selection;
    let classOutline = this.getselectionClass(outline.children, selection);
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
    if (!value) {
      return;
    }

    let editor = value.editor;
    let classOutline = value.outline;

    let children = classOutline.children ?? [];
    let fieldOutlines: PublicOutline[] = [];
    for (let element of children) {
      if (element.element.kind == "FIELD") {
        fieldOutlines.push(element);
      } else if (element.element.kind == "CONSTRUCTOR") {
        if (element.element.name == classOutline.element.name) {
          // 如果存在工厂构造函数或命名构造函数，则不会阻止创建
          return;
        }
      }
    }

    let hasField = fieldOutlines.length > 0;
    let content = `\n${classOutline.element.name}(${hasField ? "{" : ""}`;
    fieldOutlines.forEach(outline => {
      if (outline.element.returnType?.includes("?") == false) {
        content += `required this.${outline.element.name},`;
      } else {
        content += `this.${outline.element.name},`;
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
    if (!value) {
      return;
    }

    let editor = value.editor;
    let classOutline = value.outline;
    let children = classOutline.children ?? [];
    let existFromJson = false;
    let existToJson = false;
    let existFromJsonList = false;
    for (let element of children) {
      if (element.element.kind == "METHOD") {
        if (element.element.name == "toJson") {
          existToJson = true;
        } else if (element.element.name == "fromJsonList") {
          existFromJsonList = true;
        }
      } else if (element.element.kind == "CONSTRUCTOR") {
        if (element.element.name == `${classOutline.element.name}.fromJson`) {
          existFromJson = true;
        }
      }
    }

    let content = "";
    if (!existFromJson) {
      content =
        `factory ${classOutline.element.name}.fromJson(Map<String, dynamic> json) =>` +
        `\n    _$${classOutline.element.name}FromJson(json);`;
    }

    if (!existToJson) {
      content += `\n\nMap<String, dynamic> toJson() => _$${classOutline.element.name}ToJson(this);`;
    }

    if (!existFromJsonList) {
      content +=
        `\n\nstatic List<${classOutline.element.name}> fromJsonList(List<dynamic> json) => json` +
        `\n    .map((e) => ${classOutline.element.name}.fromJson(e as Map<String, dynamic>))` +
        "\n    .toList();";
    }

    let succeed = false;
    if (content.length > 0) {
      let indexOf = editor.document.getText(classOutline.range).indexOf("{");
      let end = classOutline.range.end;
      let pos = new vscode.Position(end.line, end.character - 1);
      succeed = await editor.edit(edit => {
        edit.insert(pos, "\n\n" + content);
      });
    }

    let text = editor.document.getText(classOutline.range);
    if (!text.includes("@JsonSerializable")) {
      let start = classOutline.range.start;
      let content = "@JsonSerializable(";
      let converts = ConfigUtils.converts;
      if (converts && converts.length > 0) {
        content += `converters: ${converts}`;
      }
      content += ")\n";
      succeed =
        (await editor.edit(edit => {
          edit.insert(start, `\n${content}`);
        })) || succeed;
    }

    succeed = (await this.genGPart(editor)) || succeed;
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
      let range = DartSdk.getLastPartRange(editor.document);
      if (!range) {
        range = DartSdk.getLastImportRange(editor.document);
      }

      let pos: vscode.Position;
      if (range) {
        pos = range.end.with(range.end.line + 1, 0);
      } else {
        pos = new vscode.Position(0, 0);
      }

      part = "\n\n" + part;
      return await editor.edit(edit => {
        edit.insert(pos, `${part};\n`);
      });
    }
    return false;
  }

  private static getselectionClass(
    outlines: PublicOutline[] | undefined,
    selection: vscode.Selection
  ): PublicOutline | undefined {
    if (!outlines || outlines.length == 0) {
      return undefined;
    }

    for (let outline of outlines) {
      if (outline.element.kind != "CLASS") {
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
    let feilds = this.getChosenFields(result.outline, editor.selection, true);

    if (!feilds || feilds.length == 0) {
      Logger.showNotification("请选择要执行Getter操作的字段");
      return;
    }

    let succeed = false;
    let insertLineCount = 1;
    for (const element of feilds) {
      for (const field of element.fields) {
        let fieldName = field.element.name;
        let getName = fieldName.startsWith("_")
          ? fieldName.substring(1)
          : fieldName;
        let findGet = element.getMethod.find(
          value => value.element.name == getName
        );
        if (findGet) {
          continue;
        }

        succeed =
          (await editor.edit(edit => {
            let returnName = fieldName;
            if (!fieldName.startsWith("_")) {
              returnName = `_${field.element.name}`;
              let range = field.element.range;
              if (range) {
                edit.replace(range, returnName);
              }
            }

            let pos = new vscode.Position(
              field.range.start.line + insertLineCount,
              0
            );
            let content = `${field.element.returnType} get ${getName} => ${returnName};\n`;
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
    let feilds = this.getChosenFields(result.outline, editor.selection, true);

    if (!feilds || feilds.length == 0) {
      Logger.showNotification("请选择要执行Setter操作的字段");
      return;
    }

    let succeed = false;
    let insertLineCount = 1;
    for (const element of feilds) {
      for (const field of element.fields) {
        let fieldName = field.element.name;
        let setName = fieldName.startsWith("_")
          ? fieldName.substring(1)
          : fieldName;
        let findSet = element.setMethod.find(
          value => value.element.name == setName
        );
        if (findSet) {
          continue;
        }

        succeed =
          (await editor.edit(edit => {
            let returnName = fieldName;
            if (!fieldName.startsWith("_")) {
              returnName = `_${field.element.name}`;
              let range = field.element.range;
              if (range) {
                edit.replace(range, returnName);
              }
            }

            let pos = new vscode.Position(
              field.range.start.line + insertLineCount,
              0
            );
            let content = `set ${setName}(${field.element.returnType} value) {${returnName} = value;}\n`;
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
    let feilds = this.getChosenFields(result.outline, editor.selection, true);

    if (!feilds || feilds.length == 0) {
      Logger.showNotification("请选择要执行Getter And Setter操作的字段");
      return;
    }

    let succeed = false;
    let insertLineCount = 1;
    for (const element of feilds) {
      for (const field of element.fields) {
        let fieldName = field.element.name;
        let setName = fieldName.startsWith("_")
          ? fieldName.substring(1)
          : fieldName;
        let findGet = element.getMethod.find(
          value => value.element.name == setName
        );

        let findSet = element.setMethod.find(
          value => value.element.name == setName
        );

        if (findGet && findSet) {
          continue;
        }

        succeed =
          (await editor.edit(edit => {
            let returnName = fieldName;
            if (!fieldName.startsWith("_")) {
              returnName = `_${field.element.name}`;
              let range = field.element.range;
              if (range) {
                edit.replace(range, returnName);
              }
            }

            let pos = new vscode.Position(
              field.range.start.line + insertLineCount,
              0
            );
            let content = "";
            if (!findGet) {
              content += `${field.element.returnType} get ${setName} => ${returnName};\n`;
              insertLineCount++;
            }

            if (!findSet) {
              content += `set ${setName}(${field.element.returnType} value) {${returnName} = value;}\n`;
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
    { editor: vscode.TextEditor; outline: PublicOutline } | undefined
  > {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    let sdk = getSdk()?.dartSdk;
    if (!sdk) {
      Logger.showNotification("dart sdk未初始化", "error");
      return;
    }

    let outline: PublicOutline | undefined;
    try {
      outline = await sdk.getOutline(editor.document);
      if (!outline) {
        Logger.showNotification("文件解析失败", "error");
        return;
      }
    } catch (e: any) {
      Logger.showNotification(e.message, "warn");
      return;
    }

    return {
      editor,
      outline: outline,
    };
  }

  private static getChosenFields(
    parent: PublicOutline,
    selection: vscode.Selection,
    judgeRange: boolean
  ): FindField[] | undefined {
    let outlines = parent.children;
    if (!outlines || outlines.length == 0) {
      return undefined;
    }

    let findFields: FindField[] = [];
    let outLines: PublicOutline[] = [];
    let getMethod: PublicOutline[] = [];
    let setMethod: PublicOutline[] = [];
    for (let outline of outlines) {
      if (outline.element.kind == "FIELD") {
        if (!judgeRange) {
          outLines.push(outline);
        } else {
          let range = outline.range;
          if (range.contains(selection) || selection.contains(range)) {
            outLines.push(outline);
          }
        }
      } else if (outline.element.kind == "GETTER") {
        getMethod.push(outline);
      } else if (outline.element.kind == "SETTER") {
        setMethod.push(outline);
      } else if (
        outline.element.kind == "CLASS" ||
        outline.element.kind == "MIXIN"
      ) {
        let range = outline.range;
        if (range.contains(selection)) {
          let result = this.getChosenFields(outline, selection, true);
          if (result) {
            findFields.push(...result);
          }
        } else if (selection.contains(range)) {
          let result = this.getChosenFields(outline, selection, false);
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
            parent,
            fields: outLines,
            getMethod,
            setMethod,
          },
          ...findFields,
        ];
  }
}

type FindField = {
  readonly parent: PublicOutline;
  readonly fields: PublicOutline[];
  readonly getMethod: PublicOutline[];
  readonly setMethod: PublicOutline[];
};
