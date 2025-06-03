import * as vscode from "vscode";
import { disposeAll } from "../../utils/utils";
import {
  COMMAND_EXTRACT_L10N,
  COMMAND_EXTRACT_L10N_AND_TRANSLATE,
} from "../../constants.contexts";
import Logger from "../../utils/logger";
import { getSdk } from "../../extension";
import pathUtils from "path";
import * as fs from "fs";
import * as yaml from "yaml";
import { TranslateUtils } from "../../utils/translate-utils";
import { ConfigUtils } from "../../utils/config-utils";
import { TerminalCommand } from "../terminal-command";

/**
 * 根据模板文件翻译其它arb文件
 */
export class ExtractL10n {
  private disposableList: vscode.Disposable[] = [];

  constructor() {
    let dispose = vscode.commands.registerCommand(COMMAND_EXTRACT_L10N, uri =>
      ExtractL10n.translate(false)
    );
    this.disposableList.push(dispose);

    dispose = vscode.commands.registerCommand(
      COMMAND_EXTRACT_L10N_AND_TRANSLATE,
      uri => ExtractL10n.translate(true)
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  static async translate(needTranslate: boolean) {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    let pos = editor.selection.active;
    let textLine = editor.document.lineAt(pos);
    let lineText = editor.document.getText(textLine.range);
    // 匹配""或''字符串
    let regex = new RegExp(/"((\\")|[^"])*"|'((\\')|[^'])*'/g);
    let matchAll = lineText.matchAll(regex);
    let matchText: string | undefined;
    let matchStartIndex = -1;
    let matchEndIndex = -1;
    for (const element of matchAll) {
      let text = element[0];
      if (
        element.index <= pos.character &&
        element.index + text.length >= pos.character
      ) {
        matchStartIndex = element.index;
        matchEndIndex = element.index + text.length;
        matchText = text.substring(1, text.length - 1);
        break;
      }
    }

    if (!matchText) {
      Logger.showNotification("请选择要提取的文本");
      return;
    }

    if (matchText.trim().length == 0) {
      Logger.showNotification("文本为空，无需翻译");
      return;
    }

    let sdk = getSdk();
    if (!sdk) {
      Logger.showNotification("dart sdk未初始化", "error");
      return;
    }

    let rootDirPath = sdk.workspace.path;
    let resDirPath = "lib/l10n";
    let resName = "app_en.arb";
    var useEscaping = false;
    let l10nFilePath = vscode.Uri.joinPath(sdk.workspace, "l10n.yaml");
    if (fs.existsSync(l10nFilePath.path)) {
      let contents = fs.readFileSync(l10nFilePath.fsPath, "utf-8");
      let result = yaml.parseDocument(contents);

      let projectDir = result.get("project-dir");
      if (
        typeof projectDir === "string" &&
        projectDir &&
        projectDir.length > 0
      ) {
        rootDirPath = projectDir;
      }

      let arbDir = result.get("arb-dir");
      if (typeof arbDir === "string" && arbDir && arbDir.length > 0) {
        resDirPath = arbDir;
      }

      let templateArbFile = result.get("template-arb-file");
      if (
        typeof templateArbFile === "string" &&
        templateArbFile &&
        templateArbFile.length > 0
      ) {
        resName = templateArbFile;
      }

      let useEscap = result.get("use-escaping");
      if (typeof useEscap === "boolean") {
        useEscaping = useEscap;
      } else if (typeof useEscap === "string") {
        useEscaping = "true" === useEscap;
      }
    }

    let tempArbFilePath = pathUtils.join(rootDirPath, resDirPath, resName);
    try {
      let stat = fs.statSync(tempArbFilePath);
      if (stat.isDirectory()) {
        Logger.showNotification(
          "未配置arb模板文件，请提供lib/l10n/app_en.arb模版文件或通过l10n.yaml配置",
          "error"
        );
        return;
      }
    } catch (e) {
      Logger.showNotification(
        "未配置arb模板文件，请提供lib/l10n/app_en.arb模版文件或通过l10n.yaml配置",
        "error"
      );
      return;
    }

    regex = new RegExp(/(\$[A-Za-z_][A-Za-z_0-9]*|\${.*})/g);
    let index = 0;
    let placeholderList: string[] = [];
    let keyTranslateText = matchText;
    while (true) {
      let match = matchText.match(regex);
      if (match) {
        let text: string = match[0];
        placeholderList.push(text);
        matchText = matchText.replace(text, `{param${index}}`);
        keyTranslateText = keyTranslateText.replace(text, "");
        index++;
      } else {
        break;
      }
    }

    let tempJsonObj: any;
    try {
      let content = fs.readFileSync(tempArbFilePath, "utf-8");
      if (content && content.length > 0) {
        tempJsonObj = JSON.parse(content);
      }
    } catch (e) {
      Logger.e(e);
    }

    let existKey: string | undefined;
    if (tempJsonObj) {
      for (const key of Object.keys(tempJsonObj)) {
        let value = tempJsonObj[key];
        if (value == matchText) {
          existKey = key;
          break;
        }
      }
    }

    if (existKey) {
      let range = new vscode.Range(
        pos.with(pos.line, matchStartIndex),
        pos.with(pos.line, matchEndIndex)
      );
      this.repleaceDocument(editor, existKey, placeholderList, range);
      return;
    }

    let tempLocale = tempJsonObj ? tempJsonObj["@@locale"] : undefined;
    if (!tempLocale) {
      Logger.showNotification(`模板文件${resName}未配置@@locale属性`, "error");
      return;
    }

    let arbs: TranslateClass[] = [
      new TranslateClass(tempArbFilePath, tempJsonObj, tempLocale),
    ];
    if (needTranslate) {
      let arbDir = pathUtils.join(rootDirPath, resDirPath);
      let files = fs.readdirSync(arbDir);
      for (const element of files) {
        if (element.toLowerCase().endsWith(".arb")) {
          arbs.push(new TranslateClass(pathUtils.join(arbDir, element)));
        }
      }
    }

    let result = await vscode.window.withProgress(
      {
        cancellable: true,
        location: vscode.ProgressLocation.Window,
        title: "Translate arb file",
      },
      async (progress, token) => {
        return ExtractL10n.doTranslate(
          matchText,
          keyTranslateText,
          placeholderList,
          tempLocale,
          arbs,
          useEscaping,
          progress,
          token
        );
      }
    );

    if (!result) {
      return;
    }

    let key: string | null | undefined = result.key;
    let keyInvalid = !key || key.length == 0;
    let find = false;
    if (!keyInvalid) {
      find = tempJsonObj[key!] != undefined;
    }
    let showRenameDialog = ConfigUtils.showRenameDialog;

    if (showRenameDialog || keyInvalid || find) {
      key = await vscode.window.showInputBox({
        value: key ?? undefined,
        placeHolder: "输入多语言key",
        prompt: keyInvalid
          ? "翻译失败，请手动输入多语言key"
          : find
          ? "已存在相同的key，请手动输入多语言key"
          : undefined,
        validateInput: value => {
          if (!value) return "key不能为空";
          if (tempJsonObj[value]) {
            return "已存在相同的key";
          }
          if (!this.isValidkey(value))
            return "只能包含字母、数字和下划线，且不能已数字开头";
          return null;
        },
      });

      if (!key) {
        return;
      }
    }

    let range = new vscode.Range(
      pos.with(pos.line, matchStartIndex),
      pos.with(pos.line, matchEndIndex)
    );
    await this.repleaceDocument(editor, key!, placeholderList, range);
    let errorMsg: string | undefined;
    for (const element of result.translateList) {
      if (element.value) {
        await this.writeTranslateResult(element.fileUri, key!, element.value);
      } else if (element.errosMsg) {
        if (errorMsg) {
          errorMsg += "\n" + element.errosMsg;
        } else {
          errorMsg = element.errosMsg;
        }
      }
    }
    if (errorMsg) {
      Logger.showNotification(errorMsg, "error");
    }
    TerminalCommand.genl10n();
  }

  static keyRegex = /^[A-Za-z_][a-zA-Z0-9]*/;
  private static isValidkey(key: string): boolean {
    return this.keyRegex.test(key);
  }

  // 替换文档中的文本为翻译后的key引用
  private static async repleaceDocument(
    editor: vscode.TextEditor,
    key: string,
    placeholderList: string[],
    range: vscode.Range
  ) {
    let content = `S.current.${key}`;
    if (placeholderList.length > 0) {
      content += "(";
      for (let i = 0; i < placeholderList.length; i++) {
        let value = placeholderList[i];
        if (value.startsWith("${")) {
          value = value.substring(2, value.length - 1).trim();
        } else {
          value = value.substring(1);
        }
        if (i > 0) {
          content += ", ";
        }
        content += value;
      }
      content += ")";
    }

    return editor.edit(edit => {
      edit.replace(range, content);
    });
  }

  private static async writeTranslateResult(
    uri: string,
    key: string,
    translate: string
  ) {
    var content = fs.readFileSync(uri, "utf-8");
    var obj = JSON.parse(content);
    obj[key] = translate;
    fs.writeFileSync(uri, JSON.stringify(obj, null, 2), "utf-8");
  }

  private static async doTranslate(
    translateText: string,
    keyTranslateText: string,
    placeholderList: string[],
    sourceLanguage: string,
    translateList: TranslateClass[],
    useEscaping: boolean,
    progress: vscode.Progress<{
      message?: string;
      increment?: number;
    }>,
    token: vscode.CancellationToken
  ) {
    progress.report({
      message: `Translating key...}`,
    });

    let enTranslate = await TranslateUtils.translate(
      sourceLanguage,
      "en",
      keyTranslateText
    );

    if (token.isCancellationRequested) {
      return;
    }

    let isFormat = placeholderList.length > 0;
    let key = this.mapStrToKey(enTranslate, isFormat);
    let count = 1;
    let total = translateList.length;
    for (let element of translateList) {
      if (token.isCancellationRequested) {
        return;
      }

      progress.report({
        message: `${count} / ${total} Translating: ${element.fileName}`,
      });

      if (!element.jsonObj) {
        element.parseJson();
      }

      if (!element.jsonObj) {
        element.errosMsg = `${element.fileName}解析失败，无法进行翻译`;
        continue;
      }

      if (!element.local) {
        element.parseLocal();
      }

      if (!element.local) {
        element.errosMsg = `${element.fileName}未配置@@locale属性，无法进行翻译`;
        continue;
      }

      if (element.local == sourceLanguage) {
        element.value = translateText;
        continue;
      }

      if (element.local == "en" && enTranslate && !isFormat) {
        element.value = enTranslate;
        continue;
      }

      element.value = await TranslateUtils.translate(
        sourceLanguage,
        element.local,
        translateText
      );

      if (!element.value) {
        element.errosMsg = `${element.fileName}翻译失败`;
        continue;
      }

      element.value = TranslateUtils.fixTranslateError(
        element.value,
        useEscaping,
        placeholderList.length
      );
    }

    return {
      key,
      translateList,
    };
  }

  private static mapStrToKey(
    str: string | null | undefined,
    isFormat: boolean
  ): string | null {
    var value = TranslateUtils.fixNewLineFormatError(str ?? null)?.replaceAll(
      "\\n",
      "_"
    );
    if (value == null || value.length == 0) {
      return null;
    }

    // \pP：中的小写p是property的意思，表示Unicode属性，用于Unicode正则表达式的前缀。
    //
    // P：标点字符
    //
    // L：字母；
    //
    // M：标记符号（一般不会单独出现）；
    //
    // Z：分隔符（比如空格、换行等）；
    //
    // S：符号（比如数学符号、货币符号等）；
    //
    // N：数字（比如阿拉伯数字、罗马数字等）；
    //
    // C：其他字符
    value = value
      .toLowerCase()
      .replace(new RegExp(/[\p{P}\p{S}]/gu), "_")
      .replaceAll(" ", "_");
    if (isFormat) {
      value += "_format";
    }

    value = value
      .replaceAll("_____", "_")
      .replaceAll("____", "_")
      .replaceAll("___", "_")
      .replaceAll("__", "_");

    if (value.startsWith("_")) {
      value = value.substring(1, value.length);
    }

    if (value.endsWith("_")) {
      value = value.substring(0, value.length - 1);
    }

    return value;
  }
}

class TranslateClass {
  value: string | undefined | null;
  errosMsg: string | undefined | null;
  constructor(
    readonly fileUri: string,
    public jsonObj?: any,
    public local?: string
  ) {}

  parseJson() {
    try {
      let content = fs.readFileSync(this.fileUri, "utf-8");
      if (content && content.length > 0) {
        this.jsonObj = JSON.parse(content);
      }
    } catch (e) {
      Logger.e(e);
    }
  }

  parseLocal() {
    if (!this.jsonObj) {
      return;
    }
    this.local = this.jsonObj["@@locale"];
  }

  get fileName(): string {
    return pathUtils.basename(this.fileUri);
  }
}
