import * as vscode from "vscode";
import Logger from "./logger";
import { ConfigUtils } from "./config-utils";
import {
  executeFormatDocumentProvider,
  executeFormatRangeProvider,
} from "./build-in-command-utils";

export class ForamtUtils {
  private constructor() {}

  static async formatDocument(documentUri: vscode.Uri, options?: FormatOption) {
    try {
      let edits = await executeFormatDocumentProvider(
        documentUri,
        options ?? {
          insertSpaces: true,
          tabSize: ConfigUtils.tabSize,
        }
      );
      this.applyFromatResult(documentUri, edits);
    } catch (e) {
      Logger.e(e);
    }
  }

  static async formatRange(
    documentUri: vscode.Uri,
    range: vscode.Range,
    options?: FormatOption
  ) {
    try {
      let edits = await executeFormatRangeProvider(
        documentUri,
        range,
        options ?? {
          insertSpaces: true,
          tabSize: ConfigUtils.tabSize,
        }
      );
      this.applyFromatResult(documentUri, edits);
    } catch (e) {
      Logger.e(e);
    }
  }

  private static async applyFromatResult(
    documentUri: vscode.Uri,
    edits: vscode.TextEdit[]
  ) {
    if (!edits || edits.length == 0) {
      return;
    }

    // 创建工作空间编辑
    const workspaceEdit = new vscode.WorkspaceEdit();
    // 将所有编辑添加到工作空间编辑中
    workspaceEdit.set(documentUri, edits);
    // 应用工作空间编辑
    await vscode.workspace.applyEdit(workspaceEdit);
  }
}

type FormatOption = {
  // 使用空格而不是制表符
  insertSpaces?: boolean;
  // 缩进大小
  tabSize: number;
};
