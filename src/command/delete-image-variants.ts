import * as vscode from "vscode";
import * as path from "path";
import { disposeAll, isImage } from "../utils/utils";
import { ImageVariantUtils } from "../utils/image-variant-utils";
import { COMMAND_DELETE_IMAGE_WITH_VARIANTS } from "../constants.contexts";
import Logger from "../utils/logger";
import { FlutterSdk } from "../sdk";

/**
 * 提示语中最多展示的文件数
 */
const MAX_LIST_LINES = 12;

/**
 * 删除选中的单个或多个图片，同时删除其在所有变体目录（1.5x、2.0x...）下的同名图片
 */
export class DeleteImageWithVariants implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];

  constructor(private readonly sdk: FlutterSdk) {
    const dispose = vscode.commands.registerCommand(
      COMMAND_DELETE_IMAGE_WITH_VARIANTS,
      (uri?: vscode.Uri, uris?: vscode.Uri[]) => this.execute(uri, uris),
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  private async execute(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const selectedImages = this.getSelectedImages(uri, uris);
    if (selectedImages.length === 0) {
      Logger.showNotification("请在资源管理器中选择要删除的图片文件", "error");
      return;
    }

    const filesToDelete = this.collectFilesToDelete(selectedImages);
    if (filesToDelete.length === 0) {
      Logger.showNotification("未找到需要删除的图片文件", "warn");
      return;
    }

    const showPaths = filesToDelete.map(file =>
      this.toRelativePath(file.fsPath),
    );
    const confirmed = await this.confirm(
      selectedImages.length,
      showPaths,
    );
    if (!confirmed) {
      return;
    }

    const failedPaths = await this.deleteFiles(filesToDelete);
    const deletedCount = filesToDelete.length - failedPaths.length;
    if (deletedCount > 0) {
      Logger.showNotification(
        `已将 ${deletedCount} 个图片文件（含所有变体）移入废纸篓`,
      );
    }
    if (failedPaths.length > 0) {
      Logger.showNotification(
        `以下图片移入废纸篓失败：\n${this.buildListText(failedPaths)}`,
        "error",
      );
    }
  }

  /**
   * 从右键选中项中筛选出图片文件
   */
  private getSelectedImages(
    uri?: vscode.Uri,
    uris?: vscode.Uri[],
  ): vscode.Uri[] {
    const selected = uris && uris.length > 0 ? uris : uri ? [uri] : [];
    return selected.filter(
      item => item && item.scheme === "file" && isImage(path.basename(item.fsPath)),
    );
  }

  /**
   * 展开选中图片，收集其所有变体文件并去重排序
   */
  private collectFilesToDelete(selectedImages: vscode.Uri[]): vscode.Uri[] {
    const filePaths = new Set<string>();
    for (const image of selectedImages) {
      for (const variant of ImageVariantUtils.collectVariants(image.fsPath)) {
        filePaths.add(variant);
      }
    }

    return Array.from(filePaths)
      .sort((a, b) => a.localeCompare(b))
      .map(filePath => vscode.Uri.file(filePath));
  }

  private async confirm(
    selectedCount: number,
    showPaths: string[],
  ): Promise<boolean> {
    const variantCount = showPaths.length - selectedCount;
    const variantText =
      variantCount > 0 ? `及 ${variantCount} 个变体` : "及其变体";
    const detail =
      `将把选中的 ${selectedCount} 张图片${variantText}（共 ${showPaths.length} 个文件）移入废纸篓，` +
      `对应的图片引用方法会自动移除：\n${this.buildListText(showPaths)}`;

    const yes = "确认删除";
    const pick = await Logger.showNotification(
      detail,
      "warn",
      { modal: true },
      yes,
    );
    return pick === yes;
  }

  /**
   * 逐个移入废纸篓，返回删除失败的文件路径
   */
  private async deleteFiles(files: vscode.Uri[]): Promise<string[]> {
    const failedPaths: string[] = [];

    for (const file of files) {
      try {
        await vscode.workspace.fs.delete(file, { useTrash: true });
      } catch (e) {
        Logger.e(`删除图片失败: ${file.fsPath}`, e);
        failedPaths.push(this.toRelativePath(file.fsPath));
      }
    }

    return failedPaths;
  }

  private toRelativePath(filePath: string): string {
    const rootPath = this.sdk.workspace.fsPath;
    if (filePath.startsWith(rootPath)) {
      return path.relative(rootPath, filePath);
    }
    return filePath;
  }

  private buildListText(paths: string[]): string {
    const shown = paths.slice(0, MAX_LIST_LINES).join("\n");
    if (paths.length <= MAX_LIST_LINES) {
      return shown;
    }
    return `${shown}\n...等 ${paths.length} 个文件`;
  }
}
