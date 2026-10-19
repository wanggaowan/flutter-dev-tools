import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConfigUtils } from "./config-utils";
import { isImage, lowerCamelCase } from "./utils";
import { ImageVariantUtils } from "./image-variant-utils";
import Logger from "./logger";
import { ForamtUtils } from "./format-utils";
import { getStaticGetMethodRegex } from "./regexp-utils";

/**
 * 图片引用生成器
 * 根据图片文件生成 Dart 类的 getter 方法
 */
export class ImageReferenceGenerator {
  /**
   * 操作队列的尾部 Promise。
   * images.dart 的修改是「读取-变更-写回」过程，且写回是异步的（格式化 + save）；
   * 若并发执行，后一个任务可能读到前一个任务写入前的旧数据，导致更新丢失。
   * 因此所有修改操作都通过该队列串行执行。
   */
  private static opQueue: Promise<unknown> = Promise.resolve();

  /**
   * 将修改任务排入队列，串行执行。
   * 注意：入队的任务内部只能调用私有的 doXxx 方法，不能再调用公开的排队方法，否则会自我等待。
   */
  private static enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = ImageReferenceGenerator.opQueue.then(() => task());
    // 队列不能被单个失败任务中断
    ImageReferenceGenerator.opQueue = result.then(
      () => undefined,
      () => undefined,
    );
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
  private static imageToMethodName(imagePath: string): string {
    // 获取 imageSrcPath 配置
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (!imageSrcPath) {
      throw new Error("请在设置中配置图片资源目录路径 (imageSrcPath)");
    }

    // 去掉 imageSrcPath 前缀
    let relativePath = imagePath;
    const normalizedImageSrcPath = imageSrcPath.split(path.sep).join("/");
    const normalizedImagePath = imagePath.split(path.sep).join("/");

    if (normalizedImagePath.startsWith(normalizedImageSrcPath + "/")) {
      relativePath = normalizedImagePath.substring(
        normalizedImageSrcPath.length + 1,
      );
    }

    // 去掉文件扩展名
    relativePath = relativePath.replace(/\.[^/.]+$/, "");
    // 去掉变体目录
    relativePath = relativePath.replace(/\/[0-9]+\.[0-9]x\//g, "/");
    // 将特殊字符替换为下划线：/, @, -, . 等
    relativePath = relativePath.replace(/[@\/\-\.]/g, "_");

    // 使用 lowerCamelCase 转换为驼峰命名
    return lowerCamelCase(relativePath, false);
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
    imagePath: string,
    preAddSpaceLine: boolean,
  ): string {
    const methodName = this.imageToMethodName(imagePath);
    // 转换为 Unix 风格路径
    let unixPath = imagePath.split(path.sep).join("/");
    unixPath = unixPath.replace(/\/[0-9]+\.[0-9]x\//g, "/");
    return `${preAddSpaceLine ? "" : "\n"}\n  static String get ${methodName} => '${unixPath}';\n`;
  }

  /**
   * 收集指定目录下的所有图片文件（去重）
   * @param directoryPath 目录绝对路径
   * @returns 图片相对路径数组（相对于项目根目录）
   */
  private static collectImages(
    workspaceRoot: string,
    directoryPath: string,
  ): string[] {
    // key: 不带扩展名和变体的路径, value: 完整相对路径
    const images: Map<string, string> = new Map();

    if (!fs.existsSync(directoryPath)) {
      return [];
    }

    const scanDirectory = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 递归扫描子目录
          scanDirectory(fullPath);
        } else if (entry.isFile() && isImage(entry.name)) {
          // 计算相对于项目根目录的路径
          const relativePath = path.relative(workspaceRoot, fullPath);

          // 生成去重的 key：去掉变体目录（1.5x, 2.0x, 3.0x, 4.0x）和扩展名
          const withoutVariant = relativePath
            .replace(/\/[0-9]+\.[0-9]x\//g, "/")
            .replace(/\.[^/.]+$/, "");

          // 如果这个 key 不存在，或者当前路径更短（优先选择无变体的），则添加
          const existing = images.get(withoutVariant);
          if (!existing || relativePath.length < existing.length) {
            images.set(withoutVariant, relativePath);
          }
        }
      }
    };

    scanDirectory(directoryPath);
    return Array.from(images.values());
  }

  /**
   * 为指定目录下的所有图片生成引用
   * @param directoryPath 目录绝对路径
   */
  static async generateForDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<void> {
    return ImageReferenceGenerator.enqueue(() =>
      this.doGenerateForDirectory(workspaceRoot, directoryPath),
    );
  }

