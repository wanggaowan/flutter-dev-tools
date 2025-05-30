import * as vscode from "vscode";
export class ConfigUtils {
  private constructor() {}

  /**
   * 获取默认的存放图片资源的目录
   */
  static get tabSize(): number {
    return vscode.workspace.getConfiguration("editor").tabSize ?? 4;
  }

  /**
   * 获取默认的存放图片资源的目录
   */
  static get imageSrcPath(): string | undefined {
    return vscode.workspace.getConfiguration("flutterDevTools").imageSrcPath;
  }

  /**
   * 获取生成图片引用类文件所在路径
   */
  static get imagesFilePath(): string | undefined {
    return vscode.workspace.getConfiguration("flutterDevTools").imagesFilePath;
  }

  /**
   * json转dart时，新生成的类后缀
   */
  static get classSuffix(): string {
    return (
      vscode.workspace.getConfiguration("flutterDevTools").classSuffix ?? ""
    );
  }

  /**
   * json转dart时，json value是否作为备注
   */
  static get genDoc(): boolean {
    return vscode.workspace.getConfiguration("flutterDevTools").genDoc ?? true;
  }

  /**
   * json转dart时，是否生成构造函数
   */
  static get genConstructor(): boolean {
    return (
      vscode.workspace.getConfiguration("flutterDevTools").genConstructor ??
      true
    );
  }

  /**
   * json转dart时，是否生成序列化方法
   */
  static get genSerialization(): boolean {
    return (
      vscode.workspace.getConfiguration("flutterDevTools").genSerialization ??
      true
    );
  }

  /**
   * 生成类序列化方法时，默认配置的@JsonSerializable(converters: xxx)中converters的值
   */
  static get converts(): string | undefined | null {
    return vscode.workspace.getConfiguration("flutterDevTools").converters;
  }

  /**
   * 提取多语言时，是否展示重命名弹窗
   */
  static get showRenameDialog(): boolean {
    return vscode.workspace.getConfiguration("flutterDevTools")
      .showRenameDialog;
  }
}
