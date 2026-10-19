import * as vscode from "vscode";
import * as cp from "child_process";
import Logger from "./logger";
import { ConfigUtils } from "./config-utils";
import {
  executeFormatDocumentProvider,
  executeFormatRangeProvider,
} from "./build-in-command-utils";

export class ForamtUtils {
  private constructor() {}

  /**
   * 格式化文档，调用此方法之前，需要先打开文档
   * @param documentUri
   * @param options
   * @returns
   */
  static async formatDocument(documentUri: vscode.Uri, options?: FormatOption) {
    try {
      let edits = await executeFormatDocumentProvider(
        documentUri,
        options ?? {
          insertSpaces: true,
          tabSize: ConfigUtils.tabSize,
        },
      );

      this.applyFromatResult(documentUri, edits);
    } catch (e) {
      Logger.e(e);
    }
  }

  /**
   * 使用 dart format 命令格式化文件
   */
  static async formatWithDartCommand(documentUri: vscode.Uri): Promise<void> {
    try {
      const filePath = documentUri.fsPath;
      // 执行 dart format 命令
      const result = cp.spawnSync("dart", ["format", filePath], {
        encoding: "utf-8",
        timeout: 10000,
      });

      if (result.status === 0) {
        // 重新加载文档以获取格式化后的内容
        const doc = await vscode.workspace.openTextDocument(documentUri);
        await doc.save();
      } else {
        Logger.e(`dart format failed: ${result.stderr}`);
      }
    } catch (e) {
      Logger.e(`Failed to run dart format: ${e}`);
    }
  }

  static async formatRange(
    documentUri: vscode.Uri,
    range: vscode.Range,
    options?: FormatOption,
  ) {
    try {
      let edits = await executeFormatRangeProvider(
        documentUri,
        range,
        options ?? {
          insertSpaces: true,
          tabSize: ConfigUtils.tabSize,
        },
      );
      this.applyFromatResult(documentUri, edits);
    } catch (e) {
      Logger.e(e);
    }
  }

  private static async applyFromatResult(
    documentUri: vscode.Uri,
    edits: vscode.TextEdit[],
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
