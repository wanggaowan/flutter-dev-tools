import * as vscode from "vscode";
export class ConfigUtils {
  private constructor() {}

  /**
   * 获取默认的存放图片资源的目录
   */
  static get tabSize(): number {
    return vscode.workspace.getConfiguration("editor").tabSize ?? 4;
  }

  /**
   * 获取默认的存放图片资源的目录
   */
  static get imageSrcPath(): string | undefined {
    return vscode.workspace.getConfiguration("flutterDevTools").imageSrcPath;
  }

  static get classSuffix(): string {
    return (
      vscode.workspace.getConfiguration("flutterDevTools").classSuffix ?? ""
    );
  }

  static get generateDoc(): boolean {
    return (
      vscode.workspace.getConfiguration("flutterDevTools").generateDoc ?? true
    );
  }

  static get generateConstructor(): boolean {
    return (
      vscode.workspace.getConfiguration("flutterDevTools")
        .generateConstructor ?? true
    );
  }
}
