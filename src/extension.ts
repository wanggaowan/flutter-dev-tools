// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import {
  COMMAND_EXPLORE_FILE_LOCATION,
  IMAGE_PREVIEW_VIEW_ID,
  IS_FLUTTER_PROJECT,
} from "./constants.contexts";
import { disposeAll } from "./utils/utils";
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
import { L10nFoldingProvider } from "./provider/l10n/l10n-code-lens-provider";
import { ImageDocHoverProvider } from "./provider/image-doc-hover-provider";
import { ExtractL10n } from "./command/translate/extract-l10n";
import { DeleteArbKeys } from "./command/translate/delete-arb-keys";
import { TranslateSelectionToArb } from "./command/translate/translate-selection-to-arb";
import { RouterDefinitionProvider } from "./provider/router-definition-provider";
import { ImportAndroidImages } from "./command/import-android-images";
import { DeleteImageWithVariants } from "./command/delete-image-variants";
import { RenameImageWithVariants } from "./command/rename-image-variants";
import { ImageAssetWatcher } from "./watcher/image-asset-watcher";
import { L10nArbWatcher } from "./watcher/l10n-arb-watcher";

let _sdk: FlutterSdk | undefined;
let _imageAssetWatcher: ImageAssetWatcher | undefined;
let _l10nArbWatcher: L10nArbWatcher | undefined;

export function getSdk(): FlutterSdk | undefined {
  return _sdk;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext,
  isRestart = false,
) {
  Logger.i(isRestart ? "插件重新激活" : "插件已激活");
  // 注册项目目录变更监听
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async f => {
      await deactivate(true);
      disposeAll(context.subscriptions);
      await activate(context, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPLORE_FILE_LOCATION, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      // 关闭其它目录
      // await vscode.commands.executeCommand(
      //   "workbench.files.action.collapseExplorerFolders"
      // );
      await vscode.commands.executeCommand(
        "workbench.files.action.showActiveFileInExplorer",
      );
    }),
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
    vscode.Uri.joinPath(rootPath, "pubspec.yaml").fsPath,
  );

  if (!exist) {
    return;
  }

  _sdk = new FlutterSdk(context, rootPath);
  setContext(IS_FLUTTER_PROJECT, true);
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

  disposable = new DeleteArbKeys();
  context.subscriptions.push(disposable);

  disposable = new TranslateSelectionToArb();
  context.subscriptions.push(disposable);

  disposable = new L10nDefinitionProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new L10nReferenceProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new L10nFoldingProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new ImageDocHoverProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new RouterDefinitionProvider(_sdk);
  context.subscriptions.push(disposable);

  disposable = new ImportAndroidImages(_sdk);
  context.subscriptions.push(disposable);

  disposable = new DeleteImageWithVariants(_sdk);
  context.subscriptions.push(disposable);

  disposable = new RenameImageWithVariants(_sdk);
  context.subscriptions.push(disposable);

  // 启动图片资源目录监听器
  _imageAssetWatcher = new ImageAssetWatcher(_sdk);
  context.subscriptions.push(_imageAssetWatcher);

  // 启动 l10n arb 文件监听器
  _l10nArbWatcher = new L10nArbWatcher(_sdk);
  context.subscriptions.push(_l10nArbWatcher);
}

export async function deactivate(isRestart = false) {
  try {
    Logger.i(isRestart ? "插件重启前停用" : "插件已停用");
    if (_imageAssetWatcher) {
      _imageAssetWatcher.dispose();
      _imageAssetWatcher = undefined;
    }
    if (_l10nArbWatcher) {
      _l10nArbWatcher.dispose();
      _l10nArbWatcher = undefined;
    }
    if (_sdk) {
      _sdk.deactivate();
      _sdk = undefined;
    }
    setContext(IS_FLUTTER_PROJECT, false);
  } catch (error) {
    // 忽略取消错误，避免在停用时抛出 Canceled 异常
    if (error instanceof Error && error.name !== "Canceled") {
      console.error("Deactivation error:", error);
    }
  }
}

// 注册图片预览视图
function registerImagePreviewView(sdk: FlutterSdk) {
  // const rootPath =
  //   vscode.workspace.workspaceFolders &&
  //   vscode.workspace.workspaceFolders.length > 0
  //     ? vscode.workspace.workspaceFolders[0].uri
  //     : undefined;
  let provider = new ImagePreviewProvider(sdk);
  let treeView = vscode.window.registerWebviewViewProvider(
    IMAGE_PREVIEW_VIEW_ID,
    provider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    },
  );
  sdk.context.subscriptions.push(treeView);
}
