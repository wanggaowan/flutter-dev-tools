import { url } from "inspector";
import * as vscode from "vscode";
import * as fs from "fs";
import { disposeAll } from "../../utils/utils";
import path from "path";
import OpenFileUtils from "../../utils/open-file-utils";

export class ImagePreviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private _extensionUri: vscode.Uri;
  private disposableList: vscode.Disposable[] = [];
  private webview?: vscode.Webview;
  private imageDir?: string;

  constructor(
    private workspaceRoot: vscode.Uri | undefined,
    extensionUri: vscode.Uri
  ) {
    this._extensionUri = extensionUri;
    if (this.workspaceRoot) {
      this.imageDir = this.workspaceRoot.path + "/assets/images";
    }
    const onThemeChange = vscode.window.onDidChangeActiveColorTheme((theme) => {
      if (this.webview) {
        let isDark = this.isDarkTheme;
        this.webview.postMessage({
          type: "changeTheme",
          isDarkTheme: isDark,
          refreshBtnUri: this.getRefreshBtnUri(this.webview, isDark).toString(),
          listBtnUri: this.getListBtnUri(this.webview, isDark).toString(),
          gridBtnUri: this.getGridBtnUri(this.webview, isDark).toString(),
        });
      }
    });
    this.disposableList.push(onThemeChange);
  }

  dispose() {
    this.webview = undefined;
    disposeAll(this.disposableList);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): Thenable<void> | void {
    this.webview = webviewView.webview;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: this.workspaceRoot
        ? [this._extensionUri, this.workspaceRoot]
        : [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "refresh":
            this.refresh();
            break;
          case "changeDir":
            this.changeDir();
            break;
          case "preview":
            this.preview(message.url);
            break;
        }
      },
      null,
      this.disposableList
    );

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    webviewView.webview.postMessage({
      type: "init_data",
      data: {
        isDarkTheme: this.isDarkTheme,
        path: this.getImageRelPath(),
      },
    });
    this.refresh();
  }

  private update(webview: vscode.Webview, imagesDir?: string) {
    if (
      imagesDir &&
      this.workspaceRoot &&
      !imagesDir.startsWith(this.workspaceRoot.path)
    ) {
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          this._extensionUri,
          this.workspaceRoot,
          vscode.Uri.file(imagesDir),
        ],
      };
    }
    // webview.html = this._getHtmlForWebview(webview);
  }

  private get isDarkTheme() {
    let kind = vscode.window.activeColorTheme.kind;
    return (
      kind == vscode.ColorThemeKind.Dark ||
      kind == vscode.ColorThemeKind.HighContrast
    );
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "src",
        "views",
        "image-preview",
        "script.js"
      )
    );

    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "src",
        "views",
        "image-preview",
        "styles.css"
      )
    );

    let isDark = this.isDarkTheme;
    const listBtnUri = this.getListBtnUri(webview, isDark);
    const gridBtnUri = this.getGridBtnUri(webview, isDark);
    const refreshBtnUri = this.getRefreshBtnUri(webview, isDark);

    // Use a nonce to only allow specific scripts to be run
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>图片预览</title>
                <link rel="stylesheet" href="${styleResetUri}">
            </head>
            <body>
                <div class="container">
                    <div class="view-controls">
                        <input type="text" class="search-input" id="search-input" placeholder="搜索图片..."/>
                        <img class="view-btn active" data-view="list" src="${listBtnUri}"/>
                        <img class="view-btn" data-view="grid" src="${gridBtnUri}"/>
                    </div>

                    <div class="directory-selector">
                        <button id="select-dir-btn" class="select-dir-btn">change</button>
                        <div class="directory-path" id="current-path"></div>
                        <img id="refresh-btn" class="refresh-btn" src="${refreshBtnUri}"/>
                    </div>

                    <div class="loading" id="loading">加载中...</div>
                    <div class="no-images" id="no-images" style="display: none;">该目录下没有图片</div>

                    <div class="list-view active" id="list-view"></div>
                    <div class="grid-view" id="grid-view"></div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
  }

  private getGridBtnUri(webview: vscode.Webview, isDarkTheme: boolean) {
    return webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        isDarkTheme ? "ic_grid_dark.svg" : "ic_grid.svg"
      )
    );
  }

  private getListBtnUri(webview: vscode.Webview, isDarkTheme: boolean) {
    return webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        isDarkTheme ? "ic_list_dark.svg" : "ic_list.svg"
      )
    );
  }

  private getRefreshBtnUri(webview: vscode.Webview, isDarkTheme: boolean) {
    return webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        isDarkTheme ? "ic_refresh_dark.svg" : "ic_refresh.svg"
      )
    );
  }

  private getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  // 获取当前预览图片目录的相对路径
  private getImageRelPath(): string {
    if (this.imageDir && this.workspaceRoot) {
      let path = this.workspaceRoot.path;
      if (this.imageDir.startsWith(path)) {
        let relPath = this.imageDir.substring(path.length);
        if (relPath.startsWith("/") || relPath.startsWith("\\")) {
          relPath = relPath.substring(1);
        }
        return relPath;
      }
    }
    return "";
  }

  private refresh() {}

  private async changeDir() {
    let defaultUri: vscode.Uri | undefined;
    if (this.imageDir) {
      defaultUri = vscode.Uri.file(this.imageDir);
    } else if (this.workspaceRoot) {
      defaultUri = this.workspaceRoot;
    }

    let uris = await vscode.window.showOpenDialog({
      defaultUri: defaultUri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });

    if (uris == undefined || uris.length == 0) {
      return;
    }
    if (this.webview) {
      this.imageDir = uris[0].path;
      this.update(this.webview, this.imageDir);
      this.refresh();
    }
  }

  private preview(path: string) {
    OpenFileUtils.open(path);
  }
}

type ImageData = {
  name: string;
  showPath: string;
  path: string;
};
