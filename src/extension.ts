// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import { FlutterProjectProvider } from "./views/project-tree-data-provider";
import OpenFileUtils from "./utils/open-file-utils";
import {
  COMMAND_OPEN_FILE,
  IMAGE_PREVIEW_VIEW_ID,
  PROJECT_TREE_VIEW_ENABLE_CONTEXT,
  PROJECT_TREE_VIEW_ID,
} from "./constants.contexts";
import { disposeAll } from "./utils/utils";
import Logger from "./utils/logger";
import { ImagePreviewProvider } from "./views/image-preview/image-preview-provider";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext,
  isRestart = false
) {
  Logger.i(isRestart ? "插件重新激活" : "插件已激活");
  let disposable = vscode.commands.registerCommand(
    COMMAND_OPEN_FILE,
    (filePath: any) => OpenFileUtils.open(filePath)
  );
  context.subscriptions.push(disposable);
  registerFlutterPorjectView(context);
  registerImagePreviewView(context);

  // 注册项目目录变更监听
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (f) => {
      await deactivate(true);
      disposeAll(context.subscriptions);
      await activate(context, true);
    })
  );
}

export async function deactivate(isRestart = false) {
  Logger.i(isRestart ? "插件重启前停用" : "插件已停用");
  void vscode.commands.executeCommand(
    "setContext",
    PROJECT_TREE_VIEW_ENABLE_CONTEXT,
    false
  );
}

// 注册flutter专属项目视图
function registerFlutterPorjectView(context: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;
  if (rootPath) {
    let exist = fs.existsSync(rootPath + "/" + "pubspec.yaml");
    if (exist) {
      void vscode.commands.executeCommand(
        "setContext",
        PROJECT_TREE_VIEW_ENABLE_CONTEXT,
        true
      );

      let provider = new FlutterProjectProvider(rootPath);
      context.subscriptions.push(provider);
      let treeView = vscode.window.createTreeView(PROJECT_TREE_VIEW_ID, {
        treeDataProvider: provider,
      });
      provider.bindTreeView(treeView);
      provider.refresh();
      context.subscriptions.push(treeView);
    }
  }
}

// 注册图片预览视图
function registerImagePreviewView(context: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri
      : undefined;
  let provider = new ImagePreviewProvider(rootPath, context.extensionUri);
  context.subscriptions.push(provider);
  let treeView = vscode.window.registerWebviewViewProvider(
    IMAGE_PREVIEW_VIEW_ID,
    provider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  );
  context.subscriptions.push(treeView);
}
