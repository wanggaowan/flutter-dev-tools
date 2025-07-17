import * as vscode from "vscode";
import * as fs from "fs";
import pathUtils from "path";
import { FlutterSdk } from "../sdk";
import { disposeAll } from "../utils/utils";
import { ConfigUtils } from "../utils/config-utils";
import {
  getStaticGetMethodRegex,
  imageRefRegex,
  strRegex,
} from "../utils/regexp-utils";

/**
 * 国际化语言跳转定义位置实现
 */
export class ImageDocHoverProvider
  implements vscode.HoverProvider, vscode.Disposable
{
  private disposableList: vscode.Disposable[] = [];

  constructor(private readonly sdk: FlutterSdk) {
    let disposable = vscode.languages.registerHoverProvider(
      { language: "dart", scheme: "file" },
      this
    );
    this.disposableList.push(disposable);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    return this.genDoc(document, position, token);
  }

  async genDoc(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    let imagesFilePath = ConfigUtils.imagesFilePath;
    if (!imagesFilePath || imagesFilePath.length == 0) {
      return null;
    }

    imagesFilePath = pathUtils.join(this.sdk.workspace.fsPath, imagesFilePath);
    let imageRelPath: string[] = [];
    if (imagesFilePath == document.uri.fsPath) {
      let textLine = document.lineAt(position);
      let text = document.getText(textLine.range);
      let matchAll = text.matchAll(strRegex);
      if (!matchAll) {
        return null;
      }

      for (const element of matchAll) {
        if (element) {
          let text2 = element[0];
          if (
            element.index <= position.character &&
            position.character <= element.index + text2.length
          ) {
            let value = text2.replaceAll('"', "").replaceAll("'", "").trim();
            if (value.length > 0) {
              imageRelPath.push(value);
            }
          }
        }
      }
    } else {
      if (!fs.existsSync(imagesFilePath)) {
        return null;
      }

      let textLine = document.lineAt(position.line);
      let text = document.getText(textLine.range);
      let matchAll = text.matchAll(imageRefRegex);
      if (!matchAll) {
        return null;
      }

      if (token.isCancellationRequested) {
        return null;
      }

      let matchText: string | null = null;
      for (const element of matchAll) {
        if (element) {
          let text2 = element[0];
          if (
            element.index <= position.character &&
            position.character <= element.index + text2.length
          ) {
            matchText = text2;
            break;
          }
        }
      }

      if (!matchText || matchText.length == 0) {
        return null;
      }

      let splits = matchText.split(".");
      let key = splits[splits.length - 1];
      let regex = getStaticGetMethodRegex(key);
      let fileContent = fs.readFileSync(imagesFilePath, "utf-8");
      if (token.isCancellationRequested) {
        return null;
      }

      matchAll = fileContent.matchAll(regex);
      if (!matchAll) {
        return null;
      }

      for (const element of matchAll) {
        if (element) {
          let text2 = element[0];
          let keyValue = text2.split("=>");
          if (keyValue.length == 2) {
            let value = keyValue[1]
              .replaceAll('"', "")
              .replaceAll("'", "")
              .replaceAll("\n", "")
              .replaceAll("\r", "")
              .trim();
            if (value.length > 0) {
              imageRelPath.push(value);
            }
          }
        }
      }
    }

    if (imageRelPath.length == 0) {
      return null;
    }

    let doc: vscode.MarkdownString[] = [];
    for (let element of imageRelPath) {
      if (token.isCancellationRequested) {
        return null;
      }

      let relPath = element;
      let indexOf = element.lastIndexOf("/");
      if (indexOf != -1) {
        let folder = element.substring(0, indexOf);
        let name = element.substring(indexOf + 1);
        let find = this.findHighImage(folder, name, [
          "3.0x",
          "4.0x",
          "2.0x",
          "1.5x",
        ]);
        if (find) {
          relPath = find;
        }
      }

      let pathStr = pathUtils.join(this.sdk.workspace.path, relPath);
      let openPath = pathUtils.join(this.sdk.workspace.path, element);
      if (!fs.existsSync(openPath)) {
        openPath = pathStr;
      }

      let markdown = new vscode.MarkdownString(
        `[${element}](${openPath})\n\n![](${pathStr})\n`
      );
      markdown.isTrusted = true;
      doc.push(markdown);
    }
    return new vscode.Hover(doc);
  }

  private findHighImage(folder: string, name: string, variants: string[]) {
    for (const variant of variants) {
      let path = pathUtils.join(this.sdk.workspace.path, folder, variant, name);
      if (fs.existsSync(path)) {
        return pathUtils.join(folder, variant, name);
      }
    }
  }
}
