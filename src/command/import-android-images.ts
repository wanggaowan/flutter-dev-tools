import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import { disposeAll, isImage } from "../utils/utils";
import { ConfigUtils } from "../utils/config-utils";
import Logger from "../utils/logger";
import { FlutterSdk } from "../sdk";

/**
 * Android 密度目录到 Flutter 变体目录的映射
 */
const DENSITY_MAP: Record<string, string | null> = {
  "drawable-mdpi": null,
  "drawable-hdpi": "1.5x",
  "drawable-xhdpi": "2.0x",
  "drawable-xxhdpi": "3.0x",
  "drawable-xxxhdpi": "4.0x",
  "mipmap-mdpi": null,
  "mipmap-hdpi": "1.5x",
  "mipmap-xhdpi": "2.0x",
  "mipmap-xxhdpi": "3.0x",
  "mipmap-xxxhdpi": "4.0x",
};

/**
 * 需要忽略的变体目录
 */
const VARIANT_DIRS = ["1.5x", "2.0x", "3.0x", "4.0x"];

/**
 * 导入 Android 图片目录格式的图片资源
 */
export class ImportAndroidImages implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];
  private lastSelectedDir: string | undefined; // 记录上次选择的目录（内存中，不持久化）

  constructor(private readonly sdk: FlutterSdk) {
    const commandId = "flutterDevTools.importAndroidImages";
    const disposable = vscode.commands.registerCommand(commandId, uri =>
      this.importImages(uri),
    );
    this.disposableList.push(disposable);
  }

  dispose() {
    this.lastSelectedDir = undefined;
    disposeAll(this.disposableList);
  }

  private async importImages(uri?: vscode.Uri) {
    if (!uri) {
      Logger.showNotification("请选择目标文件夹", "error");
      return;
    }

    // 获取目标图片目录配置
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (!imageSrcPath) {
      Logger.showNotification("请在设置中配置图片资源目录路径", "error");
      return;
    }

    const targetBasePath = path.join(this.sdk.workspace.fsPath, imageSrcPath);
    const selectedPath = uri.fsPath;

    // 检查选中路径是否是目标目录或其子目录
    const isInTargetDir =
      selectedPath === targetBasePath ||
      selectedPath.startsWith(targetBasePath + path.sep);

    if (!isInTargetDir) {
      Logger.showNotification(
        `只能在图片资源目录（${imageSrcPath}）及其子目录下执行此操作`,
        "error",
      );
      return;
    }

    // 检查是否是变体目录（1.5x, 2.0x, 3.0x, 4.0x）或其子目录
    if (this.isVariantDirectory(selectedPath, targetBasePath)) {
      Logger.showNotification(
        "不能在变体目录（1.5x, 2.0x, 3.0x, 4.0x）及其子目录下执行此操作",
        "error",
      );
      return;
    }

    // 确定对话框的默认打开目录
    let defaultUri: vscode.Uri;
    if (this.lastSelectedDir && fs.existsSync(this.lastSelectedDir)) {
      // 如果上次有选择且目录仍存在，从上次选择的目录开始
      defaultUri = vscode.Uri.file(this.lastSelectedDir);
    } else {
      // 首次使用或上次的目录不存在，从桌面开始
      const homeDir = require("os").homedir();
      const desktopPath = path.join(homeDir, "Desktop");
      defaultUri = vscode.Uri.file(
        fs.existsSync(desktopPath) ? desktopPath : homeDir,
      );
    }

    // 让用户选择外部的 Android 密度目录或压缩文件（支持多选）
    const selectedUris = await vscode.window.showOpenDialog({
      defaultUri: defaultUri,
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      filters: {
        压缩包: ["zip"],
        所有文件: ["*"],
      },
      openLabel: "选择",
      title: "选择 Android 密度目录、包含密度目录的父目录，或 ZIP 压缩文件",
    });

    if (!selectedUris || selectedUris.length === 0) {
      return; // 用户取消选择
    }

    // 记录用户选择的第一个目录的父目录，作为下次打开的默认位置
    const firstSelectedPath = selectedUris[0].fsPath;
    if (fs.statSync(firstSelectedPath).isDirectory()) {
      this.lastSelectedDir = path.dirname(firstSelectedPath);
    }

    // 收集所有需要处理的密度目录
    const densityDirsToProcess: Array<[string, string]> = [];

    // 跟踪需要清理的临时解压目录
    const tempDirsToDelete: string[] = [];

    try {
      for (const selectedUri of selectedUris) {
        const sourcePath = selectedUri.fsPath;
        const stat = fs.statSync(sourcePath);

        // 检查是文件还是目录
        if (stat.isFile()) {
          // 处理压缩文件
          if (sourcePath.toLowerCase().endsWith(".zip")) {
            const tempDir = await this.extractZipFile(sourcePath);
            if (tempDir) {
              tempDirsToDelete.push(tempDir);

              // 在解压后的目录中查找密度目录
              const subDensityDirs = this.findDensityDirectories(tempDir);
              if (subDensityDirs.length > 0) {
                densityDirsToProcess.push(...subDensityDirs);
              }
            }
          }
          // 忽略非 zip 文件
        } else if (stat.isDirectory()) {
          // 处理目录（原有逻辑）
          const dirName = path.basename(sourcePath);

          // 检查选中的目录本身是否是密度目录
          if (dirName in DENSITY_MAP) {
            // 直接选择了密度目录
            densityDirsToProcess.push([dirName, sourcePath]);
          } else {
            // 选择的是父目录，查找其下的密度子目录
            const subDensityDirs = this.findDensityDirectories(sourcePath);
            if (subDensityDirs.length > 0) {
              densityDirsToProcess.push(...subDensityDirs);
            }
            // 如果不是密度目录且没有密度子目录，则忽略（不报错）
          }
        }
      }
    } catch (e) {
      Logger.e("处理选择的文件时出错", e);
      Logger.showNotification("处理文件失败", "error");
      return;
    }

    if (densityDirsToProcess.length === 0) {
      Logger.showNotification(
        "未找到有效的 Android 密度目录（drawable-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi 或 mipmap-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi）",
        "warn",
      );
      return;
    }

    // 处理每个密度目录
    let importedCount = 0;
    let totlaCount = 0;
    try {
      for (const [dirName, dirPath] of densityDirsToProcess) {
        const variant = DENSITY_MAP[dirName];
        const count = await this.copyImagesFromDir(
          dirPath,
          selectedPath, // 使用选中的目标路径，而不是 targetBasePath
          variant,
        );
        totlaCount += count[0];
        importedCount += count[1];
      }

      if (importedCount > 0) {
        const relativePath = path.relative(
          this.sdk.workspace.fsPath,
          selectedPath,
        );
        Logger.showNotification(
          `成功从外部导入 ${importedCount} 个图片文件到 "${relativePath}"`,
          "info",
        );
        // 刷新项目视图
        vscode.commands.executeCommand("flutterProjectView.refresh");
      } else {
        if (totlaCount == 0) {
          Logger.showNotification("未找到可导入的图片", "warn");
        } else {
          Logger.showNotification("导入图片已存在", "warn");
        }
      }
    } finally {
      // 清理临时解压目录
      for (const tempDir of tempDirsToDelete) {
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (e) {
          Logger.e(`删除临时目录失败: ${tempDir}`, e);
        }
      }
    }
  }

  /**
   * 解压 ZIP 文件到临时目录
   * @param zipPath ZIP 文件路径
   * @returns 解压后的临时目录路径，失败返回 undefined
   */
  private async extractZipFile(zipPath: string): Promise<string | undefined> {
    try {
      // 创建临时目录
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "android-images-"));

      // 解压 ZIP 文件
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true); // true = 覆盖已存在的文件

      Logger.d(`ZIP 文件已解压到: ${tempDir}`);
      return tempDir;
    } catch (e) {
      Logger.e(`解压 ZIP 文件失败: ${zipPath}`, e);
      Logger.showNotification(
        `解压文件失败: ${path.basename(zipPath)}`,
        "error",
      );
      return undefined;
    }
  }

  /**
   * 检查路径是否在变体目录或其子目录下
   */
  private isVariantDirectory(
    selectedPath: string,
    targetBasePath: string,
  ): boolean {
    let currentPath = selectedPath;

    while (currentPath !== targetBasePath) {
      const dirName = path.basename(currentPath);
      if (VARIANT_DIRS.includes(dirName)) {
        return true;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }

    return false;
  }

  /**
   * 查找所有 Android 密度目录
   */
  private findDensityDirectories(sourcePath: string): Array<[string, string]> {
    const result: Array<[string, string]> = [];

    try {
      const entries = fs.readdirSync(sourcePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name;
          if (dirName in DENSITY_MAP) {
            result.push([dirName, path.join(sourcePath, dirName)]);
          }
        }
      }
    } catch (e) {
      Logger.e(e);
    }

    return result;
  }

  /**
   * 从指定目录复制图片文件到目标位置
   */
  private async copyImagesFromDir(
    sourceDir: string,
    targetBasePath: string,
    variant: string | null,
  ): Promise<[number, number]> {
    let count = 0;
    let successCount = 0;
    try {
      const files = fs.readdirSync(sourceDir);
      for (const file of files) {
        const sourceFile = path.join(sourceDir, file);
        const stat = fs.statSync(sourceFile);
        // 跳过子目录
        if (!stat.isFile()) {
          continue;
        }

        // 检查是否是图片文件
        if (!isImage(file)) {
          continue;
        }

        count++;
        // 确定目标路径
        let targetDir = targetBasePath;
        if (variant) {
          targetDir = path.join(targetBasePath, variant);
        }

        // 确保目标目录存在
        try {
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));
        } catch (e) {
          Logger.e(`创建目录失败: ${targetDir}`, e);
          continue;
        }

        const targetFile = path.join(targetDir, file);

        // 如果目标文件已存在，跳过
        if (fs.existsSync(targetFile)) {
          Logger.d(`文件已存在，跳过: ${targetFile}`);
          continue;
        }

        // 复制文件
        try {
          const content = fs.readFileSync(sourceFile);
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(targetFile),
            content,
          );
          successCount++;
        } catch (e) {
          Logger.e(`复制文件失败: ${sourceFile}`, e);
        }
      }
    } catch (e) {
      Logger.e(`读取目录失败: ${sourceDir}`, e);
    }

    return [count, successCount];
  }
}
