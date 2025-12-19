import { unescape } from "querystring";
import * as vscode from "vscode";
import { TranslateUtils } from "./translate-utils";

export function disposeAll(disposables: vscode.Disposable[]) {
  const toDispose = disposables.slice();
  disposables.length = 0;
  for (const d of toDispose) {
    try {
      void d.dispose();
    } catch (e) {
      console.warn(e);
    }
  }
}

/**
 * 关闭指定路径文件/文件夹中已打开的编辑器
 * @param filePath 需要关闭编辑器的文件/文件夹路径
 */
export function closeFileEditor(filePath: string) {
  let foundTabs: vscode.Tab[] = [];
  for (let element of vscode.window.tabGroups.all) {
    const foundTab = element.tabs.filter(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.fsPath.startsWith(filePath)) {
          return true;
        }
      } else if (tab.input instanceof vscode.TabInputTextDiff) {
        if (tab.input.original.fsPath.startsWith(filePath)) {
          return true;
        }
      } else if (tab.input instanceof vscode.TabInputCustom) {
        if (tab.input.uri.fsPath.startsWith(filePath)) {
          return true;
        }
      } else if (tab.input instanceof vscode.TabInputNotebook) {
        if (tab.input.uri.fsPath.startsWith(filePath)) {
          return true;
        }
      } else if (tab.input instanceof vscode.TabInputNotebookDiff) {
        if (tab.input.original.fsPath.startsWith(filePath)) {
          return true;
        }
      }
      return false;
    });

    if (foundTab) {
      foundTabs.push(...foundTab);
    }
  }
  if (foundTabs.length > 0) {
    vscode.window.tabGroups.close(foundTabs, false);
  }
}

// 校验 Dart 类名的正则表达式
// Dart 类名规则:
// 1. 必须以大写字母开头
// 2. 只能包含字母、数字和下划线
// 3. 不能以下划线结尾
// 4. 不能包含连续的下划线
const dartClassNameRegex = /^[A-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)*$/;
export function isDartClassName(className: string): boolean {
  return dartClassNameRegex.test(className);
}

/**
 * 转成驼峰,[firstUp]指定第一个字母是否大写，默认true
 */
export function lowerCamelCase(str: string, firstUp: Boolean = true): string {
  if (str.length == 0) {
    return str;
  }

  let text = str.replace(RegExp("^_+"), "");
  if (text.length == 0) {
    return text;
  }

  let strings = text.split("_");
  let stringBuilder = "";
  for (let index = 0; index < strings.length; index++) {
    const element = strings[index];
    if (!firstUp && index == 0) {
      stringBuilder += element;
    } else {
      stringBuilder += capitalName(element);
    }
  }
  return stringBuilder;
}

/**
 * 将首字母转化为大写
 */
function capitalName(text: string): string {
  if (text.length > 0) {
    return text.substring(0, 1).toUpperCase() + text.substring(1);
  }
  return text;
}

/**
 * 通过文本内容推断类型
 * @param text 选中的文本
 * @returns 推断的类型
 */
function inferTypeFromText(text: string): vscode.SymbolKind | undefined {
  // 去除空白字符
  const trimmed = text.trim();
  // 检查是否是字符串字面量
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return vscode.SymbolKind.String;
  }

  // 检查是否是数字
  if (/^[\d.]+$/.test(trimmed) && !isNaN(Number(trimmed))) {
    return vscode.SymbolKind.Number;
  }

  // 检查是否是布尔值
  if (trimmed === "true" || trimmed === "false") {
    return vscode.SymbolKind.Boolean;
  }

  // 检查是否是对象字面量
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return vscode.SymbolKind.Object;
  }

  // 检查是否是数组字面量
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return vscode.SymbolKind.Array;
  }

  // 默认为未知类型
  return undefined;
}

export function isImage(name: string): boolean {
  let path = name.toLowerCase();
  return (
    path.endsWith("png") ||
    path.endsWith("jpg") ||
    path.endsWith("jpeg") ||
    path.endsWith("webp") ||
    path.endsWith("gif") ||
    path.endsWith("svg") ||
    path.endsWith("webm") ||
    path.endsWith("bmp")
  );
}

export function openFile(uri: any) {
  if (!uri) {
    return;
  }

  let url: vscode.Uri | null;
  if (uri instanceof vscode.Uri) {
    url = uri;
  } else if (typeof uri === "string") {
    url = vscode.Uri.parse(uri);
  } else {
    url = null;
  }

  if (url == null) {
    return;
  }
  vscode.commands.executeCommand("vscode.open", url);
}

/**
 * 反转义从vscode.TextDocument中取得的文本，从此文档取出的文本
 * 是进过转义的，使用系统自带的unescape无法反转义
 */
export function unescapeDocumentText(str: string): string {
  if (str.length < 2) {
    return str;
  }
  let regex = RegExp(/(?<!\\)(?:\\\\)*\\'/g);
  str = fixEscapeFormatError(regex, str);
  regex = RegExp(/(?<!\\)(?:\\\\)*\\"/g);
  str = fixEscapeFormatError(regex, str);
  regex = RegExp(/(?<!\\)(?:\\\\)*\\n/g);
  str = fixEscapeFormatError(regex, str, true);
  str = str.replaceAll(RegExp(/\\\\/g), "\\");
  return str;
}

function fixEscapeFormatError(
  regex: RegExp,
  text: string,
  isLineBreaks = false
): string {
  if (text.length == 0) {
    return text;
  }

  let matchResult = regex.exec(text);
  if (!matchResult) {
    return text;
  }

  var placeHolder = matchResult[0];
  let oldLength = placeHolder.length;
  let count = 0;
  for (let i = 0; i < placeHolder.length; i++) {
    if (placeHolder[i] === "\\") {
      count++;
    }
  }

  if (count % 2 != 0) {
    if (isLineBreaks) {
      if (count == 1) {
        placeHolder = "\n";
      }
    } else {
      placeHolder = placeHolder.substring(1, placeHolder.length);
    }
  }

  regex.lastIndex =
    matchResult.index! + oldLength + (placeHolder.length - oldLength);
  return fixEscapeFormatError(
    regex,
    replaceRange(text, matchResult.index, oldLength, placeHolder),
    isLineBreaks
  );
}

function replaceRange(
  str: string,
  start: number,
  length: number,
  replacement: string
): string {
  return str.substring(0, start) + replacement + str.substring(start + length);
}
