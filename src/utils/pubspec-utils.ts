import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parse, stringify } from "yaml";
import Logger from "./logger";

/**
 * 管理 pubspec.yaml 文件中的 assets 配置
 */
export class PubspecUtils {
  private constructor() {}

  /**
   * 获取 pubspec.yaml 文件路径
   */
  static getPubspecPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, "pubspec.yaml");
  }

  /**
   * 读取 pubspec.yaml 文件
   */
  static readPubspec(pubspecPath: string): any {
    if (!fs.existsSync(pubspecPath)) {
      throw new Error(`pubspec.yaml 文件不存在: ${pubspecPath}`);
    }

    const content = fs.readFileSync(pubspecPath, "utf-8");
    return parse(content);
  }

  /**
   * 写入 pubspec.yaml 文件
   */
  static async writePubspec(pubspecPath: string, data: any): Promise<void> {
    const content = stringify(data);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(pubspecPath),
      Buffer.from(content, "utf-8")
    );
  }

  /**
   * 获取 flutter.assets 数组
   */
  static getAssets(pubspec: any): string[] {
    if (!pubspec.flutter || !pubspec.flutter.assets) {
      return [];
    }

    const assets = pubspec.flutter.assets;
    if (!Array.isArray(assets)) {
      return [];
    }

    return assets.filter((item): item is string => typeof item === "string");
  }

  /**
   * 更新 flutter.assets 数组
   */
  static setAssets(pubspec: any, assets: string[]): void {
    if (!pubspec.flutter) {
      pubspec.flutter = {};
    }

    pubspec.flutter.assets = assets;
  }

  /**
   * 确保 assets 列表中包含指定的目录（相对于项目根目录的相对路径）
   * @param workspaceRoot 工作区根目录
   * @param directoryPath 要添加的目录绝对路径
   * @returns 是否发生了改变
   */
  static async ensureAssetDirectory(
    workspaceRoot: string,
    directoryPath: string
  ): Promise<boolean> {
    const pubspecPath = this.getPubspecPath(workspaceRoot);
    const pubspec = this.readPubspec(pubspecPath);

    // 计算相对于项目根目录的路径
    const relativePath = path.relative(workspaceRoot, directoryPath);
    // 转换为 Unix 风格的路径（使用正斜杠）
    const assetPath = relativePath.split(path.sep).join("/");

    let assets = this.getAssets(pubspec);

    // 检查是否已存在
    if (assets.includes(assetPath)) {
      return false;
    }

    // 添加新的资源路径
    assets.push(assetPath);
    // 排序以保持有序
    // assets.sort();

    this.setAssets(pubspec, assets);
    await this.writePubspec(pubspecPath, pubspec);

    Logger.d(`已添加资源目录到 pubspec.yaml: ${assetPath}`);
    return true;
  }

  /**
   * 从 assets 列表中移除指定的目录
   * @param workspaceRoot 工作区根目录
   * @param directoryPath 要移除的目录绝对路径
   * @returns 是否发生了改变
   */
  static async removeAssetDirectory(
    workspaceRoot: string,
    directoryPath: string
  ): Promise<boolean> {
    const pubspecPath = this.getPubspecPath(workspaceRoot);
    const pubspec = this.readPubspec(pubspecPath);

    // 计算相对于项目根目录的路径
    const relativePath = path.relative(workspaceRoot, directoryPath);
    // 转换为 Unix 风格的路径（使用正斜杠）
    const assetPath = relativePath.split(path.sep).join("/");

    let assets = this.getAssets(pubspec);

    // 检查是否存在
    const index = assets.indexOf(assetPath);
    if (index === -1) {
      return false;
    }

    // 移除资源路径
    assets.splice(index, 1);

    this.setAssets(pubspec, assets);
    await this.writePubspec(pubspecPath, pubspec);

    Logger.d(`已从 pubspec.yaml 移除资源目录: ${assetPath}`);
    return true;
  }

  /**
   * 同步所有子目录到 assets 列表
   * 确保 assets 列表与 imageSrcPath 下的实际子目录保持一致
   * @param workspaceRoot 工作区根目录
   * @param imageSrcPath 图片源目录（相对于项目根目录）
   */
  static async syncAssetDirectories(
    workspaceRoot: string,
    imageSrcPath: string
  ): Promise<void> {
    const pubspecPath = this.getPubspecPath(workspaceRoot);
    const pubspec = this.readPubspec(pubspecPath);

    const fullPath = path.join(workspaceRoot, imageSrcPath);
    let assets = this.getAssets(pubspec);

    // 获取实际存在的子目录
    const actualSubdirs: string[] = [];
    if (fs.existsSync(fullPath)) {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const relativePath = path
            .relative(workspaceRoot, path.join(fullPath, entry.name))
            .split(path.sep)
            .join("/");
          actualSubdirs.push(relativePath);
        }
      }
    }

    // 找出需要添加的目录
    const toAdd = actualSubdirs.filter(dir => !assets.includes(dir));

    // 找出需要移除的目录（在 imageSrcPath 下的子目录）
    const imageSrcPrefix = imageSrcPath.split(path.sep).join("/") + "/";
    const toRemove = assets.filter(
      dir => dir.startsWith(imageSrcPrefix) && !actualSubdirs.includes(dir)
    );

    let changed = false;

    // 添加新目录
    for (const dir of toAdd) {
      assets.push(dir);
      Logger.d(`将添加资源目录: ${dir}`);
      changed = true;
    }

    // 移除不存在的目录
    for (const dir of toRemove) {
      const index = assets.indexOf(dir);
      if (index !== -1) {
        assets.splice(index, 1);
        Logger.d(`将移除资源目录: ${dir}`);
        changed = true;
      }
    }

    if (changed) {
      // 排序
      // assets.sort();
      this.setAssets(pubspec, assets);
      await this.writePubspec(pubspecPath, pubspec);
      Logger.d("pubspec.yaml assets 已同步");
    } else {
      Logger.d("pubspec.yaml assets 已是最新状态");
    }
  }
}
