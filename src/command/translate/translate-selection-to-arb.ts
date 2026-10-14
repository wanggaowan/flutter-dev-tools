import * as vscode from "vscode";
import * as fs from "fs";
import * as pathUtils from "path";
import * as yaml from "yaml";
import { disposeAll } from "../../utils/utils";
import {
  extractSelectedTopLevelKeys,
  listArbFilesInDir,
  readArbLocale,
} from "../../utils/arb-utils";
import { COMMAND_TRANSLATE_SELECTION_TO_ARB } from "../../constants.contexts";
import Logger from "../../utils/logger";
import { getSdk } from "../../extension";
import { TranslateUtils } from "../../utils/translate-utils";

/**
 * 将选中 arb 条目的 value 翻译并插入到同目录其它 arb 文件
 */
export class TranslateSelectionToArb {
  private disposableList: vscode.Disposable[] = [];

  constructor() {
    let dispose = vscode.commands.registerCommand(
      COMMAND_TRANSLATE_SELECTION_TO_ARB,
      TranslateSelectionToArb.execute
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

    let sourceObj: any;
    try {
      sourceObj = JSON.parse(fs.readFileSync(doc.fileName, "utf-8"));
    } catch (e) {
      Logger.showNotification("当前 arb 文件解析失败", "error");
      return;
    }

    const sourceLocale = readArbLocale(sourceObj);
    if (!sourceLocale) {
      Logger.showNotification(
        "当前 arb 文件未配置@@locale或@@locale_alias属性，无法确定源语言",
        "error"
      );
      return;
    }

    const entries = selectedKeys
      .filter(key => key !== "@@locale" && key !== "@@locale_alias")
      .map(key => ({ key, value: sourceObj[key] }))
      .filter(entry => entry.value !== undefined);

    if (entries.length === 0) {
      Logger.showNotification("选中的条目没有可翻译的内容", "warn");
      return;
    }

    const allArbFiles = listArbFilesInDir(doc.fileName);
    const targetFiles = allArbFiles.filter(
      f => pathUtils.resolve(f) !== pathUtils.resolve(doc.fileName)
    );
    if (targetFiles.length === 0) {
      Logger.showNotification("同目录下没有其它 arb 文件");
      return;
    }

    const dirtyOther = vscode.workspace.textDocuments.find(
      d => targetFiles.includes(d.fileName) && d.isDirty
    );
    if (dirtyOther) {
      Logger.showNotification(
        `请先保存未保存的文件：${pathUtils.basename(dirtyOther.fileName)}`,
        "error"
      );
      return;
    }

    const overwrite = await TranslateSelectionToArb.confirm(
      sourceLocale,
      entries.map(e => e.key),
      targetFiles
    );
    if (overwrite === undefined) {
      return;
    }

    const useEscaping = TranslateSelectionToArb.readUseEscaping();

    return vscode.window.withProgress(
      {
        cancellable: true,
        location: vscode.ProgressLocation.Window,
        title: "Translate selection to arb",
      },
      async (progress, token) => {
        return TranslateSelectionToArb.doTranslate(
          sourceLocale,
          entries,
          targetFiles,
          useEscaping,
          overwrite,
          progress,
          token
        );
      }
    );
  }

  private static async doTranslate(
    sourceLocale: string,
    entries: { key: string; value: any }[],
    targetFiles: string[],
    useEscaping: boolean,
    overwrite: boolean,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
  ) {
    // 按目标语言缓存翻译结果，避免同一语言重复调用
    const cache = new Map<string, Map<string, string | null>>();
    const total = targetFiles.length;
    let count = 0;
    let insertedTotal = 0;
    const skippedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const filePath of targetFiles) {
      const fileName = pathUtils.basename(filePath);
      count++;
      if (token.isCancellationRequested) {
        break;
      }
      progress.report({ message: `${count} / ${total} ${fileName}` });

      let targetObj: any;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (!content || content.trim().length === 0) {
          failedFiles.push(`${fileName}(内容为空)`);
          continue;
        }
        targetObj = JSON.parse(content);
      } catch (e) {
        failedFiles.push(`${fileName}(解析失败)`);
        continue;
      }

      const targetLocale = readArbLocale(targetObj);
      if (!targetLocale) {
        skippedFiles.push(`${fileName}(未配置locale)`);
        continue;
      }

      const translated = new Map<string, any>();
      let hasError = false;
      for (const entry of entries) {
        if (token.isCancellationRequested) {
          break;
        }

        if (!overwrite && Object.prototype.hasOwnProperty.call(targetObj, entry.key)) {
          continue;
        }

        // 非字符串（如占位符元数据对象）直接复制
        if (typeof entry.value !== "string") {
          translated.set(entry.key, entry.value);
          continue;
        }

        if (entry.value.trim().length === 0 || targetLocale === sourceLocale) {
          translated.set(
            entry.key,
            TranslateUtils.fixTranslateError(entry.value, useEscaping, true)
          );
          continue;
        }

        let localeCache = cache.get(targetLocale);
        if (!localeCache) {
          localeCache = new Map<string, string | null>();
          cache.set(targetLocale, localeCache);
        }

        if (!localeCache.has(entry.key)) {
          const result = await TranslateUtils.translate(
            sourceLocale,
            targetLocale,
            entry.value
          );
          localeCache.set(
            entry.key,
            result
              ? TranslateUtils.fixTranslateError(result, useEscaping, true)
              : null
          );
        }

        const value = localeCache.get(entry.key);
        if (value === null || value === undefined) {
          hasError = true;
          continue;
        }
        translated.set(entry.key, value);
      }

      if (translated.size === 0) {
        skippedFiles.push(`${fileName}(已存在或无内容)`);
        continue;
      }

      for (const [key, value] of translated.entries()) {
        targetObj[key] = value;
      }
      fs.writeFileSync(filePath, JSON.stringify(targetObj, null, 2), "utf-8");
      insertedTotal += translated.size;
      if (hasError) {
        Logger.showNotification(`${fileName} 存在翻译失败的内容，请重试`, "warn");
      }
    }

