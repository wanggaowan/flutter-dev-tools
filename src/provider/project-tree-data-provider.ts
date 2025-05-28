import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cons from "../constants.contexts";
import { closeFileEditor, disposeAll, isImage, openFile } from "../utils/utils";
import Logger from "../utils/logger";
import { FlutterSdk } from "../sdk";

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
  private openItems: FileTreeItem[] = [];

  constructor(private readonly sdk: FlutterSdk) {
    sdk.context.subscriptions.push(this);

    let disposable = vscode.commands.registerCommand(
      cons.COMMAND_PROJECT_VIEW_REFRESH,
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
      cons.COMMAND_PROJECT_VIEW_ADD_FILE,
      uri => this.createFileCommand(uri)
    );
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      cons.COMMAND_PROJECT_VIEW_ADD_FOLDER,
      uri => this.createFolderCommand(uri)
    );
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      cons.COMMAND_PROJECT_VIEW_RENAME,
      uri => this.renameCommand(uri)
    );
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      cons.COMMAND_PROJECT_VIEW_DELETE_FILE,
      uri => this.deleteFile(uri)
    );
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      cons.COMMAND_PROJECT_VIEW_LOCATION,
      uri => this.location()
    );
    this.disposableList.push(disposable);

    disposable = vscode.workspace.onDidCloseTextDocument(document => {
      this.openItems = this.openItems.filter(
        value => value.resourceUri != document.uri
      );
    });
    this.disposableList.push(disposable);

    disposable = vscode.commands.registerCommand(
      "_tapItem",
      (item: FileTreeItem) => {
        this.openItems.push(item);
        openFile(item.resourceUri);
      }
    );
    this.disposableList.push(disposable);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(sdk.workspace, "**"), // 监听整个工作区
      false, // 是否忽略创建事件
      false, // 是否忽略修改事件
      false // 是否忽略删除事件
    );
    this.disposableList.push(watcher);

    // 监听创建事件
    watcher.onDidCreate((uri: vscode.Uri) => this.refresh());
    // 监听修改事件
    watcher.onDidChange((uri: vscode.Uri) => this.refresh());
    // 监听删除事件
    watcher.onDidDelete((uri: vscode.Uri) => this.refresh());
  }

  getTreeItem(element: FileTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(
    element: FileTreeItem
  ): vscode.ProviderResult<FileTreeItem | undefined> {
    let parent = element.parent;
    if (parent) {
      return element.parent;
    }

    let pathStr = element.resourceUri?.fsPath;
    if (!pathStr) {
      return;
    }

    let indexOf = pathStr.lastIndexOf(path.sep);
    if (indexOf != -1) {
      pathStr = pathStr.substring(0, indexOf);
    }

    if (pathStr == this.sdk.workspace.fsPath) {
      return;
    }

    element.parent = new FileTreeItem(
      pathStr,
      path.basename(pathStr),
      vscode.TreeItemCollapsibleState.None
    );

    this.addOpenItem(element);
    return element.parent;
  }

  private async addOpenItem(element: FileTreeItem) {
    if (
      element.resourceUri?.path !=
      vscode.window.activeTextEditor?.document.uri.path
    ) {
      return;
    }

    let find = this.openItems.find(
      value => value.resourceUri?.path == element.path
    );

    if (find) {
      return;
    }
    this.openItems.push(element);
  }

  getChildren(element?: FileTreeItem): Thenable<FileTreeItem[]> {
    let rootPath: string | undefined;
    if (element) {
      rootPath = element.path;
    } else {
      rootPath = this.sdk.workspace.fsPath;
    }

    if (!rootPath) {
      return Promise.resolve([]);
    }

    let dirs: FileTreeItem[] = [];
    let files: FileTreeItem[] = [];
    fs.readdirSync(rootPath)
      .filter(value => {
        return this.fileCouldShow(
          rootPath,
          value,
          this.isDirectory(path.join(rootPath, value))
        );
      })
      .forEach(value => {
        let collapsibleState: vscode.TreeItemCollapsibleState;
        let pathStr = path.join(rootPath, value);
        if (this.isDirectory(pathStr)) {
          collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        } else {
          collapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        let dependency = new FileTreeItem(
          pathStr,
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
    this.openItems = [];
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

      let ignore =
        name == "android" ||
        name == "ios" ||
        name == "web" ||
        name == "macos" ||
        name == "windows" ||
        name == "linux" ||
        name == "unix" ||
        name == "ohos";
      if (ignore) {
        if (parent == this.sdk.workspace.fsPath || parent.endsWith("example")) {
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

    let find = treeView.selection.find(value => value == uri);
    const fileName = await vscode.window.showInputBox({
      placeHolder: "请输入文件名",
      prompt: "创建新文件",
      validateInput: value => {
        if (!value) return "文件名不能为空";
        if (value.includes("/") || value.includes("\\"))
          return "文件名不能包含路径分隔符";
        let pathStr = find?.path ?? this.sdk.workspace.fsPath;
        if (fs.existsSync(path.join(pathStr, value))) {
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

    let find = treeView.selection.find(value => value == uri);
    const fileName = await vscode.window.showInputBox({
      placeHolder: "请输入文件夹名",
      prompt: "创建新文件夹",
      validateInput: value => {
        if (!value) return "文件夹名不能为空";
        if (value.includes("/") || value.includes("\\"))
          return "文件夹名不能包含路径分隔符";
        let pathStr = find?.path ?? this.sdk.workspace.fsPath;
        if (fs.existsSync(path.join(pathStr, value))) {
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
    let pathStr: string;
    if (parent) {
      pathStr = parent.path;
    } else {
      pathStr = this.sdk.workspace.fsPath;
    }
    pathStr += path.sep + fileName;

    try {
      if (isFolder) {
        fs.mkdirSync(pathStr);
      } else {
        fs.writeFileSync(pathStr, "");
      }

      if (parent && this.treeView) {
        await this.treeView.reveal(parent, { expand: true });
      }
    } catch (e) {}
  }

  private async deleteFile(uri: FileTreeItem | undefined) {
    if (uri == undefined) {
      return;
    }
    try {
      if (uri.contextValue == cons.Folder_NODE_CONTEXT) {
        fs.rmSync(uri.path, { recursive: true });
      } else {
        fs.unlinkSync(uri.path);
      }
      closeFileEditor(uri.path);
    } catch (e) {}
  }

  private async renameCommand(uri?: FileTreeItem) {
    if (uri == undefined) {
      return;
    }

    let treeView = this.treeView;
    if (treeView == undefined) {
      Logger.showNotification("Flutter项目视图绑定失败", "error");
      return;
    }

    let find = treeView.selection.find(value => value == uri);
    const fileName = await vscode.window.showInputBox({
      placeHolder: "请输新的名称",
      value: uri.label,
      prompt: "重命名",
      validateInput: value => {
        if (!value) return "名称不能为空";
        if (value.includes("/") || value.includes("\\"))
          return "名称不能包含路径分隔符";
        let pathStr = find?.parent?.path ?? this.sdk.workspace.fsPath;
        if (fs.existsSync(path.join(pathStr, value))) {
          return uri.contextValue == cons.Folder_NODE_CONTEXT
            ? "已存在同名文件夹"
            : "已存在同名文件";
        }
        return null;
      },
    });

    if (!fileName) return;
    let parentPath = uri.parent?.path ?? this.sdk.workspace.fsPath;
    try {
      fs.renameSync(uri.path, path.join(parentPath, fileName));
      closeFileEditor(uri.path);
    } catch (e) {}
  }

  private async location() {
    let treeView = this.treeView;
    if (!treeView) {
      return;
    }

    let input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!input) {
      return;
    }

    let uri: vscode.Uri | undefined;
    if (input instanceof vscode.TabInputText) {
      uri = input.uri;
    } else if (input instanceof vscode.TabInputCustom) {
      uri = input.uri;
    }

    if (!uri) {
      return;
    }

    let find = this.openItems.find(
      value => value.resourceUri?.path == uri.path
    );
    if (find) {
      treeView.reveal(find, { select: true, expand: true });
    } else {
      let pathStr = uri.fsPath;
      let item = new FileTreeItem(
        pathStr,
        path.basename(pathStr),
        vscode.TreeItemCollapsibleState.Collapsed
      );
      treeView.reveal(item, { select: true, expand: true });
    }
  }
}

class FileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly path: string,
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public parent?: FileTreeItem
  ) {
    super(label, collapsibleState);
    this.resourceUri = vscode.Uri.file(this.path);
    if (this.isFile) {
      this.iconPath = vscode.ThemeIcon.File;
      this.contextValue = this.getFileContextValue(label);
      this.command = {
        arguments: [this],
        command: "_tapItem",
        title: "Open File",
      };
    } else {
      this.iconPath = vscode.ThemeIcon.Folder;
      this.contextValue = cons.Folder_NODE_CONTEXT;
    }
  }

  private getFileContextValue(fileName: string) {
    let name = fileName.toLowerCase();
    if (name.endsWith(".dart")) {
      return cons.File_DART_CONTEXT;
    } else if (name.endsWith(".arb")) {
      return cons.File_ARB_CONTEXT;
    } else if (name.endsWith(".yaml")) {
      return cons.File_YAML_CONTEXT;
    } else if (name.endsWith(".md")) {
      return cons.File_MARKDOWN_CONTEXT;
    } else if (name.endsWith(".txt")) {
      return cons.File_TXT_CONTEXT;
    } else if (name.endsWith(".html")) {
      return cons.File_HTML_CONTEXT;
    } else if (name.endsWith(".css")) {
      return cons.File_CSS_CONTEXT;
    } else if (name.endsWith(".js")) {
      return cons.File_JS_CONTEXT;
    } else if (name.endsWith(".ts")) {
      return cons.File_TS_CONTEXT;
    } else if (name.endsWith(".py")) {
      return cons.File_PYTHON_CONTEXT;
    } else if (isImage(name)) {
      return cons.File_IMAGE_CONTEXT;
    } else {
      return cons.File_OTHER_CONTEXT;
    }
  }

  get isFile(): boolean {
    return this.collapsibleState == vscode.TreeItemCollapsibleState.None;
  }
}
