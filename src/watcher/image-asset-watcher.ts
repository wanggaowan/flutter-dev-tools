import * as vscode from "vscode";
import * as path from "path";
import { ConfigUtils } from "../utils/config-utils";
import { PubspecUtils } from "../utils/pubspec-utils";
import { ImageReferenceGenerator } from "../utils/image-reference-generator";
import Logger from "../utils/logger";
import { isImage } from "../utils/utils";

/**
 * 监听 imageSrcPath 目录下的子目录变化，并自动更新 pubspec.yaml
 */
export class ImageAssetWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private workspaceRoot: string;
  private clearDirectoryDeletedSetTimeoutId: any;
  private clearImageReferenceSetTimeoutId: any;

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
    this.watcher.onDidCreate(uri => {
      this.handleFileCreated(uri);
    });

    // 监听文件或目录删除
    this.watcher.onDidDelete(uri => {
      // 如果文件和文件所在目录同时被删除，则只触发目录回调
      // 因此无需担心删除操作重复
      this.handleFileDeleted(uri);
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
        // 文件件重命名时，不会触发文件的创建，因此此处也执行一次目录下图片引用资源的生成
        // 这在导入图片时会和下面单独处理文件有重复，但是目前也无法避免
        await this.generateDirImageReference(uri.fsPath);
      } else if (fsStat.type === vscode.FileType.File) {
        // 处理图片文件创建
        const fileName = path.basename(uri.fsPath).toLowerCase();
        if (isImage(fileName)) {
          const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
          Logger.d(`检测到新图片: ${relativePath}`);
          // 这一步是为了目录创建时不是在vscode中，因此此处进行补救
          await this.handleDirectoryCreated(
            vscode.Uri.file(path.dirname(uri.fsPath)),
          );
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
      const fileName = path.basename(uri.fsPath);
      if (fileName.startsWith(".")) {
        return;
      }

      // 由于uri标识的数据被删除，因此无法准确的判断uri标识的资源原来是文件还是目录
      // 比如使用path.extname(fileName)获取后缀名，但是遇到1.5x,2.0x类似这种目录
      // .5x,.0x会被当做后缀。所以识别指定文件后缀，不再此列举中的图片当做文件处理
      // 判断是目录还是文件（通过路径特征判断,因为文件或目录被删除，因此无法通过fs读取是文件还是目录）
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
        this.clearImageReference();
      } else {
        // 目录
        this.clearDirectoryDeleted();
        // 目录下可能包含图片数据，因此目录删除时也要清理图片数据
        this.clearImageReference();
      }
    } catch (e) {
      Logger.e(`处理文件删除事件失败: ${uri.fsPath}`, e);
    }
  }

  /**
   * 生成单个图片的引用
   */
  private async generateImageReference(imagePath: string): Promise<void> {
    try {
      await ImageReferenceGenerator.generateForSingleImage(
        this.workspaceRoot,
        imagePath,
      );
    } catch (e) {
      Logger.e("生成图片引用失败", e);
    }
  }

  /**
   * 生成目录下所有图片的引用
   */
  private async generateDirImageReference(dirPath: string): Promise<void> {
    try {
      await ImageReferenceGenerator.generateForDirectory(
        this.workspaceRoot,
        dirPath,
      );
    } catch (e) {
      Logger.e("生成图片引用失败", e);
    }
  }

  /**
   * 清理图片的引用（包含所有无效的图片）
   * 200ms 内多次调用只执行最后一次
   */
  private async clearImageReference(): Promise<void> {
    Logger.d(`检测到图片删除`);
    // 取消之前的定时器
    if (this.clearImageReferenceSetTimeoutId) {
      Logger.d(`图片删除，图片引用方法清理操作被取消`);
      clearTimeout(this.clearImageReferenceSetTimeoutId);
    }

    this.clearImageReferenceSetTimeoutId = setTimeout(async () => {
      try {
        Logger.d(`执行图片引用方法清理操作`);
        await ImageReferenceGenerator.pruneMissingReferences(
          this.workspaceRoot,
        );
      } catch (e) {
        Logger.e("移除图片引用失败", e);
      } finally {
        this.clearImageReferenceSetTimeoutId = undefined;
      }
    }, 200);
  }

  /**
   * 处理目录创建事件
   */
  private async handleDirectoryCreated(uri: vscode.Uri): Promise<void> {
    try {
      const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
      Logger.d(`检测到新目录/目录下文件变更: ${relativePath}`);

      // 添加到 pubspec.yaml
      const changed = await PubspecUtils.ensureAssetDirectory(
        this.workspaceRoot,
        uri.fsPath,
      );

      if (changed) {
        Logger.d(`已将新目录添加到 pubspec.yaml: ${relativePath}`);
      }
    } catch (e) {
      Logger.e(`处理目录创建事件失败: ${uri.fsPath}`, e);
    }
  }

  /**
   * 清理无效目录数据
   * 200ms 内多次调用只执行最后一次
   */
  private async clearDirectoryDeleted(): Promise<void> {
    Logger.d(`检测到目录删除`);
    // 取消之前的定时器
    if (this.clearDirectoryDeletedSetTimeoutId) {
      Logger.d(`目录删除清理操作被取消`);
      clearTimeout(this.clearDirectoryDeletedSetTimeoutId);
    }

    this.clearDirectoryDeletedSetTimeoutId = setTimeout(async () => {
      try {
        Logger.d(`执行目录删除清理操作`);
        await PubspecUtils.removeAssetDirectory(this.workspaceRoot);
      } catch (e) {
        Logger.e(`处理目录删除事件失败`, e);
      } finally {
        this.clearDirectoryDeletedSetTimeoutId = undefined;
      }
    }, 200);
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
      await ImageReferenceGenerator.regenerateForDirectory(
        this.workspaceRoot,
        imageSrcPath,
      );
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
