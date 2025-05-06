import * as vscode from "vscode";

class OpenFileUtils {
  static open(uri: any) {
    if (!uri) {
      return;
    }

    let url: vscode.Uri | null;
    if (uri instanceof vscode.Uri) {
      url = uri;
    } else if (typeof uri === "string") {
      url = vscode.Uri.parse(uri);
    } else {
      url = null;
    }

    if (url == null) {
      return;
    }

    vscode.commands.executeCommand("vscode.open",url);

    // if (this.isImage(url)) {
    //   this.openImage(url);
    // } else {
    //   this.openFile(url);
    // }
  }

  private static isImage(uri: vscode.Uri): boolean {
    let path = uri.path.toLowerCase();
    return (
      path.endsWith("png") ||
      path.endsWith("jpg") ||
      path.endsWith("jpeg") ||
      path.endsWith("webp") ||
      path.endsWith("gif") ||
      path.endsWith("svg") ||
      path.endsWith("webm") ||
      path.endsWith("bmp")
    );
  }

  private static openFile(filePath: vscode.Uri) {
    vscode.workspace.openTextDocument(filePath).then(
      (document) => {
        vscode.window.showTextDocument(document, { preview: true });
      },
      (error) => {}
    );
  }

  private static openImage(imageUri: vscode.Uri) {
    if (!imageUri) return;

    let name = imageUri.path;
    let indexOf = name.lastIndexOf("/");
    if (indexOf != -1) {
      name = name.substring(indexOf + 1);
    }

    // 创建webview面板
    const panel = vscode.window.createWebviewPanel(
      // 标识符
      "imagePreview",
      // 面板标题
      name,
      // 显示在编辑器的哪个部分
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      }
    );
    // 将磁盘上的路径转换为webview可以使用的URI
    const webviewUri = panel.webview.asWebviewUri(imageUri);
    // 设置HTML内容
    panel.webview.html = this.getWebviewContent(name, webviewUri.toString());
  }

  private static getWebviewContent(fileName: string, imageUrl: string) {
    return `<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>${fileName}</title>
            <style>
              body {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: var(--vscode-editor-background);
              }
              img {
                max-width: 100%;
                max-height: 100vh;
              }
            </style>
          </head>
          <body>
            <img src="${imageUrl}" alt="预览图片" id="image" />
          </body>
        </html>
        <script>
          var image = document.getElementById("image");
          var initialDistance = 0;
          var initialWidth = 0;
        
          image.addEventListener("touchstart", function (event) {
            var touch1 = event.touches[0];
            var touch2 = event.touches[1];
        
            // 计算初始距离和初始宽度
            initialDistance = Math.hypot(
              touch2.pageX - touch1.pageX,
              touch2.pageY - touch1.pageY
            );
            initialWidth = image.offsetWidth;
          });
        
          image.addEventListener("touchmove", function (event) {
            var touch1 = event.touches[0];
            var touch2 = event.touches[1];
        
            // 计算当前距离和缩放比例
            var currentDistance = Math.hypot(
              touch2.pageX - touch1.pageX,
              touch2.pageY - touch1.pageY
            );
            var scale = currentDistance / initialDistance;
        
            // 根据缩放比例调整图片大小
            image.style.width = initialWidth * scale + "px";
          });
        </script>`;
  }
}

export default OpenFileUtils;
