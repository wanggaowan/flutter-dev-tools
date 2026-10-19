import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";
import { ConfigUtils } from "./config-utils";
import Logger from "./logger";

/**
 * 管理 pubspec.yaml 文件中的 assets 配置
 */
export class PubspecUtils {
  private constructor() {}

  /**
   * 操作队列的尾部 Promise。
   * pubspec 的修改是「读取-变更-写回」过程，且写回是异步的；
   * 若并发执行，后一个任务可能读到前一个任务写入前的旧数据，导致更新丢失。
   * 因此所有修改操作都通过该队列串行执行。
   */
  private static opQueue: Promise<unknown> = Promise.resolve();

  /**
   * 将修改任务排入队列，串行执行
   */
  private static enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.opQueue.then(() => task());
    // 队列不能被单个失败任务中断
    this.opQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

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
   * 将 assets 数组序列化为 YAML 格式的字符串
   * @param assets 资源路径数组
   * @param indent flutter 键的缩进级别（空格数）
   * @returns YAML 格式的 assets 字符串
   */
  private static serializeAssets(assets: string[], indent: number): string {
    const indentStr = " ".repeat(indent);
    const itemIndent = " ".repeat(indent + 2);

    if (assets.length === 0) {
      return `${indentStr}assets: []\n`;
    }

    const items = assets.map(item => `${itemIndent}- ${item}`).join("\n");
    return `${indentStr}assets:\n${items}\n`;
  }

  /**
   * 从原始内容中提取 flutter.assets 部分的缩进级别
   * @param content 文件内容
   * @returns flutter 键的缩进空格数，默认 0
   */
  private static detectFlutterIndent(content: string): number {
    const matches = content.matchAll(/^([^\S\n]*)flutter([^\S\n]*):\s*$/gm);
    let minIndent = Infinity;

    for (const match of matches) {
      const indent = match[1].length;
      if (indent < minIndent) {
        minIndent = indent;
      }
    }

    return minIndent === Infinity ? 0 : minIndent;
  }

