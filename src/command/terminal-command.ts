import * as vscode from "vscode";
import { disposeAll } from "../utils/utils";
import {
  COMMAND_GEN_G_FILE,
  COMMAND_GEN_G_FILE_SINGLE,
  COMMAND_SHOW_DEPS,
  EXTENSION_NAME,
} from "../constants.contexts";
import { getSdk } from "../extension";
import path from "path";

/**
 * 执行终端命令
 */
export class TerminalCommand {
  private disposableList: vscode.Disposable[] = [];

  constructor() {
    let dispose = vscode.commands.registerCommand(COMMAND_GEN_G_FILE, () =>
      TerminalCommand.genGFile(false)
    );
    this.disposableList.push(dispose);

    dispose = vscode.commands.registerCommand(COMMAND_GEN_G_FILE_SINGLE, () =>
      TerminalCommand.genGFile(true)
    );
    this.disposableList.push(dispose);

    dispose = vscode.commands.registerCommand(COMMAND_SHOW_DEPS, () =>
      TerminalCommand.showDpes()
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  /**
   * 生成.g.dart文件
   * @param isSigle 是否只生成当前选择的文件
   */
  private static genGFile(isSigle: boolean) {
    let command = "flutter pub run build_runner build";
    if (isSigle) {
      let fileName = vscode.window.activeTextEditor?.document.fileName;
      if (!fileName) {
        return;
      }

      let projectPath = getSdk()?.workspace.fsPath;
      if (projectPath) {
        fileName = path.relative(projectPath, fileName);
      }
      let indexOf = fileName.indexOf(".dart");
      if (indexOf != -1) {
        fileName = fileName.substring(0, indexOf) + "*.dart";
      }
      command += ` --build-filter='${fileName}'`;
    } else {
      command += " --delete-conflicting-outputs";
    }

    const terminal = vscode.window.createTerminal(EXTENSION_NAME);
    terminal.show();
    terminal.sendText(command);
  }

  /**
   * 生成.g.dart文件
   * @param isSigle 是否只生成当前选择的文件
   */
  private static showDpes() {
    let command = "flutter pub deps";
    const terminal = vscode.window.createTerminal(EXTENSION_NAME);
    terminal.show();
    terminal.sendText(command);
  }

  /**
   * 生成.g.dart文件
   * @param isSigle 是否只生成当前选择的文件
   */
  static genl10n() {
    // vscode.commands.executeCommand("flutter.task.genl10n");
    let command = "flutter gen-l10n";
    const terminal = vscode.window.createTerminal(EXTENSION_NAME);
    terminal.sendText(command);
  }
}