  private static async doGenerateForDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<void> {
    try {
      // 确保 Images 类存在
      await this.ensureImagesClassExists(workspaceRoot);

      // 收集所有图片
      const imagePaths = this.collectImages(workspaceRoot, directoryPath);

      if (imagePaths.length === 0) {
        Logger.d("未找到需要生成引用的图片");
        return;
      }

      // 读取现有内容
      let content = this.readImagesClassContent(workspaceRoot);
      const className = this.getImagesClassName();

      // 如果没有内容，初始化基本结构
      if (!content.trim()) {
        content = `class ${className} {
  ${className}._inner();
}
`;
      }

      // 找出类定义的结束位置（最后一个 }）
      const lastBraceIndex = content.lastIndexOf("}");
      if (lastBraceIndex === -1) {
        Logger.e("Images 类格式不正确，无法找到类定义结束位置");
        return;
      }

      // 提取类定义的前后部分
      const beforeContent = content.substring(0, lastBraceIndex);
      const afterContent = content.substring(lastBraceIndex);

      // 生成新的 getter 方法
      let newMethods = "";
      let addedCount = 0;

      let endOfBreakLine = !beforeContent.trim().endsWith("\n");
      for (const imagePath of imagePaths) {
        const methodName = this.imageToMethodName(imagePath);

        // 检查是否已存在
        if (this.methodExists(content, methodName)) {
          continue;
        }

        newMethods += this.generateGetterMethod(imagePath, endOfBreakLine);
        endOfBreakLine = false;
        addedCount++;
      }

      if (addedCount === 0) {
        Logger.d("所有图片引用已存在，无需更新");
        return;
      }

      // 重新组合内容
      const updatedContent = beforeContent + newMethods + afterContent;

      // 写入文件
      await this.writeImagesClassContent(workspaceRoot, updatedContent);

      Logger.d(`已为 ${addedCount} 个图片生成引用方法`);
    } catch (e) {
      Logger.e("生成图片引用失败", e);
    }
  }

  /**
   * 移除指定图片路径的引用
   * @param imagePath 图片相对于项目根目录的路径
   */
  static async doPruneMissingReferences(workspaceRoot: string): Promise<void> {
    return ImageReferenceGenerator.enqueue(() =>
      this.doRemoveReference(workspaceRoot, undefined),
    );
  }

