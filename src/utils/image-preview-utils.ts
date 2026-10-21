import * as vscode from "vscode";

/**
 * 图片预览工具类
 */
export class ImagePreviewUtils {
  private constructor() {}

  /**
   * 将本地图片路径转换为 WebView 可访问的资源 URI
   * 注意：图片所在目录必须包含在 WebView 的 localResourceRoots 中
   */
  static toWebviewUri(webview: vscode.Webview, filePath: string): string {
    return webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
  }
}
