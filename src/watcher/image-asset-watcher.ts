import * as vscode from "vscode";
import * as path from "path";
import { ConfigUtils } from "../utils/config-utils";
import { PubspecUtils } from "../utils/pubspec-utils";
import { ImageReferenceGenerator } from "../utils/image-reference-generator";
import Logger from "../utils/logger";

/**
 * 监听 imageSrcPath 目录下的子目录变化，并自动更新 pubspec.yaml
 */
export class ImageAssetWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private workspaceRoot: string;
  private pendingDeleteTimeouts: Map<string, NodeJS.Timeout> = new Map(); // 用于处理重命名场景

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.setupWatcher();
  }

  /**
   * 设置文件监听器
   */
  private setupWatcher(): void {
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (!imageSrcPath) {
      Logger.d("未配置 imageSrcPath，跳过监听器设置");
      return;
    }

    // 监听 imageSrcPath 目录下的所有变化（包括子目录）
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      `${imageSrcPath}/**/*`,
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    // 监听文件或目录创建
    this.watcher.onDidCreate(async uri => {
      await this.handleFileCreated(uri);
    });

    // 监听文件或目录删除
    this.watcher.onDidDelete(async uri => {
      await this.handleFileDeleted(uri);
    });

    Logger.d(`已启动图片资源目录监听器: ${imageSrcPath}`);
  }

  /**
   * 处理文件创建事件（包括目录和图片文件）
   */
  private async handleFileCreated(uri: vscode.Uri): Promise<void> {
    try {
      if (path.basename(uri.fsPath).startsWith(".")) {
        return;
      }

      const fsStat = await vscode.workspace.fs.stat(uri);
      // 处理目录创建
      if (fsStat.type === vscode.FileType.Directory) {
        await this.handleDirectoryCreated(uri);
      }
      // 处理图片文件创建
      else if (fsStat.type === vscode.FileType.File) {
        const fileName = path.basename(uri.fsPath).toLowerCase();
        if (this.isImageFile(fileName)) {
          const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
          Logger.d(`检测到新图片: ${relativePath}`);

          // 清除该路径可能存在的待处理删除定时器（重命名场景）
          const existingTimeout = this.pendingDeleteTimeouts.get(relativePath);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
            this.pendingDeleteTimeouts.delete(relativePath);
            Logger.d(`检测到重命名操作，取消删除: ${relativePath}`);
          }

          await this.generateImageReference(uri.fsPath);
        }
      }
    } catch (e) {
      Logger.e(`处理文件创建事件失败: ${uri.fsPath}`, e);
    }
  }

  /**
   * 处理文件删除事件（包括目录和图片文件）
   */
  private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
    try {
      const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
      const fileName = path.basename(uri.fsPath);
      if (fileName.startsWith(".")) {
        return;
      }

      // 判断是目录还是文件（通过路径特征判断）
      const ext = path.extname(fileName).toLowerCase();
      const isLikelyFile = [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".svg",
        ".bmp",
      ].includes(ext);

      if (isLikelyFile) {
        // 处理图片文件删除 - 延迟执行以检测重命名
        Logger.d(`检测到图片删除: ${relativePath}`);

        // 清除该路径可能存在的待处理删除定时器
        const existingTimeout = this.pendingDeleteTimeouts.get(relativePath);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          this.pendingDeleteTimeouts.delete(relativePath);
        }

        // 延迟 300ms 执行删除，以便检测是否有重命名操作
        const timeout = setTimeout(async () => {
          await this.removeImageReference(uri.fsPath);
          this.pendingDeleteTimeouts.delete(relativePath);
        }, 300);

        this.pendingDeleteTimeouts.set(relativePath, timeout);
      } else {
        // 处理目录删除
        Logger.d(`检测到目录删除: ${relativePath}`);
        await this.handleDirectoryDeleted(uri);
      }
    } catch (e) {
      Logger.e(`处理文件删除事件失败: ${uri.fsPath}`, e);
    }
  }

  /**
   * 检查是否是图片文件
   */
  private isImageFile(fileName: string): boolean {
    const ext = fileName.toLowerCase();
    return (
      ext.endsWith(".png") ||
      ext.endsWith(".jpg") ||
      ext.endsWith(".jpeg") ||
      ext.endsWith(".webp") ||
      ext.endsWith(".gif") ||
      ext.endsWith(".svg") ||
      ext.endsWith(".bmp")
    );
  }

  /**
   * 生成单个图片的引用
   */
  private async generateImageReference(imagePath: string): Promise<void> {
    try {
      const generator = new ImageReferenceGenerator(this.workspaceRoot);
      await generator.generateForSingleImage(imagePath);
    } catch (e) {
      Logger.e("生成图片引用失败", e);
    }
  }

  /**
   * 移除单个图片的引用（检查所有变体）
   */
  private async removeImageReference(imagePath: string): Promise<void> {
    try {
      const generator = new ImageReferenceGenerator(this.workspaceRoot);
      await generator.removeReferenceIfAllVariantsDeleted(imagePath);
    } catch (e) {
      Logger.e("移除图片引用失败", e);
    }
  }

  /**
   * 处理目录创建事件
   */
  private async handleDirectoryCreated(uri: vscode.Uri): Promise<void> {
    try {
      const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
      Logger.d(`检测到新目录: ${relativePath}`);

      // 添加到 pubspec.yaml
      const changed = await PubspecUtils.ensureAssetDirectory(
        this.workspaceRoot,
        uri.fsPath,
      );

      if (changed) {
        Logger.showNotification(
          `已将新目录添加到 pubspec.yaml: ${relativePath}`,
          "info",
        );

        // 生成图片引用
        try {
          const generator = new ImageReferenceGenerator(this.workspaceRoot);
          await generator.generateForDirectory(uri.fsPath);
        } catch (e) {
          Logger.e("生成图片引用失败", e);
        }
      }
    } catch (e) {
      Logger.e(`处理目录创建事件失败: ${uri.fsPath}`, e);
    }
  }

  /**
   * 处理目录删除事件
   */
  private async handleDirectoryDeleted(uri: vscode.Uri): Promise<void> {
    try {
      const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
      Logger.d(`检测到目录删除: ${relativePath}`);

      // 从 pubspec.yaml 移除
      const changed = await PubspecUtils.removeAssetDirectory(
        this.workspaceRoot,
        uri.fsPath,
      );

      if (changed) {
        Logger.showNotification(
          `已从 pubspec.yaml 移除目录: ${relativePath}`,
          "info",
        );
      }
    } catch (e) {
      Logger.e(`处理目录删除事件失败: ${uri.fsPath}`, e);
    }
  }

  /**
   * 重新初始化监听器（当配置变更时调用）
   */
  async reinitialize(): Promise<void> {
    this.dispose();
    this.setupWatcher();

    // 同步当前状态
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (imageSrcPath) {
      await PubspecUtils.syncAssetDirectories(this.workspaceRoot, imageSrcPath);
    }
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = undefined;
      Logger.d("图片资源目录监听器已停止");
    }
  }
}
