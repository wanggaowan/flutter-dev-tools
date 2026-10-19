import * as fs from "fs";
import * as path from "path";
import { isImage } from "./utils";

/**
 * 变体目录名，如 1.0x、1.5x、2.0x、3.5x
 */
const VARIANT_DIR_PATTERN = /^\d+(\.\d+)?x$/;

/**
 * 图片变体工具类
 * Flutter 约定：图片的倍图放在其所在目录的直接子目录（1.5x、2.0x...）下
 */
export class ImageVariantUtils {
  private constructor() {}

  /**
   * 去掉路径中的变体目录，得到图片所在的基准目录
   * @param imageFilePath 图片绝对路径
   */
  static getBaseDir(imageFilePath: string): string {
    const dir = path.dirname(imageFilePath);
    if (VARIANT_DIR_PATTERN.test(path.basename(dir))) {
      return path.dirname(dir);
    }
    return dir;
  }

  /**
   * 收集与指定图片同名同扩展名的所有文件（含自身与其所有变体）
   * @param imageFilePath 图片绝对路径
   * @returns 存在的图片绝对路径列表
   */
  static collectVariants(imageFilePath: string): string[] {
    const fileName = path.basename(imageFilePath);
    const baseDir = this.getBaseDir(imageFilePath);
    if (!fs.existsSync(baseDir)) {
      return [];
    }

    const result: string[] = [];
    this.collectSameNameImages(baseDir, fileName, result);

    for (const dirName of fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)) {
      if (!VARIANT_DIR_PATTERN.test(dirName)) {
        continue;
      }
      this.collectSameNameImages(path.join(baseDir, dirName), fileName, result);
    }

    return result;
  }

  /**
   * 收集目录下与 fileName 同名（含扩展名）的图片（不含子目录）
   */
  private static collectSameNameImages(
    dir: string,
    fileName: string,
    result: string[],
  ): void {
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name !== fileName) {
        continue;
      }
      if (isImage(entry.name)) {
        result.push(path.join(dir, entry.name));
      }
    }
  }
}
