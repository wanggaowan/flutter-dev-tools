import * as vscode from "vscode";
import { disposeAll } from "../../utils/utils";
import { COMMAND_TRANSLATE_ARB } from "../../constants.contexts";
import Logger from "../../utils/logger";
import { getSdk } from "../../extension";
import pathUtils from "path";
import * as fs from "fs";
import * as yaml from "yaml";
import { TranslateUtils } from "../../utils/translate-utils";

/**
 * 根据模板文件翻译其它arb文件
 */
export class TranslateArb {
  private disposableList: vscode.Disposable[] = [];

  constructor() {
    let dispose = vscode.commands.registerCommand(
      COMMAND_TRANSLATE_ARB,
      TranslateArb.translate
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  static async translate(uri: vscode.Uri | undefined) {
    if (!uri) {
      Logger.showNotification("请选择要翻译的arb文件");
      return;
    }

    let fsPath = uri.path;
    if (!fsPath.toLowerCase().endsWith(".arb")) {
      Logger.showNotification("请选择arb格式文件");
      return;
    }

    if (!fs.existsSync(uri.path)) {
      Logger.showNotification("选择的在磁盘上不存在", "error");
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

    if (uri.path === tempArbFilePath) {
      return;
    }

    let needTranslateObj: any;
    try {
      let content = fs.readFileSync(uri.path, "utf-8");
      if (!content || content.length == 0) {
        Logger.showNotification(
          `${pathUtils.basename(uri.path)}未配置@@locale属性`,
          "error"
        );
        return;
      }

      needTranslateObj = JSON.parse(content);
    } catch (e) {
      Logger.showNotification(
        `文件${pathUtils.basename(uri.path)}解析错误`,
        "error"
      );
      return;
    }

    let locale = needTranslateObj["@@locale"];
    if (!locale) {
      Logger.showNotification(
        `${pathUtils.basename(uri.path)}未配置@@locale属性`,
        "error"
      );
      return;
    }

    let tempJsonObj: any;
    try {
      let content = fs.readFileSync(uri.path, "utf-8");
      if (!content || content.length == 0) {
        Logger.showNotification(
          `模板文件${resName}未配置@@locale属性`,
          "error"
        );
        return;
      }
      tempJsonObj = JSON.parse(fs.readFileSync(tempArbFilePath, "utf-8"));
    } catch (e) {
      Logger.showNotification(`模板文件${resName}解析错误`, "error");
      return;
    }

    let tempLocale = tempJsonObj["@@locale"];
    if (!tempLocale) {
      Logger.showNotification(`模板文件${resName}未配置@@locale属性`, "error");
      return;
    }

    return vscode.window.withProgress(
      {
        cancellable: true,
        location: vscode.ProgressLocation.Window,
        title: "Translate arb file",
      },
      async (progress, token) => {
        return TranslateArb.doTranslate(
          tempLocale,
          tempJsonObj,
          locale,
          needTranslateObj,
          uri,
          useEscaping,
          progress,
          token
        );
      }
    );
  }

  private static async doTranslate(
    tempLocale: string,
    tempJsonObj: any,
    locale: string,
    needTranslateObj: any,
    needTranslateFileUri: vscode.Uri,
    useEscaping: boolean,
    progress: vscode.Progress<{
      message?: string;
      increment?: number;
    }>,
    token: vscode.CancellationToken
  ) {
    let keys = Object.keys(tempJsonObj);
    let needTranslateMap = new Map<string, string>();
    for (let key of keys) {
      if (key == "@@locale" || key.startsWith("@")) {
        continue;
      }

      if (needTranslateObj[key] == undefined) {
        needTranslateMap.set(key, tempJsonObj[key]);
      }
    }

    let total = needTranslateMap.size;
    if (total == 0 || token.isCancellationRequested) {
      if (total == 0) {
        Logger.showNotification("没有需要翻译的内容");
      }
      return;
    }

    let count = 1;
    let existTranslateFailed = false;
    for (const element of needTranslateMap.entries()) {
      progress.report({
        message: `${count} / ${total} Translating: ${element[0]}`,
      });

      let translateStr: string | undefined | null = element[1];
      translateStr =
        translateStr && translateStr.length > 0
          ? await TranslateUtils.translate(tempLocale, locale, element[1])
          : translateStr;

      if (translateStr) {
        let placeHolderCount = translateStr.indexOf("{Param") != -1 ? 5 : 0;
        translateStr = TranslateUtils.fixTranslateError(
          translateStr,
          useEscaping,
          placeHolderCount
        );
        if (translateStr) {
          await this.writeTranslateResult(
            needTranslateFileUri,
            element[0],
            translateStr
          );
        } else {
          existTranslateFailed = true;
        }
      } else {
        existTranslateFailed = true;
      }
      count++;
      if (token.isCancellationRequested) {
        break;
      }
    }
  }

  private static async writeTranslateResult(
    uri: vscode.Uri,
    key: string,
    translate: string
  ) {
    let path = uri.fsPath ?? uri.path;
    var content = fs.readFileSync(path, "utf-8");
    var obj = JSON.parse(content);
    obj[key] = translate;
    fs.writeFileSync(path, JSON.stringify(obj, null, 2), "utf-8");
  }
}
