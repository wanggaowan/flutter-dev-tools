import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createDefaultTemplates } from "./file-template-defaults";

/**
 * 模板中的目录/文件节点
 */
export interface TemplateChildEntity {
  name: string;
  content?: string;
  isFolder: boolean;
  children?: TemplateChildEntity[];
  // 编辑中尚未应用的内容，仅存在于界面内存中，不持久化
  tempContent?: string;
}

/**
 * 模板实体
 */
export interface TemplateEntity {
  name: string;
  // true: 模板名称同时作为目录创建；false: 仅作为模板分类
  createFolder: boolean;
  children?: TemplateChildEntity[];
}

const TEMPLATE_DATA_KEY = "fileTemplates";
const TEMPLATE_VERSION_KEY = "fileTemplatesVersion";
const TEMPLATE_VERSION = 1;

/**
 * 文件模板工具类
 */
export class FileTemplateUtils {
  private constructor() {}

  /**
   * 初始化默认模板，插件升级新增的默认模板在此处追加
   */
  static initDefaultTemplate(context: vscode.ExtensionContext) {
    const version = context.globalState.get<number>(TEMPLATE_VERSION_KEY, 0);
    if (version >= TEMPLATE_VERSION) {
      return;
    }

    const list = FileTemplateUtils.getTemplateList(context);
    if (version <= 0) {
      // 版本1新增的内容
      list.push(...createDefaultTemplates());
    }

    void context.globalState.update(TEMPLATE_DATA_KEY, list);
    void context.globalState.update(TEMPLATE_VERSION_KEY, TEMPLATE_VERSION);
  }

  static getTemplateList(context: vscode.ExtensionContext): TemplateEntity[] {
    const value = context.globalState.get<unknown>(TEMPLATE_DATA_KEY);
    return FileTemplateUtils.sanitizeTemplates(value);
  }

  static saveTemplateList(
    context: vscode.ExtensionContext,
    list: unknown,
  ) {
    const data = FileTemplateUtils.sanitizeTemplates(list);
    void context.globalState.update(TEMPLATE_DATA_KEY, data);
  }

  /**
   * 清洗模板数据，剔除界面状态字段并保证结构完整
   */
  static sanitizeTemplates(value: unknown): TemplateEntity[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const result: TemplateEntity[] = [];
    for (const item of value) {
      const template = FileTemplateUtils.sanitizeTemplate(item);
      if (template) {
        result.push(template);
      }
    }
    return result;
  }

  private static sanitizeTemplate(value: any): TemplateEntity | undefined {
    if (!value || typeof value.name !== "string" || value.name.length === 0) {
      return undefined;
    }

    const template: TemplateEntity = {
      name: value.name,
      createFolder: value.createFolder === true,
    };
    const children = FileTemplateUtils.sanitizeChildren(value.children);
    if (children.length > 0) {
      template.children = children;
    }
    return template;
  }

  private static sanitizeChildren(value: any): TemplateChildEntity[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const result: TemplateChildEntity[] = [];
    for (const item of value) {
      if (!item || typeof item.name !== "string" || item.name.length === 0) {
        continue;
      }

      const node: TemplateChildEntity = {
        name: item.name,
        isFolder: item.isFolder === true,
      };
      if (typeof item.content === "string") {
        node.content = item.content;
      }
      const children = FileTemplateUtils.sanitizeChildren(item.children);
      if (children.length > 0) {
        node.children = children;
      }
      result.push(node);
    }
    return result;
  }

  /**
   * 匹配文本中的所有占位符
   */
  static getPlaceHolders(content: string): Set<string> {
    const set = new Set<string>();
    if (!content) {
      return set;
    }

    // 匹配 #开始，中间任意[A-Za-z0-9_]组合字符，#结束的字符
    const matches = content.match(/#[A-Za-z0-9_]*#/g);
    if (matches) {
      matches.forEach(item => set.add(item));
    }
    return set;
  }

  /**
   * 内置占位符
   */
  static buildBuiltinPlaceholders(date = new Date()): Record<string, string> {
    const year = date.getFullYear();
    const month = FileTemplateUtils.pad(date.getMonth() + 1);
    const day = FileTemplateUtils.pad(date.getDate());
    const hour = FileTemplateUtils.pad(date.getHours());
    const minute = FileTemplateUtils.pad(date.getMinutes());
    return {
      "#DATE#": `${year}-${month}-${day}`,
      "#TIME#": `${hour}:${minute}`,
      "#DATETIME#": `${year}-${month}-${day} ${hour}:${minute}`,
      "#USER#": process.env.USER ?? process.env.USERNAME ?? "",
    };
  }

  private static pad(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
  }

  /**
   * 根据模板创建文件
   * @param basePath 创建文件所在目录
   * @param createCopy 文件已存在时是否创建副本
   * @returns 创建的文件路径
   */
  static createFiles(
    basePath: string,
    template: TemplateEntity,
    placeholders: Record<string, string>,
    createCopy: boolean,
  ): string[] {
    const values: Record<string, string> = {
      ...FileTemplateUtils.buildBuiltinPlaceholders(),
      ...placeholders,
    };

    const created: string[] = [];
    let parentPath = basePath;
    if (template.createFolder) {
      parentPath = path.join(parentPath, template.name);
      fs.mkdirSync(parentPath, { recursive: true });
    }

    FileTemplateUtils.createChildFiles(
      parentPath,
      template.children,
      values,
      createCopy,
      created,
    );
    return created;
  }

  private static createChildFiles(
    parentPath: string,
    children: TemplateChildEntity[] | undefined,
    placeholders: Record<string, string>,
    createCopy: boolean,
    created: string[],
  ) {
    if (!children || children.length === 0) {
      return;
    }

    for (const child of children) {
      if (child.isFolder) {
        const folderPath = path.join(parentPath, child.name);
        fs.mkdirSync(folderPath, { recursive: true });
        FileTemplateUtils.createChildFiles(
          folderPath,
          child.children,
          placeholders,
          createCopy,
          created,
        );
        continue;
      }

      let content = child.tempContent ?? child.content ?? "";
      if (content.length > 0) {
        for (const [key, value] of Object.entries(placeholders)) {
          content = content.split(key).join(value);
        }
      }

      FileTemplateUtils.createFile(
        parentPath,
        child.name,
        content,
        createCopy,
        created,
      );
    }
  }

  private static createFile(
    parentPath: string,
    name: string,
    content: string,
    createCopy: boolean,
    created: string[],
  ) {
    const index = name.lastIndexOf(".");
    const baseName = index === -1 ? name : name.substring(0, index);
    const suffix = index === -1 ? "" : name.substring(index);

    for (let tryCount = 0; ; tryCount++) {
      const fileName = tryCount === 0 ? name : `${baseName}_${tryCount}${suffix}`;
      const filePath = path.join(parentPath, fileName);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, "utf-8");
        created.push(filePath);
        return;
      }

      if (!createCopy || tryCount > 20) {
        throw new Error(`文件已存在：${filePath}`);
      }
    }
  }
}
