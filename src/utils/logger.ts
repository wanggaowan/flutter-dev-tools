import * as vscode from "vscode";

class Logger {
  private constructor() {}

  private static logEnable() {
    return true;
  }

  static i(message?: any, ...optionalParams: any[]) {
    if (this.logEnable()) {
      return;
    }

    console.info(message, optionalParams);
  }

  static d(message?: any, ...optionalParams: any[]) {
    if (this.logEnable()) {
      return;
    }

    console.debug(message, optionalParams);
  }

  static w(message?: any, ...optionalParams: any[]) {
    if (this.logEnable()) {
      return;
    }

    console.warn(message, optionalParams);
  }

  static e(message?: any, ...optionalParams: any[]) {
    if (this.logEnable()) {
      return;
    }

    console.error(message, optionalParams);
  }

  static showNotification<T extends string>(
    message: string,
    type: "info" | "wran" | "error" = "info",
    options?: vscode.MessageOptions,
    ...items: T[]
  ): Thenable<T | undefined> {
    if (type == "error") {
      if (options) {
        return vscode.window.showErrorMessage(message, options, ...items);
      } else {
        return vscode.window.showErrorMessage(message, ...items);
      }
    } else if (type == "wran") {
      if (options) {
        return vscode.window.showWarningMessage(message, options, ...items);
      } else {
        return vscode.window.showWarningMessage(message, ...items);
      }
    } else if (options) {
      return vscode.window.showInformationMessage(message, options, ...items);
    } else {
      return vscode.window.showInformationMessage(message, ...items);
    }
  }
}

export default Logger;
