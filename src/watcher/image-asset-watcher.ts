import * as vscode from "vscode";
import * as path from "path";
import { ConfigUtils } from "../utils/config-utils";
import { PubspecUtils } from "../utils/pubspec-utils";
import { ImageReferenceGenerator } from "../utils/image-reference-generator";
import Logger from "../utils/logger";
import { isImage } from "../utils/utils";
import { FlutterSdk } from "../sdk";

const _tag = "ImageAssetWatcher";

/**
 * 监听 imageSrcPath 目录下的子目录变化，并自动更新 pubspec.yaml
 */
export class ImageAssetWatcher implements vscode.Disposable {
  private sdk: FlutterSdk;
  private imageAssetWatchers: ImageAssetWatcherWrapper[] = [];

  constructor(sdk: FlutterSdk) {
    this.sdk = sdk;
    this.setupWatcher();
    // 监听配置变更，重新初始化监听器
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
      e => {
        if (e.affectsConfiguration("flutterDevTools.imageSrcPath")) {
          Logger.d("检测到 imageSrcPath 配置变更，重新初始化监听器");
          this.reinitialize();
        }

        // 此回调只要文本被修改就回调一次，因此在输入过程中可能多次回调，但是执行initImage初始化
        // 只希望在最终确定时执行，因此不放到此处而是提供一个全局命令执行
        // else if (
        //   e.affectsConfiguration("flutterDevTools.imagesFilePath") ||
        //   e.affectsConfiguration("flutterDevTools.imagesClassName")
        // ) {
        //   this.initImage(true);
        // }
      },
    );
    this.sdk.context.subscriptions.push(configChangeDisposable);
    // 按理进入项目就要执行一次pubspec.yaml assets节点数据和images.dart生成图片引用方法初始化操作
    // 但是此生成范围比较大，默认项目进入时老数据已经生成好
    // this.initPub();
    // this.initImage(false);
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

    this.sdk.modules.forEach(item => {
      this.imageAssetWatchers.push(
        new ImageAssetWatcherWrapper(item.workspace, imageSrcPath),
      );
    });
  }

  private initPub() {
    this.imageAssetWatchers.forEach(item => {
      PubspecUtils.syncAssetDirectories(
        item.workspaceRoot.fsPath,
        item.imageSrcPath,
      );
    });
  }

  private initImage(clearCreate: boolean) {
    this.imageAssetWatchers.forEach(item => {
      if (clearCreate) {
        ImageReferenceGenerator.regenerateForDirectory(
          item.workspaceRoot.fsPath,
          item.imageSrcPath,
        );
      } else {
        ImageReferenceGenerator.syncAssetDirectories(
          item.workspaceRoot.fsPath,
          item.imageSrcPath,
        );
      }
    });
  }

  /**
   * 重新初始化监听器（当配置变更时调用）
   */
  private reinitialize() {
    this.dispose();
    this.setupWatcher();
    // 初始化数据
    // this.initPub();
    // this.initImage(true);
  }

  dispose(): void {
    this.imageAssetWatchers.forEach(item => {
      item.dispose();
    });
    this.imageAssetWatchers = [];
  }
}

export class ImageAssetWatcherWrapper implements vscode.Disposable {
  readonly workspaceRoot: vscode.Uri;
  readonly imageSrcPath: string;
  private _moduleName: string;

  private watcher: vscode.FileSystemWatcher | undefined;
  private clearDirectoryDeletedSetTimeoutId: any;
  private clearImageReferenceSetTimeoutId: any;

  constructor(workspaceRoot: vscode.Uri, imageSrcPath: string) {
    this.workspaceRoot = workspaceRoot;
    this.imageSrcPath = imageSrcPath;
    this._moduleName = path.basename(this.workspaceRoot.fsPath);
    this.setupWatcher();
  }

  /**
   * 设置文件监听器
   */
  private setupWatcher(): void {
    // 监听 imageSrcPath 目录下的所有变化（包括子目录）
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      `${this.imageSrcPath}/**/*`,
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

    Logger.d(
      `${this._moduleName}-${_tag}-已启动图片资源目录监听器: ${this.imageSrcPath}`,
    );
  }

