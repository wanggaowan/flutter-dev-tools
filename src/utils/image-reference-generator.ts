import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConfigUtils } from "./config-utils";
import { imagePathToDartKey, isImage, lowerCamelCase } from "./utils";
import Logger from "./logger";
import { ForamtUtils } from "./format-utils";

export class ImageReferenceGenerator {
  /**
   * 按工作区根目录隔离的操作队列尾部 Promise。
   * images.dart 的修改是「读取-变更-写回」过程，且写回是异步的（格式化 + save）；
   * 若并发执行，后一个任务可能读到前一个任务写入前的旧数据，导致更新丢失。
   * 因此同一工作区的修改操作通过该队列串行执行；
   * 不同工作区操作的是不同文件，无需互相等待，各自独立排队。
   */
  private static opQueues = new Map<string, Promise<unknown>>();

  /**
   * 将修改任务排入指定工作区的队列，串行执行
   * @param workspaceRoot 工作区根目录，作为队列的隔离键
   * @param task 要执行的修改任务
   */
  private static enqueue<T>(
    workspaceRoot: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const key = path.resolve(workspaceRoot);
    const tail = this.opQueues.get(key) ?? Promise.resolve();
    const result = tail.then(() => task());
    // 队列不能被单个失败任务中断
    const next = result.then(
      () => undefined,
      () => undefined,
    );
    this.opQueues.set(key, next);

    // 队列空闲后释放，避免长期驻留已结束的 Promise
    void next.then(() => {
      if (this.opQueues.get(key) === next) {
        this.opQueues.delete(key);
      }
    });
    return result;
  }

  private constructor() {}

  /**
   * 获取 Images 类的完整路径
   */
  private static getImagesClassPath(workspaceRoot: string): string {
    const imagesFilePath = ConfigUtils.imagesFilePath;
    if (!imagesFilePath) {
      throw new Error("请在设置中配置图片引用类文件路径 (imagesFilePath)");
    }
    return path.join(workspaceRoot, imagesFilePath);
  }

  /**
   * 获取 Images 类名
   */
  private static getImagesClassName(): string {
    return ConfigUtils.imagesClassName || "Images";
  }

  /**
   * 将图片路径转换为驼峰命名的方法名
   * @param imagePath 图片相对于项目根目录的路径（如：assets/images/ht/repair/fuwu.png）
   * @returns 驼峰命名的方法名（如：htRepairFuwu）
   */
  private static imageToMethodName(relativePath: string): string {
    // 获取 imageSrcPath 配置
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (!imageSrcPath) {
      throw new Error("请在设置中配置图片资源目录路径 (imageSrcPath)");
    }

    // 去掉 imageSrcPath 前缀
    const normalizedImageSrcPath = imageSrcPath.split(path.sep).join("/");
    const normalizedImagePath = relativePath.split(path.sep).join("/");
    if (normalizedImagePath.startsWith(normalizedImageSrcPath + "/")) {
      relativePath = normalizedImagePath.substring(
        normalizedImageSrcPath.length + 1,
      );
    }

    // 使用 lowerCamelCase 转换为驼峰命名
    let methodName = imagePathToDartKey(relativePath);
    return methodName;
  }

  private static hashString(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  /**
   * 检查 Images 类是否存在，不存在则创建
   */
  private static async ensureImagesClassExists(
    workspaceRoot: string,
  ): Promise<void> {
    const classPath = this.getImagesClassPath(workspaceRoot);
    const className = this.getImagesClassName();

    // 如果文件已存在，直接返回
    if (fs.existsSync(classPath)) {
      return;
    }

    // 确保父目录存在
    const dirPath = path.dirname(classPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));

    // 创建类文件
    const content = `class ${className} {
  ${className}._inner();
}
`;

    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(classPath),
      Buffer.from(content, "utf-8"),
    );

