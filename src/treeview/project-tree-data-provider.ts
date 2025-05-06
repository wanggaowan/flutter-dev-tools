import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  COMMAND_OPEN_FILE,
  COMMAND_PROJECT_VIEW_ADD_FILE,
  COMMAND_PROJECT_VIEW_ADD_FOLDER,
  COMMAND_PROJECT_VIEW_DELETE_FILE,
  COMMAND_PROJECT_VIEW_REFRESH,
  File_NODE_CONTEXT,
  Folder_NODE_CONTEXT,
} from "../constants.contexts";
import { disposeAll } from "../utils/utils";
import Logger from "../utils/logger";

/**
 * Flutter专属的项目视图
 */
export class FlutterProjectProvider
  implements vscode.TreeDataProvider<FileTreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    FileTreeItem | undefined | null | void
  > = new vscode.EventEmitter<FileTreeItem | undefined | null | void>();
  private isRefresh = false;
  private disposableList: vscode.Disposable[] = [];
  private treeView: vscode.TreeView<FileTreeItem | undefined> | undefined =
    undefined;

  constructor(private workspaceRoot: string) {
    let disposable = vscode.commands.registerCommand(
      COMMAND_PROJECT_VIEW_REFRESH,
      () => {
        if (this.isRefresh) {
          return;
        }

        this.isRefresh = true;
        setTimeout(() => (this.isRefresh = false), 2000);
        this.refresh();
      }
    );
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      COMMAND_PROJECT_VIEW_ADD_FILE,
      (uri) => this.createFileCommand(uri)
    );
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      COMMAND_PROJECT_VIEW_ADD_FOLDER,
      (uri) => this.createFolderCommand(uri)
    );
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      COMMAND_PROJECT_VIEW_DELETE_FILE,
      (uri) => this.deleteFile(uri)
    );
    this.disposableList.push(disposable);
  }

  getTreeItem(element: FileTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(
    element: FileTreeItem
  ): vscode.ProviderResult<FileTreeItem | undefined> {
    return element.parent;
  }

  getChildren(element?: FileTreeItem): Thenable<FileTreeItem[]> {
    let rootPath: string | undefined;
    if (element) {
      rootPath = element.path;
    } else {
      rootPath = this.workspaceRoot;
    }

    if (!rootPath) {
      return Promise.resolve([]);
    }

    let dirs: FileTreeItem[] = [];
    let files: FileTreeItem[] = [];
    fs.readdirSync(rootPath)
      .filter((value) => {
        return this.fileCouldShow(
          rootPath,
          value,
          this.isDirectory(rootPath + "/" + value)
        );
      })
      .forEach((value) => {
        let collapsibleState: vscode.TreeItemCollapsibleState;
        let path = rootPath + "/" + value;
        if (this.isDirectory(path)) {
          collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        } else {
          collapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        let dependency = new FileTreeItem(
          path,
          value,
          collapsibleState,
          element
        );

        if (!dependency.isFile) {
          dirs.push(dependency);
        } else {
          files.push(dependency);
        }
      });
    return Promise.resolve([...dirs, ...files]);
  }

  readonly onDidChangeTreeData: vscode.Event<
    FileTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  dispose() {
    this.treeView = undefined;
    disposeAll(this.disposableList);
  }

  bindTreeView(treeView: vscode.TreeView<FileTreeItem | undefined>) {
    this.treeView = treeView;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private isDirectory(path: string): boolean {
    try {
      const stats = fs.statSync(path);
      return stats.isDirectory();
    } catch (error) {
      // 处理错误
      return false;
    }
  }

  /**
   * 判断文件是否需要展示
   */
  private fileCouldShow(
    parent: string,
    name: string,
    isDirectory: boolean
  ): boolean {
    if (
      name.endsWith(".lock") ||
      name.endsWith(".log") ||
      name.endsWith(".iml") ||
      name.startsWith(".") ||
      name.startsWith("_")
    ) {
      return false;
    }

    if (isDirectory) {
      if (name == "build") {
        return false;
      }

      if (
        name == "android" ||
        name == "ios" ||
        name == "web" ||
        name == "macos" ||
        name == "windows" ||
        name == "linux" ||
        name == "unix" ||
        name == "ohos"
      ) {
        if (parent == this.workspaceRoot || parent.endsWith("example")) {
          return false;
        }
      }
    }

    if (name == "") {
      return false;
    }
    return true;
  }

  private async createFileCommand(uri?: FileTreeItem) {
    let treeView = this.treeView;
    if (treeView == undefined) {
      Logger.showNotification("Flutter项目视图绑定失败", "error");
      return;
    }

    if (uri && uri.isFile) {
      uri = uri.parent;
    }

    let find = treeView.selection.find((value) => value == uri);
    const fileName = await vscode.window.showInputBox({
      placeHolder: "请输入文件名",
      prompt: "创建新文件",
      validateInput: (value) => {
        if (!value) return "文件名不能为空";
        if (value.includes("/") || value.includes("\\"))
          return "文件名不能包含路径分隔符";
        let path = find?.path ?? this.workspaceRoot;
        if (fs.existsSync(path + "/" + value)) {
          return "已存在同名文件";
        }
        return null;
      },
    });

    if (!fileName) return;
    this.createFile(fileName, find, false);
  }

  private async createFolderCommand(uri?: FileTreeItem) {
    let treeView = this.treeView;
    if (treeView == undefined) {
      Logger.showNotification("Flutter项目视图绑定失败", "error");
      return;
    }

    if (uri && uri.isFile) {
      uri = uri.parent;
    }

    let find = treeView.selection.find((value) => value == uri);
    const fileName = await vscode.window.showInputBox({
      placeHolder: "请输入文件夹名",
      prompt: "创建新文件夹",
      validateInput: (value) => {
        if (!value) return "文件夹名不能为空";
        if (value.includes("/") || value.includes("\\"))
          return "文件夹名不能包含路径分隔符";
        let path = find?.path ?? this.workspaceRoot;
        if (fs.existsSync(path + "/" + value)) {
          return "已存在同名文件夹";
        }
        return null;
      },
    });

    if (!fileName) return;
    this.createFile(fileName, find, true);
  }

  private async createFile(
    fileName: string,
    parent: FileTreeItem | undefined,
    isFolder: boolean
  ) {
    let path: string;
    if (parent) {
      path = parent.path;
    } else {
      path = this.workspaceRoot;
    }
    path += "/" + fileName;

    try {
      if (isFolder) {
        fs.mkdirSync(path);
      } else {
        fs.writeFileSync(path, "");
      }

      if (parent && this.treeView) {
        await this.treeView.reveal(parent, { expand: true });
      }
      this.refresh();
    } catch (e) {}
  }

  private async deleteFile(uri: FileTreeItem | undefined) {
    if (uri == undefined) {
      return;
    }
    try {
      if (uri.contextValue == Folder_NODE_CONTEXT) {
        fs.rmSync(uri.path, { recursive: true });
      } else {
        fs.unlinkSync(uri.path);
      }
      this.refresh();
    } catch (e) {}
  }
}

class FileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly path: string,
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly parent?: FileTreeItem
  ) {
    super(label, collapsibleState);
    this.resourceUri = vscode.Uri.file(this.path);
    if (this.isFile) {
      this.iconPath = vscode.ThemeIcon.File;
      this.contextValue = File_NODE_CONTEXT;
      this.command = {
        arguments: [this.resourceUri],
        command: COMMAND_OPEN_FILE,
        title: "Open File",
      };
    } else {
      this.iconPath = vscode.ThemeIcon.Folder;
      this.contextValue = Folder_NODE_CONTEXT;
    }
  }

  get isFile(): boolean {
    return this.collapsibleState == vscode.TreeItemCollapsibleState.None;
  }
}
