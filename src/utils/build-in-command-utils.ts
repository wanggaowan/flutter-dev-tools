import * as vscode from "vscode";

/**
 * 设置上下文，此上下文可作用于package.json中when表达式
 * @param key
 * @param value
 * @returns
 */
export function setContext(key: string, value: any) {
  return vscode.commands.executeCommand("setContext", key, value);
}

/**
 * 执行格式化文档命令
 * @param documentUri
 * @param options
 * @returns
 */
export function executeFormatDocumentProvider(
  documentUri: vscode.Uri,
  options: FormatOption
) {
  return vscode.commands.executeCommand<vscode.TextEdit[]>(
    "vscode.executeFormatDocumentProvider",
    documentUri,
    options
  );
}

/**
 * 执行格式化文档命令，但是可指定格式化范围
 * @param documentUri
 * @param range
 * @param options
 * @returns
 */
export function executeFormatRangeProvider(
  documentUri: vscode.Uri,
  range: vscode.Range,
  options: FormatOption
) {
  return vscode.commands.executeCommand<vscode.TextEdit[]>(
    "vscode.executeFormatRangeProvider",
    documentUri,
    range,
    options
  );
}

/**
 * 获取文档中所有元素的类型
 * @param documentUri
 * @param range
 * @param options
 * @returns
 */
export function executeDocumentSymbolProvider(documentUri: vscode.Uri) {
  return vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider",
    documentUri
  );
}

/**
 * 获取指定uri文件中指定位置元素的引用
 */
export function executeReferenceProvider(
  uri: vscode.Uri,
  position: vscode.Position
) {
  return vscode.commands.executeCommand<vscode.Location[] | undefined | null>(
    "vscode.executeReferenceProvider",
    uri,
    position
  );
}

/**
 * 获取指定uri文件中指定位置元素的定义
 */
export function executeDefinitionProvider(
  uri: vscode.Uri,
  position: vscode.Position
) {
  return vscode.commands.executeCommand<
    vscode.Location[] | vscode.DefinitionLink[] | undefined | null
  >("vscode.executeDefinitionProvider", uri, position);
}

export type FormatOption = {
  // 使用空格而不是制表符
  insertSpaces?: boolean;
  // 缩进大小
  tabSize: number;
};