    Logger.d(`已创建图片引用类文件: ${classPath}`);
  }

  /**
   * 读取 Images 类的现有内容
   */
  private static readImagesClassContent(workspaceRoot: string): string {
    const classPath = this.getImagesClassPath(workspaceRoot);
    if (!fs.existsSync(classPath)) {
      return "";
    }
    return fs.readFileSync(classPath, "utf-8");
  }

  /**
   * 写入 Images 类内容并格式化
   */
  private static async writeImagesClassContent(
    workspaceRoot: string,
    content: string,
  ): Promise<void> {
    const classPath = this.getImagesClassPath(workspaceRoot);
    const uri = vscode.Uri.file(classPath);

    // 文件在编辑器中有未保存修改时跳过写入，避免覆盖用户内容
    const openDocument = vscode.workspace.textDocuments.find(
      document => document.uri.fsPath === classPath,
    );

    if (openDocument?.isDirty) {
      await openDocument.save();
      return;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
    await ForamtUtils.formatWithDartCommand(uri);
  }

  /**
   * 检查某个方法名是否已存在于类中
   */
  private static methodExists(content: string, methodName: string): boolean {
    // 匹配 static String get methodName =>
    const regex = new RegExp(
      `static\\s+String\\s+get\\s+${methodName}\\s*=>`,
      "g",
    );
    return regex.test(content);
  }

  /**
   * 生成单个图片的 getter 方法
   * @param imagePath 图片相对于项目根目录的路径
   * @param preAddBreakLine 当前方法前是否加一个空行
   * @returns 生成的 getter 方法字符串
   */
  private static generateGetterMethod(
    relativePath: string,
    preAddSpaceLine: boolean,
  ): string {
    const methodName = this.imageToMethodName(relativePath);
    // 转换为 Unix 风格路径
    let unixPath = relativePath.split(path.sep).join("/");
    unixPath = unixPath.replace(/\/[0-9]+\.[0-9]x\//g, "/");
    return `${preAddSpaceLine ? "" : "\n"}\n  static String get ${methodName} => '${unixPath}';\n`;
  }

  /**
   * 收集指定目录下的所有图片文件（去重）
   * 只扫描主目录（非变体目录），变体目录下的图片不单独生成引用
   * @param directoryPath 目录绝对路径
   * @returns 图片绝对路径数组
   */
  static collectImages(workspaceRoot: string, directoryPath: string): string[] {
    const images: string[] = [];
    if (!fs.existsSync(directoryPath)) {
      return [];
    }

    // 计算相对于项目根目录的路径
    const relativePath = path.relative(workspaceRoot, directoryPath);
    // 检查路径中是否包含变体目录（1.5x, 2.0x, 3.0x, 4.0x 等），如果是则不处理
    const pathParts = relativePath.split(path.sep);
    const hasVariantDir = pathParts.some(part => /^\d+(\.\d+)?x$/.test(part));
    if (hasVariantDir) {
      return [];
    }

    const scanDirectory = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 跳过变体目录（1.5x, 2.0x, 3.0x, 4.0x 等）
          if (/^\d+(\.\d+)?x$/.test(entry.name)) {
            continue;
          }
          // 递归扫描子目录
          scanDirectory(fullPath);
        } else if (entry.isFile() && isImage(entry.name)) {
          // 计算相对于项目根目录的路径
          images.push(fullPath);
        }
      }
    };

    scanDirectory(directoryPath);
    return images;
  }

  /**
   * 指定路径是否在变体目录下
   * @param path 检测的路径
   */
  static isInVariantDir(workspaceRoot: string, dirPath: string) {
    // 计算相对于项目根目录的路径
    const relativePath = path.relative(workspaceRoot, dirPath);
    // 检查路径中是否包含变体目录（1.5x, 2.0x, 3.0x, 4.0x 等），如果是则不处理
    const pathParts = relativePath.split(path.sep);
    return pathParts.some(part => /^\d+(\.\d+)?x$/.test(part));
  }

  /**
   * 为指定目录下的所有图片生成引用(已存在则不处理，不存在添加，清空后重建)
   * @param directoryPath 目录绝对路径
   */
  static async generateForDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<void> {
    if (this.isInVariantDir(workspaceRoot, directoryPath)) {
      Logger.d(`跳过变体目录下的图片: ${directoryPath}`);
      return;
    }

    return ImageReferenceGenerator.enqueue(workspaceRoot, () =>
      this.doGenerateForDirectory(workspaceRoot, directoryPath, false),
    );
  }

  private static async doGenerateForDirectory(
    workspaceRoot: string,
    directoryPath: string,
    clearNotExistData: boolean,
  ): Promise<void> {
    // 收集当前目录下的所有图片
    const imagePaths = this.collectImages(workspaceRoot, directoryPath);
    if (imagePaths.length == 0) {
      Logger.d(`${path.basename(workspaceRoot)}:未找到需要生成引用的图片`);
      return;
    }
    this.doGenerateForImages(
      workspaceRoot,
      imagePaths,
      clearNotExistData,
      false,
    );
  }

  /**
   * 移除指定图片路径的引用
   * @param imagePath 图片相对于项目根目录的路径
   */
  static async pruneMissingReferences(workspaceRoot: string): Promise<void> {
    return ImageReferenceGenerator.enqueue(workspaceRoot, () =>
      this.doRemoveReference(workspaceRoot),
    );
  }

  /**
   * 剔除类文件中所有指向已不存在图片的引用
   * 只检查主目录（非变体目录）下的文件是否存在，变体目录的文件不作为保留依据
   * @returns 清理后的内容，以及被剔除的方法名列表
   */
  private static doPruneMissingReferences(
    workspaceRoot: string,
    content: string,
  ): { content: string; removed: string[] } {
    const removed: string[] = [];
    // dart format 可能把单引号改成双引号，两种引号都要匹配
    const regex =
      /\s*static\s+String\s+get\s+(\w+)\s*=>\s*(?:'([^']*)'|"([^"]*)")\s*;\n?/g;

    const pruned = content.replace(
      regex,
      (
        match,
        methodName: string,
        singleQuoted: string | undefined,
        doubleQuoted: string | undefined,
      ) => {
        const assetPath = singleQuoted ?? doubleQuoted ?? "";
        const imagePath = path.join(workspaceRoot, assetPath);
        // 只检查主目录文件是否存在，不检查变体
        if (fs.existsSync(imagePath)) {
          return match;
        }
        Logger.d(`剔除失效的图片引用: ${methodName} => ${assetPath}`);
        removed.push(methodName);
        return "";
      },
    );

    return { content: pruned, removed };
  }

  private static async doRemoveReference(workspaceRoot: string): Promise<void> {
    try {
      const classPath = this.getImagesClassPath(workspaceRoot);
      if (!fs.existsSync(classPath)) {
        return;
      }

      const pruned = this.doPruneMissingReferences(
        workspaceRoot,
        this.readImagesClassContent(workspaceRoot),
      );

      if (pruned.removed.length > 0) {
        await this.writeImagesClassContent(workspaceRoot, pruned.content);
        Logger.d(
          `${path.basename(workspaceRoot)}:已剔除 ${pruned.removed.length} 个失效的图片引用`,
        );
      }
    } catch (e) {
      Logger.e(`${path.basename(workspaceRoot)}:移除图片引用失败`, e);
    }
  }

  /**
   * 重新生成整个目录的图片引用（清空后重建）
   * @param directoryPath 目录绝对路径
   */
  static async regenerateForDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<void> {
    if (this.isInVariantDir(workspaceRoot, directoryPath)) {
      Logger.d(`跳过变体目录下的图片: ${directoryPath}`);
      return;
    }
    return ImageReferenceGenerator.enqueue(workspaceRoot, () =>
      this.doRegenerateForDirectory(workspaceRoot, directoryPath),
    );
  }

  private static async doRegenerateForDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<void> {
    // 收集当前目录下的所有图片
    const imagePaths = this.collectImages(workspaceRoot, directoryPath);
    if (imagePaths.length == 0) {
      Logger.d(`${path.basename(workspaceRoot)}:未找到需要生成引用的图片`);
      return;
    }
    this.doGenerateForImages(workspaceRoot, imagePaths, false, true);
  }

  /**
   * 为图片生成引用
   * @param imagePaths 图片的绝对路径
   */
  static async generateForImages(
    workspaceRoot: string,
    imagePaths: string[],
  ): Promise<void> {
    if (imagePaths.length == 0) {
      return;
    }

    return ImageReferenceGenerator.enqueue(workspaceRoot, () =>
      this.doGenerateForImages(workspaceRoot, imagePaths, false, false),
    );
  }

  private static async doGenerateForImages(
    workspaceRoot: string,
    imagePaths: string[],
    clearNotExistData: boolean,
    recreate: boolean,
  ): Promise<void> {
    try {
      // 确保 Images 类存在
      await this.ensureImagesClassExists(workspaceRoot);
      // 读取现有内容
      let content = this.readImagesClassContent(workspaceRoot);
      let deleteCount = 0;
      if (!recreate && clearNotExistData) {
        const pruned = this.doPruneMissingReferences(workspaceRoot, content);
        content = pruned.content;
        deleteCount = pruned.removed.length;
      }

      const className = this.getImagesClassName();
      // 如果没有内容，初始化基本结构
      if (!content.trim()) {
        content = `class ${className} {
  ${className}._inner();
}
`;
      } else if (recreate) {
        // 保留类定义结构，移除所有 getter 方法
        const regex =
          /\s*static\s+String\s+get\s+\w+\s*=>\s*('([^']*)'|"([^"]*)")\s*;\n?/g;
        content = content.replace(regex, "");
      }

      // 找出类定义的结束位置（最后一个 }）
      const lastBraceIndex = content.lastIndexOf("}");
      if (lastBraceIndex === -1) {
        Logger.e(
          `${path.basename(workspaceRoot)}:Images 类格式不正确，无法找到类定义结束位置"`,
        );
        return;
      }

      // 提取类定义的前后部分
      const beforeContent = content.substring(0, lastBraceIndex);
      const afterContent = content.substring(lastBraceIndex);

      // 生成新的 getter 方法
      let newMethods = "";
      let addedCount = 0;

      let endOfBreakLine = !beforeContent.trim().endsWith("\n");
      // 本次新增的方法名去重：不同文件归一化后可能得到相同名称，
      // 直接写入会生成重复 getter 导致编译错误
      const addedNames = new Set<string>();
      for (const imagePath of imagePaths) {
        const relativePath = path.relative(workspaceRoot, imagePath);
        const methodName = this.imageToMethodName(relativePath);

        if (addedNames.has(methodName)) {
          Logger.d(
            `图片引用名称重复，已跳过: ${relativePath} -> ${methodName}`,
          );
          continue;
        }

        // 检查是否已存在
        if (!recreate && this.methodExists(content, methodName)) {
          continue;
        }

        addedNames.add(methodName);
        newMethods += this.generateGetterMethod(relativePath, endOfBreakLine);
        endOfBreakLine = false;
        addedCount++;
      }

      if (addedCount === 0 && deleteCount == 0) {
        Logger.d(
          `${path.basename(workspaceRoot)}:所有图片引用已存在，无需更新`,
        );
        return;
      }

      // 重新组合内容
      const updatedContent = beforeContent + newMethods + afterContent;

      // 写入文件
      await this.writeImagesClassContent(workspaceRoot, updatedContent);

      Logger.d(
        `${path.basename(workspaceRoot)}:已为 ${addedCount} 个图片生成引用方法, 已删除${deleteCount}个无效图片引用方法`,
      );
    } catch (e) {
      Logger.e(`${path.basename(workspaceRoot)}:生成图片引用失败`, e);
    }
  }

  /**
   * 为图片资源目录生成引用方法(已存在则不处理，不存在添加，清空后重建)
   * 递归遍历 imageSrcPath 下所有层级的子目录，剔除磁盘上已不存在的条目、补齐缺失的条目
   * @param workspaceRoot 工作区根目录
   * @param imageSrcPath 图片源目录（相对于项目根目录）
   */
  static async syncAssetDirectories(
    workspaceRoot: string,
    imageSrcPath: string,
  ): Promise<void> {
    return ImageReferenceGenerator.enqueue(workspaceRoot, () =>
      this.doGenerateForDirectory(
        workspaceRoot,
        path.join(workspaceRoot, imageSrcPath),
        true,
      ),
    );
  }
}
