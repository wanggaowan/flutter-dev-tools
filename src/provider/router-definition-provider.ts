import * as vscode from "vscode";
import { FlutterSdk, PublicOutline } from "../sdk";
import { disposeAll } from "../utils/utils";
import { executeDefinitionProvider } from "../utils/build-in-command-utils";
import Logger from "../utils/logger";
import { getNewGetPageRegex, getPageListRegex, pageParamRegex, strRegex } from "../utils/regexp-utils";

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
    // 匹配字符串""或''
    let matchAll = lineText.matchAll(strRegex);
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

    let outline: PublicOutline | undefined;
    try {
      outline = await dartSdk.getOutline(document);
      if (!outline) {
        return null;
      }
      outline = this.getClassOutline(outline, position);
      if (outline == null) {
        return null;
      }
    } catch (e: any) {
      Logger.showNotification(e.message, "warn");
      return null;
    }

    let pageList = this.getPageListInfo(outline);
    if (pageList.length == 0) {
      return null;
    }

    let isInMethod = true;
    for (const element of pageList) {
      if (element.range.contains(position)) {
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

  private getClassOutline(
    outline: PublicOutline | undefined,
    selection: vscode.Position
  ): PublicOutline | undefined {
    if (!outline) {
      return;
    }

    if (outline.element.kind == "CLASS" || outline.element.kind == "MIXIN") {
      if (outline.range.contains(selection)) {
        return outline;
      }
      return;
    }

    let children = outline.children;
    if (!children) {
      return;
    }

    for (const element of children) {
      let get = this.getClassOutline(element, selection);
      if (get) {
        return get;
      }
    }
  }

  private getPageListInfo(outline: PublicOutline) {
    let children = outline.children;
    let pageList: PublicOutline[] = [];
    if (!children) {
      return pageList;
    }

    for (const element of children) {
      let get = this.getPageList(element);
      if (get) {
        pageList.push(get);
      }
    }

    return pageList;
  }

  private getPageList(outline: PublicOutline) {
    if (outline.element.kind != "METHOD" && outline.element.kind != "FIELD") {
      return;
    }

    let returnType = outline.element.returnType;
    if (!returnType) {
      return;
    }

    if (returnType.match(getPageListRegex)) {
      return outline;
    }
  }

  private getMatchMethod(
    document: vscode.TextDocument,
    outline: PublicOutline,
    matchText: string,
    position: vscode.Position,
    originSelectionRange: vscode.Range
  ): vscode.DefinitionLink[] | null {
    let children = outline.children;
    if (!children) {
      return null;
    }

    let definitionList: vscode.DefinitionLink[] = [];
    for (const child of children) {
      if (child.element.kind == "METHOD") {
        let range = child.codeRange;
        if (range.contains(position)) {
          continue;
        }

        let text = document.getText(range);
        let matchAll = text.matchAll(strRegex);
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
    pageList: PublicOutline[],
    matchText: string,
    originSelectionRange: vscode.Range,
    token: vscode.CancellationToken
  ): Promise<vscode.DefinitionLink[] | null> {
    let regex = getNewGetPageRegex(matchText);
    let definitionList: vscode.DefinitionLink[] = [];
    for (const page of pageList) {
      if (token.isCancellationRequested) {
        return null;
      }

      let range = page.codeRange;
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

        let result = match[0].matchAll(pageParamRegex);
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
