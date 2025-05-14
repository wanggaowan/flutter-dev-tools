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
          this.genConstructor();
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
          this.genSerialization();
        }
      )
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  private async genConstructor() {
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
      Logger.showNotification("光标所在范围未识别到相关类", "wran");
      return;
    }

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

    let content = `\n${classOutline.element.name}({`;
    fieldOutlines.forEach(outline => {
      if (outline.element.returnType?.includes("?") == false) {
        content += `required this.${outline.element.name},`;
      } else {
        content += `this.${outline.element.name},`;
      }
    });
    content += "});\n";
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
    await editor.edit(edit => {
      edit.insert(pos, content);
    });
    await ForamtUtils.formatDocument(editor.document.uri);
  }

  private async genSerialization() {
    
  }

  private getselectionClass(
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
