import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { disposeAll, isImage } from "../utils/utils";
import { ImageVariantUtils } from "../utils/image-variant-utils";
import { COMMAND_RENAME_IMAGE_WITH_VARIANTS } from "../constants.contexts";
import Logger from "../utils/logger";
import { FlutterSdk } from "../sdk";

/**
 * 重命名选中的单个图片，同时重命名其在所有变体目录（1.5x、2.0x...）下的同名图片
 */
export class RenameImageWithVariants implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];

  constructor(private readonly sdk: FlutterSdk) {
    const dispose = vscode.commands.registerCommand(
      COMMAND_RENAME_IMAGE_WITH_VARIANTS,
      (uri?: vscode.Uri) => this.execute(uri),
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  private async execute(uri?: vscode.Uri): Promise<void> {
    if (!uri || uri.scheme !== "file" || !isImage(path.basename(uri.fsPath))) {
      Logger.showNotification("请选择一个图片文件进行重命名", "error");
      return;
    }

    // 收集所有需要重命名的文件
    const variants = ImageVariantUtils.collectVariants(uri.fsPath);
    if (variants.length === 0) {
      Logger.showNotification("未找到需要重命名的图片文件", "error");
      return;
    }

    const oldFileName = path.basename(uri.fsPath);
    const ext = path.extname(oldFileName);
    const nameWithoutExt = path.basename(oldFileName, ext);

    // 提示用户输入新文件名（不含扩展名）
    const newFileName = await vscode.window.showInputBox({
      prompt: "请输入新的图片名称（不含扩展名）",
      value: nameWithoutExt,
      placeHolder: "例如：new_image_name",
      validateInput: value => {
        if (!value || value.trim().length === 0) {
          return "文件名不能为空";
        }

        if (!/^[a-zA-Z0-9_\-]+$/.test(value)) {
          return "文件名只能包含字母、数字、下划线和连字符";
        }

        // 检查目标文件是否已存在
        const newFileName = `${value}${ext}`;
        for (const variant of variants) {
          const variantDir = path.dirname(variant);
          const targetPath = path.join(variantDir, newFileName);
          if (fs.existsSync(targetPath)) {
            return `文件${newFileName}已存在`;
          }
        }

        return null;
      },
    });

    if (!newFileName) {
      return;
    }

    const trimmedName = newFileName.trim();
    const newFullFileName = `${trimmedName}${ext}`;
    if (newFullFileName === oldFileName) {
      return;
    }

    // 执行重命名
    const renamedPaths: Array<{ old: string; new: string }> = [];
    const failedPaths: string[] = [];

    for (const variant of variants) {
      const variantDir = path.dirname(variant);
      const oldPath = variant;
      const newPath = path.join(variantDir, newFullFileName);

      // 如果源路径和目标路径相同，跳过
      if (oldPath === newPath) {
        continue;
      }

      try {
        await vscode.workspace.fs.rename(
          vscode.Uri.file(oldPath),
          vscode.Uri.file(newPath),
          { overwrite: true },
        );
        renamedPaths.push({ old: oldPath, new: newPath });
      } catch (e) {
        Logger.e(`重命名图片失败: ${oldPath}`, e);
        failedPaths.push(this.toRelativePath(oldPath));
      }
    }

    // 显示结果
    const successCount = renamedPaths.length;
    if (successCount > 0) {
      Logger.showNotification(
        `已将 ${successCount} 个图片文件（含所有变体）重命名为 ${newFullFileName}`,
      );
    }

    if (failedPaths.length > 0) {
      Logger.showNotification(
        `以下图片重命名失败：\n${failedPaths.join("\n")}`,
        "error",
      );
    }
  }

  private toRelativePath(filePath: string): string {
    const rootPath = this.sdk.workspace.fsPath;
    if (filePath.startsWith(rootPath)) {
      return path.relative(rootPath, filePath);
    }
    return filePath;
  }
}
