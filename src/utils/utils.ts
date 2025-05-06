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
