import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConfigUtils } from "./config-utils";
import { isImage, lowerCamelCase } from "./utils";
import Logger from "./logger";
import { ForamtUtils } from "./format-utils";

/**
 * 图片引用生成器
 * 根据图片文件生成 Dart 类的 getter 方法
 */
export class ImageReferenceGenerator {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 获取 Images 类的完整路径
   */
  private getImagesClassPath(): string {
    const imagesFilePath = ConfigUtils.imagesFilePath;
    if (!imagesFilePath) {
      throw new Error("请在设置中配置图片引用类文件路径 (imagesFilePath)");
    }
    return path.join(this.workspaceRoot, imagesFilePath);
  }

  /**
   * 获取 Images 类名
   */
  private getImagesClassName(): string {
    return ConfigUtils.imagesClassName || "Images";
  }

  /**
   * 将图片路径转换为驼峰命名的方法名
   * @param imagePath 图片相对于项目根目录的路径（如：assets/images/ht/repair/fuwu.png）
   * @returns 驼峰命名的方法名（如：htRepairFuwu）
   */
  private imageToMethodName(imagePath: string): string {
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
  private async ensureImagesClassExists(): Promise<void> {
    const classPath = this.getImagesClassPath();
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
  private readImagesClassContent(): string {
    const classPath = this.getImagesClassPath();
    if (!fs.existsSync(classPath)) {
      return "";
    }
    return fs.readFileSync(classPath, "utf-8");
  }

  /**
   * 写入 Images 类内容
   */
  private async writeImagesClassContent(content: string): Promise<void> {
    const classPath = this.getImagesClassPath();
    const uri = vscode.Uri.file(classPath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
    ForamtUtils.formatDocument(uri);
  }

  /**
   * 检查某个方法名是否已存在于类中
   */
  private methodExists(content: string, methodName: string): boolean {
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
   * @returns 生成的 getter 方法字符串
   */
  private generateGetterMethod(imagePath: string): string {
    const methodName = this.imageToMethodName(imagePath);
    // 转换为 Unix 风格路径
    let unixPath = imagePath.split(path.sep).join("/");
    unixPath = unixPath.replace(/\/[0-9]+\.[0-9]x\//g, "/");
    return `\n  static String get ${methodName} => '${unixPath}';`;
  }

  /**
   * 收集指定目录下的所有图片文件（去重）
   * @param directoryPath 目录绝对路径
   * @returns 图片相对路径数组（相对于项目根目录）
   */
  private collectImages(directoryPath: string): string[] {
    const images: Map<string, string> = new Map(); // key: 不带扩展名和变体的路径, value: 完整相对路径

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
          const relativePath = path.relative(this.workspaceRoot, fullPath);

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
  async generateForDirectory(directoryPath: string): Promise<void> {
    try {
      // 确保 Images 类存在
      await this.ensureImagesClassExists();

      // 收集所有图片
      const imagePaths = this.collectImages(directoryPath);

      if (imagePaths.length === 0) {
        Logger.d("未找到需要生成引用的图片");
        return;
      }

      // 读取现有内容
      let content = this.readImagesClassContent();
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

      for (const imagePath of imagePaths) {
        const methodName = this.imageToMethodName(imagePath);

        // 检查是否已存在
        if (this.methodExists(content, methodName)) {
          continue;
        }

        newMethods += this.generateGetterMethod(imagePath);
        addedCount++;
      }

      if (addedCount === 0) {
        Logger.d("所有图片引用已存在，无需更新");
        return;
      }

      // 重新组合内容
      const updatedContent = beforeContent + newMethods + afterContent;

      // 写入文件
      await this.writeImagesClassContent(updatedContent);

      Logger.d(`已为 ${addedCount} 个图片生成引用方法`);
      Logger.showNotification(`已为 ${addedCount} 个图片生成引用方法`, "info");
    } catch (e) {
      Logger.e("生成图片引用失败", e);
      Logger.showNotification("生成图片引用失败", "error");
    }
  }

  /**
   * 移除指定图片路径的引用
   * @param imagePath 图片相对于项目根目录的路径
   */
  async removeReference(imagePath: string): Promise<void> {
    try {
      const classPath = this.getImagesClassPath();
      if (!fs.existsSync(classPath)) {
        return;
      }

      const methodName = this.imageToMethodName(imagePath);
      let content = this.readImagesClassContent();

      // 匹配并删除对应的 getter 方法
      const regex = new RegExp(
        `\\s*static\\s+String\\s+get\\s+${methodName}\\s*=>\\s*'[^']*';\\n?`,
        "g",
      );

      const newContent = content.replace(regex, "");

      if (newContent !== content) {
        await this.writeImagesClassContent(newContent);
        Logger.d(`已移除图片引用: ${methodName}`);
      }
    } catch (e) {
      Logger.e("移除图片引用失败", e);
    }
  }

  /**
   * 重新生成整个目录的图片引用（清空后重建）
   * @param directoryPath 目录绝对路径
   */
  async regenerateForDirectory(directoryPath: string): Promise<void> {
    try {
      const classPath = this.getImagesClassPath();
      if (!fs.existsSync(classPath)) {
        await this.generateForDirectory(directoryPath);
        return;
      }

      // 收集当前目录下的所有图片
      const imagePaths = this.collectImages(directoryPath);

      // 读取现有内容
      let content = this.readImagesClassContent();
      const className = this.getImagesClassName();

      // 保留类定义结构，移除所有 getter 方法
      const regex = /\s*static\s+String\s+get\s+\w+\s*=>\s*'[^']*';\n?/g;
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
        newMethods += this.generateGetterMethod(imagePath);
      }

      const updatedContent = beforeContent + newMethods + afterContent;
      await this.writeImagesClassContent(updatedContent);

      Logger.d(`已重新生成 ${imagePaths.length} 个图片引用`);
    } catch (e) {
      Logger.e("重新生成图片引用失败", e);
    }
  }

  /**
   * 为单个图片生成引用
   * @param imagePath 图片的绝对路径
   */
  async generateForSingleImage(imagePath: string): Promise<void> {
    try {
      // 确保 Images 类存在
      await this.ensureImagesClassExists();

      // 计算相对于项目根目录的路径
      const relativePath = path.relative(this.workspaceRoot, imagePath);

      // 读取现有内容
      let content = this.readImagesClassContent();
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
      const newMethod = this.generateGetterMethod(relativePath);

      // 重新组合内容
      const updatedContent = beforeContent + newMethod + afterContent;

      // 写入文件
      await this.writeImagesClassContent(updatedContent);

      Logger.d(`已为图片生成引用: ${methodName}`);
    } catch (e) {
      Logger.e("生成单个图片引用失败", e);
    }
  }

  /**
   * 检查指定图片的所有变体是否都已删除
   * @param deletedImagePath 已删除图片的绝对路径
   * @returns 如果所有变体都已删除则返回 true
   */
  private areAllVariantsDeleted(deletedImagePath: string): boolean {
    // 计算相对于项目根目录的路径
    const relativePath = path.relative(this.workspaceRoot, deletedImagePath);

    // 生成去重的 key：去掉变体目录和扩展名
    const withoutVariant = relativePath
      .replace(/\/[0-9]+\.[0-9]x\//g, "/")
      .replace(/\.[^/.]+$/, "");

    // 在 imageSrcPath 目录下查找是否还有其他变体文件
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (!imageSrcPath) {
      return true;
    }

    const fullPath = path.join(this.workspaceRoot, imageSrcPath);
    if (!fs.existsSync(fullPath)) {
      return true;
    }

    // 递归查找所有匹配的变体文件
    const hasOtherVariants = this.findVariantFiles(fullPath, withoutVariant);

    return !hasOtherVariants;
  }

  /**
   * 递归查找是否存在匹配的变体文件
   * @param dir 搜索目录
   * @param targetKey 目标 key（去掉变体和扩展名的路径）
   * @returns 如果找到变体文件返回 true
   */
  private findVariantFiles(dir: string, targetKey: string): boolean {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 递归搜索子目录
          if (this.findVariantFiles(fullPath, targetKey)) {
            return true;
          }
        } else if (entry.isFile()) {
          // 计算相对路径并生成 key
          const relativePath = path.relative(this.workspaceRoot, fullPath);
          const key = relativePath
            .replace(/\/[0-9]+\.[0-9]x\//g, "/")
            .replace(/\.[^/.]+$/, "");

          if (key === targetKey) {
            return true;
          }
        }
      }
    } catch (e) {
      Logger.e(`查找变体文件失败: ${dir}`, e);
    }

    return false;
  }

  /**
   * 移除图片引用（仅当所有变体都删除时才移除）
   * @param deletedImagePath 已删除图片的绝对路径
   */
  async removeReferenceIfAllVariantsDeleted(
    deletedImagePath: string,
  ): Promise<void> {
    try {
      // 检查是否所有变体都已删除
      if (!this.areAllVariantsDeleted(deletedImagePath)) {
        Logger.d("仍存在其他变体文件，保留图片引用");
        return;
      }

      // 所有变体都已删除，移除引用
      const relativePath = path.relative(this.workspaceRoot, deletedImagePath);
      await this.removeReference(relativePath);
    } catch (e) {
      Logger.e("检查变体删除状态失败", e);
    }
  }
}
