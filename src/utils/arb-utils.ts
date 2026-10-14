import * as vscode from "vscode";
import * as fs from "fs";
import * as pathUtils from "path";

const KEY_LINE_REGEX = /^(\s*)"((?:@)?[^"]+)"\s*:/;

/**
 * 读取 arb JSON 文件的目标语言：优先 @@locale_alias，其次 @@locale
 */
export function readArbLocale(obj: any): string | undefined {
  if (!obj) {
    return undefined;
  }
  return obj["@@locale_alias"] ?? obj["@@locale"];
}

/**
 * 列出与给定文件同目录的所有 arb 文件绝对路径
 */
export function listArbFilesInDir(filePath: string): string[] {
  const dirPath = pathUtils.dirname(filePath);
  return fs
    .readdirSync(dirPath)
    .filter(f => f.toLowerCase().endsWith(".arb"))
    .map(f => pathUtils.join(dirPath, f));
}

/**
 * 解析编辑器中选中的顶层 key；未选中时以光标所在顶层项为准。
 */
export function extractSelectedTopLevelKeys(
  editor: vscode.TextEditor
): string[] {
  const doc = editor.document;
  const selection = editor.selection;

  const topIndent = findTopLevelIndent(doc);
  if (topIndent === undefined) {
    return [];
  }

  let startLine: number;
  let endLine: number;
  if (selection.isEmpty) {
    const owner = findOwningTopLevelLine(doc, selection.active.line, topIndent);
    if (owner < 0) {
      return [];
    }
    startLine = owner;
    endLine = owner;
  } else {
    startLine = selection.start.line;
    endLine = selection.end.line;
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (let i = startLine; i <= endLine; i++) {
    const match = KEY_LINE_REGEX.exec(doc.lineAt(i).text);
    if (!match || match[1].length !== topIndent) {
      continue;
    }
    const key = match[2];
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * 返回首个顶层 key 行的缩进长度，用于区分顶层与嵌套。
 */
function findTopLevelIndent(doc: vscode.TextDocument): number | undefined {
  for (let i = 0; i < doc.lineCount; i++) {
    const match = KEY_LINE_REGEX.exec(doc.lineAt(i).text);
    if (match) {
      return match[1].length;
    }
  }
  return undefined;
}

/**
 * 从光标行向上查找所属顶层 key 行；找不到返回 -1。
 */
function findOwningTopLevelLine(
  doc: vscode.TextDocument,
  cursorLine: number,
  topIndent: number
): number {
  for (let i = cursorLine; i >= 0; i--) {
    const match = KEY_LINE_REGEX.exec(doc.lineAt(i).text);
    if (match && match[1].length === topIndent) {
      return i;
    }
  }
  return -1;
}