  /**
   * 剔除类文件中所有指向已不存在图片的引用
   * 存在性按变体判断：基准目录或其变体子目录下仍有同名同扩展名的文件，就认为该引用有效。
   * 记录的路径是去掉变体目录后的基准路径，因此只有变体也存在时同样会被保留。
   * @returns 清理后的内容，以及被剔除的方法名列表
   */
  private static pruneMissingReferences(
    workspaceRoot: string,
    content: string,
  ): { content: string; removed: string[] } {
    const removed: string[] = [];
    const regex = /\s*static\s+String\s+get\s+(\w+)\s*=>\s*'([^']*)';\n?/g;

    const pruned = content.replace(
      regex,
      (match, methodName: string, assetPath: string) => {
        const imagePath = path.join(workspaceRoot, assetPath);
        if (!this.areAllVariantsDeleted(imagePath)) {
          return match;
        }
        Logger.d(`剔除失效的图片引用: ${methodName} => ${assetPath}`);
        removed.push(methodName);
        return "";
      },
    );

    return { content: pruned, removed };
  }

  /**
   * 移除指定图片路径的引用
   * @param imagePath 图片相对于项目根目录的路径
   */
  static async removeReference(
    workspaceRoot: string,
    imagePath: string,
  ): Promise<void> {
    return ImageReferenceGenerator.enqueue(() =>
      this.doRemoveReference(workspaceRoot, imagePath),
    );
  }

  private static async doRemoveReference(
    workspaceRoot: string,
    imagePath: string | undefined,
  ): Promise<void> {
    try {
      const classPath = this.getImagesClassPath(workspaceRoot);
      if (!fs.existsSync(classPath)) {
        return;
      }

      const methodName = imagePath
        ? this.imageToMethodName(imagePath)
        : undefined;
      // 移除本次目标前，先剔除所有已失效的图片引用
      const pruned = this.pruneMissingReferences(
        workspaceRoot,
        this.readImagesClassContent(workspaceRoot),
      );

      if (!methodName) {
        if (pruned.removed.length > 0) {
          await this.writeImagesClassContent(workspaceRoot, pruned.content);
          Logger.d(`已剔除 ${pruned.removed.length} 个失效的图片引用`);
        }
        return;
      }

      const content = pruned.content;
      // 匹配并删除对应的 getter 方法
      const regex = getStaticGetMethodRegex(methodName);

      const newContent = content.replace(regex, "");
      // 目标可能在清理阶段已被剔除，因此两者任一有变化都要写回
      if (newContent !== content || pruned.removed.length > 0) {
        await this.writeImagesClassContent(workspaceRoot, newContent);
        Logger.d(`已移除图片引用: ${methodName}`);
        if (pruned.removed.length > 0) {
          Logger.d(`已剔除 ${pruned.removed.length} 个失效的图片引用`);
        }
      }
    } catch (e) {
      Logger.e("移除图片引用失败", e);
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
    return ImageReferenceGenerator.enqueue(() =>
      this.doRegenerateForDirectory(workspaceRoot, directoryPath),
    );
  }

  private static async doRegenerateForDirectory(
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<void> {
    try {
      const classPath = this.getImagesClassPath(workspaceRoot);
      if (!fs.existsSync(classPath)) {
        await this.doGenerateForDirectory(workspaceRoot, directoryPath);
        return;
      }

      // 收集当前目录下的所有图片
      const imagePaths = this.collectImages(workspaceRoot, directoryPath);

      // 读取现有内容
      let content = this.readImagesClassContent(workspaceRoot);

      // 保留类定义结构，移除所有 getter 方法
      const regex =
        /\s*static\s+String\s+get\s+\w+\s*=>\s*('([^']*)'|"([^"]*)")\s*;\n?/g;
      let cleanedContent = content.replace(regex, "");

      // 找出类定义的结束位置
      const lastBraceIndex = cleanedContent.lastIndexOf("}");
      if (lastBraceIndex === -1) {
        Logger.e("Images 类格式不正确");
        return;
      }

      const beforeContent = cleanedContent.substring(0, lastBraceIndex);
      const afterContent = cleanedContent.substring(lastBraceIndex);

      // 重新生成所有 getter 方法
      let newMethods = "";
      for (const imagePath of imagePaths) {
        newMethods += this.generateGetterMethod(imagePath, false);
      }

      const updatedContent = beforeContent + newMethods + afterContent;
      await this.writeImagesClassContent(workspaceRoot, updatedContent);

      Logger.d(`已重新生成 ${imagePaths.length} 个图片引用`);
    } catch (e) {
      Logger.e("重新生成图片引用失败", e);
    }
  }

  /**
   * 为单个图片生成引用
   * @param imagePath 图片的绝对路径
   */
  static async generateForSingleImage(
    workspaceRoot: string,
    imagePath: string,
  ): Promise<void> {
    return ImageReferenceGenerator.enqueue(() =>
      this.doGenerateForSingleImage(workspaceRoot, imagePath),
    );
  }

  private static async doGenerateForSingleImage(
    workspaceRoot: string,
    imagePath: string,
  ): Promise<void> {
    try {
      // 确保 Images 类存在
      await this.ensureImagesClassExists(workspaceRoot);

      // 计算相对于项目根目录的路径
      const relativePath = path.relative(workspaceRoot, imagePath);

      // 读取现有内容
      let content = this.readImagesClassContent(workspaceRoot);
      const methodName = this.imageToMethodName(relativePath);

      // 检查是否已存在
      if (this.methodExists(content, methodName)) {
        Logger.d(`图片引用已存在: ${methodName}`);
        return;
      }

      // 找出类定义的结束位置
      const lastBraceIndex = content.lastIndexOf("}");
      if (lastBraceIndex === -1) {
        Logger.e("Images 类格式不正确，无法找到类定义结束位置");
        return;
      }

      // 提取类定义的前后部分
      const beforeContent = content.substring(0, lastBraceIndex);
      const afterContent = content.substring(lastBraceIndex);

      // 生成新的 getter 方法
      const endOfBreakLine = !beforeContent.trim().endsWith("\n");
      const newMethod = this.generateGetterMethod(relativePath, endOfBreakLine);

      // 重新组合内容
      const updatedContent = beforeContent + newMethod + afterContent;

      // 写入文件
      await this.writeImagesClassContent(workspaceRoot, updatedContent);

      Logger.d(`已为图片生成引用: ${methodName}`);
    } catch (e) {
      Logger.e("生成单个图片引用失败", e);
    }
  }

  /**
   * 检查指定图片的所有变体是否都已删除
   * 图片身份包含扩展名，foo.png 与 foo.webp 互不影响
   * @param deletedImagePath 已删除图片的绝对路径
   * @returns 如果所有变体都已删除则返回 true
   */
  private static areAllVariantsDeleted(deletedImagePath: string): boolean {
    return ImageVariantUtils.collectVariants(deletedImagePath).length === 0;
  }

  /**
   * 移除图片引用（仅当所有变体都删除时才移除）
   * @param deletedImagePath 已删除图片的绝对路径
   */
  static async removeReferenceIfAllVariantsDeleted(
    workspaceRoot: string,
    deletedImagePath: string,
  ): Promise<void> {
    return ImageReferenceGenerator.enqueue(async () => {
      try {
        // 检查是否所有变体都已删除
        if (!this.areAllVariantsDeleted(deletedImagePath)) {
          Logger.d("仍存在其他变体文件，保留图片引用");
          return;
        }

        // 所有变体都已删除，移除引用
        const relativePath = path.relative(workspaceRoot, deletedImagePath);
        await this.doRemoveReference(workspaceRoot, relativePath);
      } catch (e) {
        Logger.e("检查变体删除状态失败", e);
      }
    });
  }
}