  /**
   * 处理文件创建事件（包括目录和图片文件）
   */
  private async handleFileCreated(uri: vscode.Uri) {
    try {
      if (path.basename(uri.fsPath).startsWith(".")) {
        return;
      }

      const fsStat = await vscode.workspace.fs.stat(uri);
      // 处理目录创建
      if (fsStat.type === vscode.FileType.Directory) {
        this.handleDirectoryCreated(uri);
        // 文件件重命名时，不会触发文件的创建，因此此处也执行一次目录下图片引用资源的生成
        // 这在导入图片时会和下面单独处理文件有重复，但是目前也无法避免
        this.generateDirImageReference(uri.fsPath);
      } else if (fsStat.type === vscode.FileType.File) {
        // 处理图片文件创建
        const fileName = path.basename(uri.fsPath).toLowerCase();
        if (isImage(fileName)) {
          const relativePath = path.relative(
            this.workspaceRoot.fsPath,
            uri.fsPath,
          );
          Logger.d(`${this._moduleName}-${_tag}-检测到新图片: ${relativePath}`);
          // 这一步是为了目录创建时不是在vscode中，因此此处进行补救
          this.handleDirectoryCreated(
            vscode.Uri.file(path.dirname(uri.fsPath)),
          );
          this.generateImageReference(uri.fsPath);
        }
      }
    } catch (e) {
      Logger.e(
        `${this._moduleName}-${_tag}-处理文件创建事件失败: ${uri.fsPath}`,
        e,
      );
    }
  }

  /**
   * 处理文件删除事件（包括目录和图片文件）
   */
  private handleFileDeleted(uri: vscode.Uri) {
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
      Logger.e(`${_tag}-}-处理文件删除事件失败: ${uri.fsPath}`, e);
    }
  }

  /**
   * 生成单个图片的引用
   */
  private async generateImageReference(imagePath: string): Promise<void> {
    try {
      await ImageReferenceGenerator.generateForSingleImage(
        this.workspaceRoot.fsPath,
        imagePath,
      );
    } catch (e) {
      Logger.e(`${this._moduleName}-${_tag}:生成图片引用失败`, e);
    }
  }

  /**
   * 生成目录下所有图片的引用
   */
  private async generateDirImageReference(dirPath: string): Promise<void> {
    try {
      await ImageReferenceGenerator.generateForDirectory(
        this.workspaceRoot.fsPath,
        dirPath,
      );
    } catch (e) {
      Logger.e(`${this._moduleName}-${_tag}:生成图片引用失败`, e);
    }
  }

  /**
   * 清理图片的引用（包含所有无效的图片）
   * 200ms 内多次调用只执行最后一次
   */
  private clearImageReference() {
    Logger.d(`${this._moduleName}-${_tag}:检测到图片删除`);
    // 取消之前的定时器
    if (this.clearImageReferenceSetTimeoutId) {
      Logger.d(
        `${this._moduleName}-${_tag}:图片删除，图片引用方法清理操作被取消`,
      );
      clearTimeout(this.clearImageReferenceSetTimeoutId);
    }

    this.clearImageReferenceSetTimeoutId = setTimeout(async () => {
      try {
        Logger.d(`${this._moduleName}-${_tag}:执行图片引用方法清理操作`);
        await ImageReferenceGenerator.pruneMissingReferences(
          this.workspaceRoot.fsPath,
        );
      } catch (e) {
        Logger.e("${this._tag}:移除图片引用失败", e);
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
      const relativePath = path.relative(this.workspaceRoot.fsPath, uri.fsPath);
      Logger.d(
        `${this._moduleName}-${_tag}-检测到新目录/目录下文件变更: ${relativePath}`,
      );

      // 添加到 pubspec.yaml
      const changed = await PubspecUtils.ensureAssetDirectory(
        this.workspaceRoot.fsPath,
        uri.fsPath,
      );

      if (changed) {
        Logger.d(
          `${this._moduleName}-${_tag}-已将新目录添加到 pubspec.yaml: ${relativePath}`,
        );
      }
    } catch (e) {
      Logger.e(
        `${this._moduleName}-${_tag}-处理目录创建事件失败: ${uri.fsPath}`,
        e,
      );
    }
  }

  /**
   * 清理无效目录数据
   * 200ms 内多次调用只执行最后一次
   */
  private clearDirectoryDeleted() {
    Logger.d(`${this._moduleName}-${_tag}:检测到目录删除`);
    // 取消之前的定时器
    if (this.clearDirectoryDeletedSetTimeoutId) {
      Logger.d(`${this._moduleName}-${_tag}:目录删除清理操作被取消`);
      clearTimeout(this.clearDirectoryDeletedSetTimeoutId);
    }

    this.clearDirectoryDeletedSetTimeoutId = setTimeout(async () => {
      try {
        Logger.d(`${this._moduleName}-${_tag}:执行目录删除清理操作`);
        await PubspecUtils.removeAssetDirectory(this.workspaceRoot.fsPath);
      } catch (e) {
        Logger.e(`${this._moduleName}-${_tag}:处理目录删除事件失败`, e);
      } finally {
        this.clearDirectoryDeletedSetTimeoutId = undefined;
      }
    }, 200);
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = undefined;
      Logger.d(`${this._moduleName}-${_tag}:图片资源目录监听器已停止`);
    }
  }
}
