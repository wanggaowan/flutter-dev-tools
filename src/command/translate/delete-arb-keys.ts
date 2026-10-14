import * as vscode from "vscode";
import * as fs from "fs";
import * as pathUtils from "path";
import { disposeAll } from "../../utils/utils";
import {
  extractSelectedTopLevelKeys,
  listArbFilesInDir,
} from "../../utils/arb-utils";
import { COMMAND_DELETE_ARB_KEYS } from "../../constants.contexts";
import Logger from "../../utils/logger";

/**
 * 在同目录所有 arb 文件中按 key 精确删除选中条目
 */
export class DeleteArbKeys {
  private disposableList: vscode.Disposable[] = [];

  constructor() {
    let dispose = vscode.commands.registerCommand(
      COMMAND_DELETE_ARB_KEYS,
      DeleteArbKeys.execute
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  static async execute() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      Logger.showNotification("请在 arb 文件中操作", "error");
      return;
    }

    const doc = editor.document;
    if (!doc.fileName.toLowerCase().endsWith(".arb")) {
      Logger.showNotification("当前文件不是 arb 文件", "error");
      return;
    }

    if (doc.isDirty) {
      Logger.showNotification("请先保存当前 arb 文件", "error");
      return;
    }

    const selectedKeys = extractSelectedTopLevelKeys(editor);
    if (selectedKeys.length === 0) {
      Logger.showNotification("未识别到选中的顶层 key", "warn");
      return;
    }

    const arbFiles = listArbFilesInDir(doc.fileName);

    const dirtyOther = vscode.workspace.textDocuments.find(
      d => arbFiles.includes(d.fileName) && d.isDirty
    );
    if (dirtyOther) {
      Logger.showNotification(
        `请先保存未保存的文件：${pathUtils.basename(dirtyOther.fileName)}`,
        "error"
      );
      return;
    }

    const keysToDelete = DeleteArbKeys.expandWithMetadata(selectedKeys);
    const confirmed = await DeleteArbKeys.confirm(
      selectedKeys,
      keysToDelete,
      arbFiles
    );
    if (!confirmed) {
      return;
    }

    const removedKeys = new Set<string>();
    const affectedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const filePath of arbFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (!content || content.trim().length === 0) {
          continue;
        }
        const obj = JSON.parse(content);
        let changed = false;
        for (const key of keysToDelete) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            delete obj[key];
            removedKeys.add(key);
            changed = true;
          }
        }
        if (changed) {
          fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
          affectedFiles.push(pathUtils.basename(filePath));
        }
      } catch (e) {
        failedFiles.push(pathUtils.basename(filePath));
      }
    }

    if (failedFiles.length > 0) {
      Logger.showNotification(
        `解析失败已跳过：${failedFiles.join(", ")}`,
        "error"
      );
    }

    if (affectedFiles.length === 0) {
      Logger.showNotification("没有任何 arb 文件包含选中的 key");
      return;
    }

    Logger.showNotification(
      `已从 ${affectedFiles.length} 个 arb 文件中删除 ${removedKeys.size} 项：${affectedFiles.join(
        ", "
      )}`
    );
  }

  /**
   * 对未以 @ 开头的 key 附带元数据 @key，保持 ARB 语义。
   */
  private static expandWithMetadata(keys: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
      if (!key.startsWith("@")) {
        const meta = `@${key}`;
        if (!seen.has(meta)) {
          seen.add(meta);
          out.push(meta);
        }
      }
    }
    return out;
  }

  private static async confirm(
    selectedKeys: string[],
    keysToDelete: string[],
    arbFiles: string[]
  ): Promise<boolean> {
    const listText = selectedKeys.join(", ");
    const extraCount = keysToDelete.length - selectedKeys.length;
    const detail =
      `将从同目录 ${arbFiles.length} 个 arb 文件中删除以下顶层 key：\n${listText}` +
      (extraCount > 0
        ? `\n（同时删除对应的 @key 元数据 ${extraCount} 项）`
        : "");
    const yes = "确认删除";
    const pick = await Logger.showNotification(
      detail,
      "warn",
      { modal: true },
      yes
    );
    return pick === yes;
  }
}
