// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import { FlutterProjectProvider } from "./provider/project-tree-data-provider";
import {
  COMMAND_EXPLORE_FILE_LOCATION,
  IMAGE_PREVIEW_VIEW_ID,
  IS_FLUTTER_PROJECT,
  PROJECT_TREE_VIEW_ID,
} from "./constants.contexts";
import { disposeAll} from "./utils/utils";
import Logger from "./utils/logger";
import { ImagePreviewProvider } from "./views/image-preview-provider";
import { FlutterSdk } from "./sdk";
import { JsonToDart } from "./command/json-to-dart";
import { ClassGen } from "./command/class-gen";
import { setContext } from "./utils/build-in-command-utils";
import { TerminalCommand } from "./command/terminal-command";
import { TranslateArb } from "./command/translate/translate-arb";
import { L10nDefinitionProvider } from "./provider/l10n/l10n-definition-provider";
import { L10nReferenceProvider } from "./provider/l10n/l10n-refrence-provider";
import { ImageDocHoverProvider } from "./provider/image-doc-hover-provider";
import { ExtractL10n } from "./command/translate/extract-l10n";
import { RouterDefinitionProvider } from "./provider/router-definition-provider";

let _sdk: FlutterSdk | undefined;

export function getSdk(): FlutterSdk | undefined {
  return _sdk;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext,
  isRestart = false
) {
  Logger.i(isRestart ? "插件重新激活" : "插件已激活");
  // 注册项目目录变更监听
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async f => {
      await deactivate(true);
      disposeAll(context.subscriptions);
      await activate(context, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPLORE_FILE_LOCATION, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      // 关闭其它目录
      // await vscode.commands.executeCommand(
      //   "workbench.files.action.collapseExplorerFolders"
      // );
      await vscode.commands.executeCommand(
        "workbench.files.action.showActiveFileInExplorer"
      );
    })
  );

  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri
      : undefined;

  if (!rootPath) {
    return;
  }

  let exist = fs.existsSync(
    vscode.Uri.joinPath(rootPath, "pubspec.yaml").fsPath
  );

  if (!exist) {
    return;
  }

  let example: vscode.Uri | undefined;
  let exapmlePath = vscode.Uri.joinPath(rootPath, "example", "pubspec.yaml");
  if (fs.existsSync(exapmlePath.fsPath)) {
    example = vscode.Uri.joinPath(rootPath, "example");
  }
  _sdk = new FlutterSdk(context, rootPath, example);
  setContext(IS_FLUTTER_PROJECT, true);
  registerFlutterPorjectView(_sdk);
  registerImagePreviewView(_sdk);

  // 注册命令
  let disposable: vscode.Disposable = new JsonToDart();
  context.subscriptions.push(disposable);

  disposable = new ClassGen();
  context.subscriptions.push(disposable);

  disposable = new TerminalCommand();
  context.subscriptions.push(disposable);

  disposable = new TranslateArb();
  context.subscriptions.push(disposable);

  disposable = new ExtractL10n();
  context.subscriptions.push(disposable);

  disposable = new L10nDefinitionProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new L10nReferenceProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new ImageDocHoverProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new RouterDefinitionProvider(_sdk);
  context.subscriptions.push(disposable);
}

export async function deactivate(isRestart = false) {
  Logger.i(isRestart ? "插件重启前停用" : "插件已停用");
  _sdk?.deactivate();
  _sdk = undefined;
  setContext(IS_FLUTTER_PROJECT, false);
}

// 注册flutter专属项目视图
function registerFlutterPorjectView(sdk: FlutterSdk) {
  let provider = new FlutterProjectProvider(sdk);
  let treeView = vscode.window.createTreeView(PROJECT_TREE_VIEW_ID, {
    treeDataProvider: provider,
  });
  provider.bindTreeView(treeView);
  sdk.context.subscriptions.push(treeView);
}

// 注册图片预览视图
function registerImagePreviewView(sdk: FlutterSdk) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri
      : undefined;
  let provider = new ImagePreviewProvider(sdk);
  let treeView = vscode.window.registerWebviewViewProvider(
    IMAGE_PREVIEW_VIEW_ID,
    provider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  );
  sdk.context.subscriptions.push(treeView);
}
