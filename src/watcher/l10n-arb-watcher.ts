import * as vscode from "vscode";
import * as fs from "fs";
import * as yaml from "yaml";
import * as path from "path";
import Logger from "../utils/logger";
import { TerminalCommand } from "../command/terminal-command";
import { FlutterSdk } from "../sdk";

/**
 * 监听 l10n.yaml 中指定的 template-arb-file 对应的 arb 文件变化，
 * 并在文件保存后自动执行 flutter.task.genl10n 命令
 */
export class L10nArbWatcher implements vscode.Disposable {
  private sdk: FlutterSdk;
  private l10nArbWatchers: L10nArbWatcherWrapper[] = [];

  constructor(sdk: FlutterSdk) {
    this.sdk = sdk;
    this.setupWatcher();
  }

  /**
   * 设置文件监听器
   */
  private setupWatcher(): void {
    this.l10nArbWatchers.push(new L10nArbWatcherWrapper(this.sdk.workspace));
    this.sdk.modules.forEach(item => {
      this.l10nArbWatchers.push(new L10nArbWatcherWrapper(item.workspace));
    });
  }

  dispose(): void {
    this.l10nArbWatchers.forEach(item => {
      item.dispose();
    });
    this.l10nArbWatchers = [];
    Logger.d("l10n arb 文件监听器已停止");
  }
}

class L10nArbWatcherWrapper implements vscode.Disposable {
  private workspaceRoot: vscode.Uri;
  private _tag: string;

  private arbFileWatcher: vscode.FileSystemWatcher | undefined;
  private configWatcher: vscode.FileSystemWatcher | undefined;
  private templateArbPath: string | undefined;

  constructor(workspace: vscode.Uri) {
    this.workspaceRoot = workspace;
    this._tag = path.basename(this.workspaceRoot.fsPath);
    this.setupWatcher();
  }

  /**
   * 设置文件监听器
   */
  private setupWatcher(): void {
    // 先监听 l10n.yaml 的变化
    this.setupConfigWatcher();

    // 再监听 arb 文件的变化
    this.setupArbFileWatcher();
  }

  /**
   * 设置 l10n.yaml 配置文件的监听器
   */
  private setupConfigWatcher(): void {
    const l10nYamlPath = path.join(this.workspaceRoot.fsPath, "l10n.yaml");
    if (!fs.existsSync(l10nYamlPath)) {
      Logger.d(`${this._tag}未找到 l10n.yaml 文件，跳过配置文件监听器设置`);
      return;
    }

    const pattern = new vscode.RelativePattern(this.workspaceRoot, "l10n.yaml");

    this.configWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // 监听 l10n.yaml 的变化
    this.configWatcher.onDidChange(async uri => {
      await this.handleConfigChanged(uri);
    });

    Logger.d(`已启动${this._tag} l10n.yaml 配置文件监听器`);
  }

  /**
   * 设置 arb 文件的监听器
   */
  private setupArbFileWatcher(): void {
    const templateArbFile = this.getTemplateArbFilePath();
    if (!templateArbFile) {
      Logger.d(
        `${this._tag}: 未找到有效的 template-arb-file 配置，跳过 l10n arb 监听器设置`,
      );
      return;
    }

    this.templateArbPath = templateArbFile;

    // 监听文件系统变化（包括编辑器保存、fs.writeFileSync 等所有写入操作）
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      path.relative(this.workspaceRoot.fsPath, templateArbFile),
    );

    this.arbFileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // 监听文件变化
    this.arbFileWatcher.onDidChange(uri => {
      this.handleFileChanged(uri);
    });

    Logger.d(
      `${this._tag}: 已启动 l10n arb 文件监听器: ${path.relative(this.workspaceRoot.fsPath, templateArbFile)}`,
    );
  }

  /**
   * 从 l10n.yaml 读取 template-arb-file 的完整路径
   */
  private getTemplateArbFilePath(): string | undefined {
    try {
      const l10nYamlPath = path.join(this.workspaceRoot.fsPath, "l10n.yaml");
      if (!fs.existsSync(l10nYamlPath)) {
        return undefined;
      }

      const content = fs.readFileSync(l10nYamlPath, "utf-8");
      const config = yaml.parse(content);

      let rootDirPath = this.workspaceRoot.fsPath;
      let resDirPath = config["arb-dir"] || "lib/l10n";
      let resName = config["template-arb-file"] || "app_en.arb";

      const projectDir = config["project-dir"];
      if (
        typeof projectDir === "string" &&
        projectDir &&
        projectDir.length > 0
      ) {
        rootDirPath = projectDir;
      }

      const arbFilePath = path.join(rootDirPath, resDirPath, resName);
      if (!fs.existsSync(arbFilePath)) {
        Logger.d(`template-arb-file 不存在: ${arbFilePath}`);
        return undefined;
      }

      return arbFilePath;
    } catch (e) {
      Logger.e(`${this._tag}: 读取 l10n.yaml 失败`, e);
      return undefined;
    }
  }

  /**
   * 处理 l10n.yaml 配置文件变化事件
   */
  private async handleConfigChanged(uri: vscode.Uri): Promise<void> {
    try {
      Logger.d(`${this._tag}: 检测到 l10n.yaml 配置文件变化，重新初始化监听器`);
      // 重新初始化监听器（会先 dispose 再 setup）
      await this.reinitialize();
    } catch (e) {
      Logger.e(`${this._tag}: 处理 l10n.yaml 配置文件变化失败`, e);
    }
  }

  /**
   * 处理 arb 文件变化事件
   */
  private async handleFileChanged(uri: vscode.Uri): Promise<void> {
    try {
      // 确保是目标文件
      if (uri.fsPath !== this.templateArbPath) {
        return;
      }

      const relativePath = path.relative(this.workspaceRoot.fsPath, uri.fsPath);
      Logger.d(
        `${this._tag}: 检测到 l10n arb 文件变化: ${relativePath}，执行 gen-l10n`,
      );

      // 执行 flutter.task.genl10n 命令
      TerminalCommand.genl10n(this.workspaceRoot);
    } catch (e) {
      Logger.e(`${this._tag}: 处理 l10n arb 文件变化失败`, e);
    }
  }

  /**
   * 重新初始化监听器（当配置变更时调用）
   */
  async reinitialize(): Promise<void> {
    this.dispose();
    this.setupWatcher();
  }

  dispose(): void {
    if (this.arbFileWatcher) {
      this.arbFileWatcher.dispose();
      this.arbFileWatcher = undefined;
    }
    if (this.configWatcher) {
      this.configWatcher.dispose();
      this.configWatcher = undefined;
    }
    this.templateArbPath = undefined;
    Logger.d(`${this._tag}: l10n arb 文件监听器已停止`);
  }
}
