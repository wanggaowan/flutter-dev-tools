import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { COMMAND_CREATE_FILE_TEMPLATE } from "../../constants.contexts";
import { FlutterSdk } from "../../sdk";
import { FileTemplateUtils, TemplateEntity } from "./file-template-utils";
import Logger from "../../utils/logger";
import { disposeAll } from "../../utils/utils";

function isDarkTheme(theme: vscode.ColorTheme): boolean {
  return (
    theme.kind !== vscode.ColorThemeKind.Light &&
    theme.kind !== vscode.ColorThemeKind.HighContrastLight
  );
}

/**
 * 创建模板文件
 */
export class CreateFileTemplate implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];

  constructor(private readonly sdk: FlutterSdk) {
    FileTemplateUtils.initDefaultTemplate(sdk.context);
    this.disposableList.push(
      vscode.commands.registerCommand(
        COMMAND_CREATE_FILE_TEMPLATE,
        (uri?: vscode.Uri) => this.openPanel(uri),
      ),
    );
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  private openPanel(uri?: vscode.Uri) {
    const targetDir = this.resolveTargetDir(uri);
    const templates = FileTemplateUtils.getTemplateList(this.sdk.context);

    const panel = vscode.window.createWebviewPanel(
      "flutterDevTools.fileTemplate",
      "创建模板文件",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.sdk.context.extensionUri],
      },
    );

    const listeners: vscode.Disposable[] = [];
    listeners.push(
      panel.webview.onDidReceiveMessage(message => {
        void this.handleMessage(panel, targetDir, message);
      }),
    );
    listeners.push(
      vscode.window.onDidChangeActiveColorTheme(theme => {
        void panel.webview.postMessage({
          type: "changeTheme",
          isDarkTheme: isDarkTheme(theme),
        });
      }),
    );
    listeners.push(panel.onDidDispose(() => disposeAll(listeners)));

    panel.webview.html = this.getHtml(panel.webview, templates, targetDir);
  }

  private async handleMessage(
    panel: vscode.WebviewPanel,
    targetDir: vscode.Uri,
    message: any,
  ) {
    switch (message?.type) {
      case "save":
        FileTemplateUtils.saveTemplateList(this.sdk.context, message.templates);
        break;
      case "create":
        await this.createFiles(panel, targetDir, message);
        break;
      case "import":
        await this.importTemplates(panel);
        break;
      case "export":
        await this.exportTemplates(
          message.templates,
          message.fileName ?? "template.json",
          targetDir,
        );
        break;
      case "cancel":
        panel.dispose();
        break;
    }
  }

  private async createFiles(
    panel: vscode.WebviewPanel,
    targetDir: vscode.Uri,
    message: any,
  ) {
    const templates = Array.isArray(message.templates)
      ? (message.templates as TemplateEntity[])
      : [];
    FileTemplateUtils.saveTemplateList(this.sdk.context, templates);

    const template = templates[message.index as number];
    if (!template) {
      return;
    }

    try {
      const created = FileTemplateUtils.createFiles(
        targetDir.fsPath,
        template,
        message.placeholders ?? {},
        message.createCopy === true,
      );

      panel.dispose();
      const displayPath = this.toDisplayPath(
        template.createFolder
          ? vscode.Uri.file(path.join(targetDir.fsPath, template.name))
          : targetDir,
      );
      void vscode.window.showInformationMessage(
        created.length > 0
          ? `已在 ${displayPath} 创建 ${created.length} 个文件`
          : `已创建目录 ${displayPath}`,
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      Logger.e("创建模板文件失败", e);
      void panel.webview.postMessage({ type: "createFailed" });
      void vscode.window.showErrorMessage(`创建文件失败：${error}`);
    }
  }

  private async importTemplates(panel: vscode.WebviewPanel) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "导入",
      filters: { "JSON 模板": ["json"] },
    });

    if (!uris || uris.length === 0) {
      return;
    }

    const imported: TemplateEntity[] = [];
    for (const uri of uris) {
      try {
        const content = fs.readFileSync(uri.fsPath, "utf-8");
        const value = JSON.parse(content);
        const list = FileTemplateUtils.sanitizeTemplates(
          Array.isArray(value) ? value : [value],
        );
        if (list.length === 0) {
          void vscode.window.showWarningMessage(
            `文件 ${path.basename(uri.fsPath)} 不是有效的模板`,
          );
          continue;
        }
        imported.push(...list);
      } catch (e) {
        Logger.e(`导入模板失败: ${uri.fsPath}`, e);
        void vscode.window.showErrorMessage(
          `导入模板失败：${path.basename(uri.fsPath)}`,
        );
      }
    }

    if (imported.length > 0) {
      void panel.webview.postMessage({
        type: "imported",
        templates: imported,
      });
    }
  }

  private async exportTemplates(
    templates: unknown,
    fileName: string,
    targetDir: vscode.Uri,
  ) {
    const list = FileTemplateUtils.sanitizeTemplates(templates);
    if (list.length === 0) {
      void vscode.window.showWarningMessage("没有可导出的模板");
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(targetDir, fileName),
      filters: { "JSON 模板": ["json"] },
      saveLabel: "导出",
    });

    if (!uri) {
      return;
    }

    try {
      fs.writeFileSync(uri.fsPath, JSON.stringify(list, null, 2), "utf-8");
      void vscode.window.showInformationMessage(`已导出到：${uri.fsPath}`);
    } catch (e) {
      Logger.e(`导出模板失败: ${uri.fsPath}`, e);
      void vscode.window.showErrorMessage("导出失败");
    }
  }

  /**
   * 确定创建文件的目标目录，优先使用右键选中的目录，选中文件时使用其所在目录
   */
  private resolveTargetDir(uri?: vscode.Uri): vscode.Uri {
    let target = uri;
    if (!target) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.scheme === "file") {
        target = editor.document.uri;
      }
    }

    if (!target) {
      return this.sdk.workspace;
    }

    try {
      if (fs.statSync(target.fsPath).isDirectory()) {
        return target;
      }
    } catch {
      // 路径不存在时按文件路径处理
    }

    return vscode.Uri.file(path.dirname(target.fsPath));
  }

  private toDisplayPath(uri: vscode.Uri): string {
    const root = this.sdk.workspace.fsPath;
    if (uri.fsPath === root) {
      return ".";
    }
    if (uri.fsPath.startsWith(root + path.sep)) {
      return path.relative(root, uri.fsPath);
    }
    return uri.fsPath;
  }

  private getHtml(
    webview: vscode.Webview,
    templates: TemplateEntity[],
    targetDir: vscode.Uri,
  ): string {
    const mediaRoot = vscode.Uri.joinPath(
      this.sdk.context.extensionUri,
      "media",
      "file-template",
    );
    const nonce = this.getNonce();
    const initData = JSON.stringify({
      templates: templates,
      targetDir: this.toDisplayPath(targetDir),
      isDarkTheme: isDarkTheme(vscode.window.activeColorTheme),
    }).replace(/</g, "\\u003c");

    return fs
      .readFileSync(
        vscode.Uri.joinPath(mediaRoot, "index.html").fsPath,
        "utf-8",
      )
      .replaceAll("{{cspSource}}", () => webview.cspSource)
      .replaceAll("{{styleUri}}", () =>
        webview
          .asWebviewUri(vscode.Uri.joinPath(mediaRoot, "styles.css"))
          .toString(),
      )
      .replaceAll("{{scriptUri}}", () =>
        webview
          .asWebviewUri(vscode.Uri.joinPath(mediaRoot, "script.js"))
          .toString(),
      )
      .replaceAll("{{nonce}}", () => nonce)
      .replace(
        "<!--INIT_DATA-->",
        () =>
          `<script id="init-data" type="application/json" nonce="${nonce}">${initData}</script>`,
      );
  }

  private getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
