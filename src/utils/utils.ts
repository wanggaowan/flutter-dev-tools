import * as vscode from "vscode";

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
    const foundTab = element.tabs.filter((tab) => {
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
