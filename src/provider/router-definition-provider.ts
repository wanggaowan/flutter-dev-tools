import * as vscode from "vscode";
import { DartSdk, FlutterSdk, Outline } from "../sdk";
import { disposeAll } from "../utils/utils";
import { executeDefinitionProvider } from "../utils/build-in-command-utils";

/**
 * 路由跳转定义位置实现
 */
export class RouterDefinitionProvider
  implements vscode.DefinitionProvider, vscode.Disposable
{
  private disposableList: vscode.Disposable[] = [];

  constructor(private readonly sdk: FlutterSdk) {
    let disposable = vscode.languages.registerDefinitionProvider(
      { language: "dart", scheme: "file" },
      this
    );
    this.disposableList.push(disposable);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    return this.findDefinition(document, position, token);
  }

  async findDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | null> {
    let dartSdk = this.sdk.dartSdk;
    if (!dartSdk) {
      return null;
    }

    let line = document.lineAt(position.line);
    let lineText = document.getText(line.range);
    let matchAll = lineText.matchAll(
      new RegExp(/"((\\")|[^"])*"|'((\\')|[^'])*'/g)
    );
    if (!matchAll) {
      return null;
    }

    let matchText: string | undefined;
    let matchStartIndex = -1;
    let matchEndIndex = -1;
    for (const element of matchAll) {
      let text = element[0];
      if (
        element.index <= position.character &&
        element.index + text.length >= position.character
      ) {
        matchStartIndex = element.index + 1;
        matchEndIndex = element.index + text.length - 1;
        matchText = text.substring(1, text.length - 1);
        break;
      }
    }

    if (!matchText) {
      return null;
    }

    let originSelectionRange = new vscode.Range(
      position.with(position.line, matchStartIndex),
      position.with(position.line, matchEndIndex)
    );
    let outline = await dartSdk.waitForOutline(document);
    outline = this.getClassOutline(outline);
    if (!outline) {
      return null;
    }

    let pageList = this.getPageListInfo(outline);
    if (pageList.length == 0) {
      return null;
    }

    let isInMethod = true;
    for (const element of pageList) {
      if (DartSdk.range2VsRange(element.range).contains(position)) {
        isInMethod = false;
        break;
      }
    }

    if (!isInMethod) {
      return this.getMatchMethod(
        document,
        outline,
        matchText,
        position,
        originSelectionRange
      );
    }

    return this.getMatchList(
      document,
      pageList,
      matchText,
      originSelectionRange,
      token
    );
  }

  private getClassOutline(outline: Outline | undefined): Outline | undefined {
    if (!outline) {
      return;
    }

    if (outline.element.kind == "CLASS" || outline.element.kind == "MIXIN") {
      return outline;
    }

    let children = outline.children;
    if (!children) {
      return;
    }

    for (const element of children) {
      let get = this.getClassOutline(element);
      if (get) {
        return get;
      }
    }
  }

  private getPageListInfo(outline: Outline) {
    let children = outline.children;
    let pageList: Outline[] = [];
    if (children) {
      for (const element of children) {
        let get = this.getPageList(element);
        if (get) {
          pageList.push(get);
        }
      }
    }
    return pageList;
  }

  private getPageList(outline: Outline) {
    if (outline.element.kind != "METHOD" && outline.element.kind != "FIELD") {
      return;
    }

    let returnType = outline.element.returnType;
    if (!returnType) {
      return;
    }

    if (returnType.startsWith("List<GetPage")) {
      return outline;
    }
  }

  private getMatchMethod(
    document: vscode.TextDocument,
    outline: Outline,
    matchText: string,
    position: vscode.Position,
    originSelectionRange: vscode.Range
  ): vscode.DefinitionLink[] | null {
    let children = outline.children;
    if (!children) {
      return null;
    }

    let regex = new RegExp(/"((\\")|[^"])*"|'((\\')|[^'])*'/g);
    let definitionList: vscode.DefinitionLink[] = [];
    for (const child of children) {
      if (child.element.kind == "METHOD") {
        let range = DartSdk.range2VsRange(child.codeRange);
        if (range.contains(position)) {
          continue;
        }

        let text = document.getText(range);
        let matchAll = text.matchAll(regex);
        for (const match of matchAll) {
          let text2 = match[0];
          text2 = text2.substring(1, text2.length - 1);
          if (text2 == matchText) {
            let location: vscode.DefinitionLink = {
              targetUri: document.uri,
              targetRange: new vscode.Range(range.start, range.start),
              originSelectionRange: originSelectionRange,
            };
            definitionList.push(location);
          }
        }
      }
    }
    return definitionList.length == 0 ? null : definitionList;
  }

  private async getMatchList(
    document: vscode.TextDocument,
    pageList: Outline[],
    matchText: string,
    originSelectionRange: vscode.Range,
    token: vscode.CancellationToken
  ): Promise<vscode.DefinitionLink[] | null> {
    let regex = new RegExp(
      `GetPage[\\s]*?\\([\\s]*?name[\\s]*?:[\\s]*?('${matchText}'|"${matchText}")[\\s\\S]*?\\),`,
      "g"
    );
    let regex2 = new RegExp(/page:[\s]*\([\s\S]*\)[\s]*=>[\s\S]*?\)/g);
    let definitionList: vscode.DefinitionLink[] = [];
    for (const page of pageList) {
      if (token.isCancellationRequested) {
        return null;
      }

      let range = DartSdk.range2VsRange(page.codeRange);
      let text = document.getText(range);
      let matchAll = text.matchAll(regex);

      for (const match of matchAll) {
        let offset = document.offsetAt(range.start) + match.index;
        let pos = document.positionAt(offset);
        let location: vscode.DefinitionLink = {
          targetUri: document.uri,
          targetRange: new vscode.Range(pos, pos),
          originSelectionRange: originSelectionRange,
        };
        definitionList.push(location);

        let result = match[0].matchAll(regex2);
        for (const element of result) {
          offset += element.index;
          let indexOf = element[0].lastIndexOf("(");
          if (indexOf == -1) {
            break;
          }

          offset += indexOf - 1;
          pos = document.positionAt(offset);
          let locations = await executeDefinitionProvider(document.uri, pos);
          if (locations) {
            for (const location of locations) {
              if (location instanceof vscode.Location) {
                definitionList.push({
                  targetUri: location.uri,
                  targetRange: location.range,
                  originSelectionRange: originSelectionRange,
                });
              } else {
                let local: vscode.DefinitionLink = location;
                local.originSelectionRange = originSelectionRange;
                definitionList.push(location);
              }
            }
          }
          break;
        }
      }
    }
    return definitionList.length == 0 ? null : definitionList;
  }
}