  /**
   * 写入 pubspec.yaml 文件，只修改 flutter.assets 部分，保留其他内容和注释
   * @param pubspecPath 文件路径
   * @param assets 新的 assets 数组
   */
  static writePubspecAssetsOnly(pubspecPath: string, assets: string[]): void {
    // assets.sort();
    let content = fs.readFileSync(pubspecPath, "utf-8");
    const lines = content.split("\n");

    // 检测 flutter 键的缩进级别
    const flutterIndent = this.detectFlutterIndent(content);
    const assetsIndent = flutterIndent + 2;

    // 构建要替换的 assets 部分（不含最后换行）
    const newAssetsLines = this.serializeAssets(assets, assetsIndent)
      .trimEnd()
      .split("\n");

    // 查找 flutter 下的 assets 块
    let inFlutterBlock = false;
    let assetsStartLine = -1;
    let assetsEndLine = -1;

    const flutterPreSpace = " ".repeat(flutterIndent);
    const startFlutter = flutterPreSpace + "flutter";
    const startAssets = " ".repeat(assetsIndent) + "assets";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trimEnd();

      // 检测是否进入 flutter 块,flutter和分号直接可能有空格
      if (trimmedLine.startsWith(startFlutter) && trimmedLine.endsWith(":")) {
        inFlutterBlock = true;
        continue;
      }

      // 如果在 flutter 块内
      if (inFlutterBlock) {
        // 遇到非缩进的行，说明离开了 flutter 块
        if (line.length > 0 && !line.startsWith(flutterPreSpace)) {
          inFlutterBlock = false;
          break;
        }

        // 查找 assets: 行
        if (trimmedLine.startsWith(startAssets) && trimmedLine.endsWith(":")) {
          assetsStartLine = i;
          // 找到 assets 块的结束位置（下一个同级或更高级的键，或文件末尾）
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j];
            const nextTrimmed = nextLine.trim();

            // 空行跳过
            if (nextTrimmed === "") {
              continue;
            }

            // 如果下一行的缩进小于等于 assets 的缩进，说明 assets 块结束
            const nextIndent = nextLine.match(/^(\s*)/)?.[1].length || 0;
            if (nextIndent <= assetsIndent && nextTrimmed !== "") {
              assetsEndLine = j;
              break;
            }
          }

          // 如果没找到结束位置，说明到文件末尾
          if (assetsEndLine === -1) {
            assetsEndLine = lines.length;
          }

          break;
        }
      }
    }

    // 执行替换
    if (assetsStartLine !== -1 && assetsEndLine !== -1) {
      // 替换现有的 assets 块
      lines.splice(
        assetsStartLine,
        assetsEndLine - assetsStartLine,
        ...newAssetsLines,
      );
    } else {
      // 没有找到 assets，需要在 flutter: 后添加
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "flutter:") {
          // 在 flutter: 下一行插入
          lines.splice(i + 1, 0, ...newAssetsLines);
          break;
        }
      }

      // 如果连 flutter: 都没找到，添加到文件末尾
      if (!lines.some(line => line.trim() === "flutter:")) {
        lines.push("");
        lines.push("flutter:");
        lines.push(...this.serializeAssets(assets, 2).trimEnd().split("\n"));
      }
    }

    content = lines.join("\n");
    fs.writeFileSync(pubspecPath, content, "utf-8");
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
   * 更新 flutter.assets 数组（仅用于内存中的对象操作）
   */
  static setAssets(pubspec: any, assets: string[]): void {
    if (!pubspec.flutter) {
      pubspec.flutter = {};
    }

    pubspec.flutter.assets = assets;
  }

  /**
   * 图片资源目录在 assets 中的前缀，如 assets/images/；未配置 imageSrcPath 时返回 undefined
   */
  private static getImageAssetPrefix(): string | undefined {
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (!imageSrcPath) {
      return undefined;
    }
    return imageSrcPath.split(path.sep).join("/") + "/";
  }

  /**
   * 剔除 assets 中已失效的图片资源目录条目（磁盘上目录已不存在）。
   * 只处理 imageSrcPath 前缀下的条目，其它资源（字体、assets/data 等由用户自行维护）一律保留。
   * @returns 清理后的数组，以及是否发生了清理
   */
  private static pruneMissingImageAssets(
    workspaceRoot: string,
    assets: string[],
  ): { assets: string[]; changed: boolean } {
    const prefix = this.getImageAssetPrefix();
    if (!prefix) {
      return { assets, changed: false };
    }

    const result = assets.filter(entry => {
      if (!entry.startsWith(prefix)) {
        return true;
      }
      // 目录条目可能带结尾斜杠，判断存在性时先去掉
      const normalized = entry.replace(/\/+$/, "");
      if (!normalized || normalized === prefix.slice(0, -1)) {
        return true;
      }
      if (fs.existsSync(path.join(workspaceRoot, normalized))) {
        return true;
      }
      Logger.d(`清理已失效的资源目录: ${entry}`);
      return false;
    });

    return { assets: result, changed: result.length !== assets.length };
  }

  /**
   * 确保 assets 列表中包含指定的目录（相对于项目根目录的相对路径）
   * @param workspaceRoot 工作区根目录
   * @param directoryPath 要添加的目录绝对路径
   * @returns 是否发生了改变
   */
  static async ensureAssetDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const pubspecPath = this.getPubspecPath(workspaceRoot);
      const pubspec = this.readPubspec(pubspecPath);

      const assets = this.getAssets(pubspec);
      const relativePath = path.relative(workspaceRoot, directoryPath);
      const actualSubdirs: string[] = [relativePath.split(path.sep).join("/")];
      // 递归收集 directoryPath 下的所有层级子目录
      if (fs.existsSync(directoryPath)) {
        this.collectSubDirectories(workspaceRoot, directoryPath, actualSubdirs);
      }

      // 找出需要添加的目录
      const toAdd = actualSubdirs.filter(dir => !assets.includes(dir));
      let changed = false;
      // 添加新目录
      for (const dir of toAdd) {
        assets.push(dir);
        Logger.d(`将添加资源目录: ${dir}`);
        changed = true;
      }

      if (!changed) {
        return false;
      }

      // 排序以保持有序
      this.writePubspecAssetsOnly(pubspecPath, assets);
      Logger.d(`已添加资源目录到 pubspec.yaml: ${toAdd.join("、")}`);
      return true;
    });
  }

  /**
   * 从 assets 列表中移除指定的目录
   * @param workspaceRoot 工作区根目录
   * @param directoryPath 要移除的目录绝对路径
   * @returns 是否发生了改变
   */
  static async removeAssetDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const pubspecPath = this.getPubspecPath(workspaceRoot);
      const pubspec = this.readPubspec(pubspecPath);

      // 先剔除已失效的图片资源目录
      const pruned = this.pruneMissingImageAssets(
        workspaceRoot,
        this.getAssets(pubspec),
      );
      const assets = pruned.assets;
      if (!pruned.changed) {
        return false;
      }

      // this.setAssets(pubspec, assets);
      this.writePubspecAssetsOnly(pubspecPath, assets);
      Logger.d(`已从 pubspec.yaml 移除资源目录: ${directoryPath}`);
      return true;
    });
  }

  /**
   * 递归收集 directoryPath 下所有层级的子目录，以相对于 workspaceRoot 的 Unix 风格路径写入 out
   * 跳过隐藏目录（以 . 开头），与监听器的处理保持一致
   */
  private static collectSubDirectories(
    workspaceRoot: string,
    directoryPath: string,
    out: string[],
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch (e) {
      Logger.e(`读取目录失败: ${directoryPath}`, e);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const childPath = path.join(directoryPath, entry.name);
      out.push(
        path.relative(workspaceRoot, childPath).split(path.sep).join("/"),
      );
      this.collectSubDirectories(workspaceRoot, childPath, out);
    }
  }

  /**
   * 同步图片资源目录到 assets 列表
   * 递归遍历 imageSrcPath 下所有层级的子目录，剔除磁盘上已不存在的条目、补齐缺失的条目
   * @param workspaceRoot 工作区根目录
   * @param imageSrcPath 图片源目录（相对于项目根目录）
   */
  static async syncAssetDirectories(
    workspaceRoot: string,
    imageSrcPath: string,
  ): Promise<void> {
    return this.enqueue(async () => {
      const pubspecPath = this.getPubspecPath(workspaceRoot);
      const pubspec = this.readPubspec(pubspecPath);

      const fullPath = path.join(workspaceRoot, imageSrcPath);
      // 先剔除已失效的图片资源目录，磁盘上仍然存在的条目（含多级子目录）一律保留
      const pruned = this.pruneMissingImageAssets(
        workspaceRoot,
        this.getAssets(pubspec),
      );
      const assets = pruned.assets;

      // 递归收集 imageSrcPath 下的所有层级子目录
      const actualSubdirs: string[] = [];
      if (fs.existsSync(fullPath)) {
        this.collectSubDirectories(workspaceRoot, fullPath, actualSubdirs);
      }

      // 找出需要添加的目录
      const toAdd = actualSubdirs.filter(dir => !assets.includes(dir));

      let changed = pruned.changed;

      // 添加新目录
      for (const dir of toAdd) {
        assets.push(dir);
        Logger.d(`将添加资源目录: ${dir}`);
        changed = true;
      }

      if (changed) {
        // 排序
        this.writePubspecAssetsOnly(pubspecPath, assets);
        Logger.d("pubspec.yaml assets 已同步");
      } else {
        Logger.d("pubspec.yaml assets 已是最新状态");
      }
    });
  }
}