    const summary: string[] = [];
    summary.push(`已插入 ${insertedTotal} 项`);
    if (skippedFiles.length > 0) {
      summary.push(`跳过：${skippedFiles.join(", ")}`);
    }
    if (failedFiles.length > 0) {
      summary.push(`失败：${failedFiles.join(", ")}`);
    }
    Logger.showNotification(summary.join("；"), insertedTotal === 0 ? "warn" : "info");
  }

  /**
   * 从 l10n.yaml 读取 use-escaping 配置
   */
  private static readUseEscaping(): boolean {
    const sdk = getSdk();
    if (!sdk) {
      return false;
    }
    const l10nFilePath = vscode.Uri.joinPath(sdk.workspace, "l10n.yaml");
    if (!fs.existsSync(l10nFilePath.fsPath)) {
      return false;
    }
    try {
      const contents = fs.readFileSync(l10nFilePath.fsPath, "utf-8");
      const result = yaml.parseDocument(contents);
      const useEscap = result.get("use-escaping");
      if (typeof useEscap === "boolean") {
        return useEscap;
      }
      if (typeof useEscap === "string") {
        return "true" === useEscap;
      }
    } catch (e) {
      Logger.e(e);
    }
    return false;
  }

  /**
   * 返回 undefined 表示取消，true 覆盖已存在，false 跳过已存在
   */
  private static async confirm(
    sourceLocale: string,
    keys: string[],
    targetFiles: string[]
  ): Promise<boolean | undefined> {
    const detail =
      `将从源语言[${sourceLocale}]翻译以下 ${keys.length} 项，并插入同目录 ${targetFiles.length} 个 arb 文件：\n` +
      `${keys.join(", ")}`;
    const overwriteLabel = "覆盖已存在";
    const skipLabel = "跳过已存在";
    const pick = await Logger.showNotification(
      detail,
      "warn",
      { modal: true },
      overwriteLabel,
      skipLabel
    );
    if (pick === overwriteLabel) {
      return true;
    }
    if (pick === skipLabel) {
      return false;
    }
    return undefined;
  }
}
