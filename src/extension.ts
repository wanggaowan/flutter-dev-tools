// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import { FlutterProjectProvider } from "./views/project-tree-data-provider";
import {
  COMMAND_OPEN_FILE,
  IMAGE_PREVIEW_VIEW_ID,
  IS_FLUTTER_PROJECT,
  PROJECT_TREE_VIEW_ID,
} from "./constants.contexts";
import { disposeAll, openFile } from "./utils/utils";
import Logger from "./utils/logger";
import { ImagePreviewProvider } from "./views/image-preview-provider";
import { FlutterSdk } from "./sdk";
import { json } from "stream/consumers";
import { JsonToDart } from "./command/json-to-dart";
import { ClassGen } from "./command/class-gen";
import { setContext } from "./utils/build-in-command-utils";

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
  let disposable = vscode.commands.registerCommand(COMMAND_OPEN_FILE, openFile);
  context.subscriptions.push(disposable);

  disposable = new JsonToDart();
  context.subscriptions.push(disposable);

  disposable = new ClassGen();
  context.subscriptions.push(disposable);
}

export async function deactivate(isRestart = false) {
  Logger.i(isRestart ? "插件重启前停用" : "插件已停用");
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
