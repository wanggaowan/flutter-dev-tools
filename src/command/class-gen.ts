import * as vscode from "vscode";
import { disposeAll } from "../utils/utils";
import {
  COMMAND_GEN_CONSTRUCTOR,
  COMMAND_GEN_SERIALIZATION,
} from "../constants.contexts";
import Logger from "../utils/logger";
import { getSdk } from "../extension";
import { DartSdk, Outline } from "../sdk";
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
    { editor: vscode.TextEditor; outline: Outline } | undefined
  > {
    let editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let sdk = getSdk()?.dartSdk;
    if (!sdk) {
      Logger.showNotification("dart sdk未初始化", "error");
      return;
    }

    let outline = await sdk.waitForOutline(editor.document);
    if (!outline) {
      Logger.showNotification("文件解析失败", "error");
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
    if (!value) return;

    let editor = value.editor;
    let classOutline = value.outline;

    let children = classOutline.children ?? [];
    let fieldOutlines: Outline[] = [];
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
    let indexOf = editor.document
      .getText(DartSdk.range2VsRange(classOutline.range))
      .indexOf("{");
    let pos: vscode.Position;
    if (indexOf != -1) {
      let offset = editor.document.offsetAt(
        DartSdk.position2VsPosition(classOutline.range.start)
      );
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
      let indexOf = editor.document
        .getText(DartSdk.range2VsRange(classOutline.range))
        .indexOf("{");
      let end = classOutline.range.end;
      let pos = new vscode.Position(end.line, end.character - 1);
      succeed = await editor.edit(edit => {
        edit.insert(pos, "\n\n" + content);
      });
    }

    let text = editor.document.getText(
      DartSdk.range2VsRange(classOutline.range)
    );
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
    let part = `part '${classOutline.element.name}.g.dart'`;
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
    outlines: Outline[] | undefined,
    selection: vscode.Selection
  ): Outline | undefined {
    if (!outlines || outlines.length == 0) {
      return undefined;
    }

    for (let outline of outlines) {
      if (outline.element.kind != "CLASS") {
        continue;
      }

      if (DartSdk.range2VsRange(outline.range).contains(selection)) {
        return outline;
      }
    }
    return undefined;
  }
}
