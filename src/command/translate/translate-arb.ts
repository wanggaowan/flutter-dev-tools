import * as vscode from "vscode";
import { disposeAll } from "../../utils/utils";
import { COMMAND_TRANSLATE_ARB } from "../../constants.contexts";
import Logger from "../../utils/logger";
import { getSdk } from "../../extension";
import pathUtils from "path";
import * as fs from "fs";
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

    let fsPath = uri.fsPath;
    if (!fsPath.toLowerCase().endsWith(".arb")) {
      Logger.showNotification("请选择arb格式文件");
      return;
    }

    if (!fs.existsSync(fsPath)) {
      Logger.showNotification("选择的在磁盘上不存在", "error");
      return;
    }

    let sdk = getSdk();
    if (!sdk) {
      Logger.showNotification("dart sdk未初始化", "error");
      return;
    }

    // 当前 arb 文件可能属于子项目，按所在模块解析 l10n 配置
    const module = sdk.getModule(uri);
    if (!module) {
      Logger.showNotification("未识别Flutter项目", "error");
      return;
    }

    const l10nConfig = module.getL10nConfig();
    if (!l10nConfig) {
      Logger.showNotification(
        "未找到 l10n.yaml 配置，请提供lib/l10n/app_en.arb模版文件或通过l10n.yaml配置",
        "error"
      );
      return;
    }

    const resName = pathUtils.basename(l10nConfig.templateArbFilePath);
    var useEscaping = false;
    const useEscap = module.getL10nYaml()?.get("use-escaping");
    if (typeof useEscap === "boolean") {
      useEscaping = useEscap;
    } else if (typeof useEscap === "string") {
      useEscaping = "true" === useEscap;
    }

    let tempArbFilePath = l10nConfig.templateArbFilePath;
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

    if (fsPath === tempArbFilePath) {
      return;
    }

    let needTranslateObj: any;
    try {
      let content = fs.readFileSync(fsPath, "utf-8");
      if (!content || content.length == 0) {
        Logger.showNotification(
          `${pathUtils.basename(
            fsPath
          )}未配置@@locale属性或@@locale_alias属性`,
          "error"
        );
        return;
      }

      needTranslateObj = JSON.parse(content);
    } catch (e) {
      Logger.showNotification(
        `文件${pathUtils.basename(fsPath)}解析错误`,
        "error"
      );
      return;
    }

    let locale =
      needTranslateObj["@@locale_alias"] ?? needTranslateObj["@@locale"];
    if (!locale) {
      Logger.showNotification(
        `${pathUtils.basename(fsPath)}未配置@@locale属性或@@locale_alias属性`,
        "error"
      );
      return;
    }

    let tempJsonObj: any;
    try {
      let content = fs.readFileSync(fsPath, "utf-8");
      if (!content || content.length == 0) {
        Logger.showNotification(
          `模板文件${resName}未配置@@locale属性或@@locale_alias属性`,
          "error"
        );
        return;
      }
      tempJsonObj = JSON.parse(fs.readFileSync(tempArbFilePath, "utf-8"));
    } catch (e) {
      Logger.showNotification(`模板文件${resName}解析错误`, "error");
      return;
    }

    let tempLocale = tempJsonObj["@@locale_alias"] ?? tempJsonObj["@@locale"];
    if (!tempLocale) {
      Logger.showNotification(
        `模板文件${resName}未配置@@locale属性或@@locale_alias属性`,
        "error"
      );
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
    let needTranslateMap = new Map<string, any>();
    for (let key of keys) {
      // 跳过 @@locale、@@locale_alias 等本地化元数据，目标文件保留自己的值
      if (key.startsWith("@@")) {
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
      let key = element[0];
      let value = element[1];
      progress.report({
        message: `${count} / ${total} Translating: ${key}`,
      });

      if (typeof value !== "string") {
        // @key 等元数据对象无需翻译，原样写入后继续处理后续 key
        await this.writeTranslateResult(
          needTranslateFileUri,
          element[0],
          value
        );
        count++;
        if (token.isCancellationRequested) {
          break;
        }
        continue;
      }

      value =
        value && value.length > 0
          ? await TranslateUtils.translate(tempLocale, locale, value)
          : value;

      if (value) {
        value = TranslateUtils.fixTranslateError(value, useEscaping, true);
        if (value) {
          await this.writeTranslateResult(
            needTranslateFileUri,
            element[0],
            value
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

    if (existTranslateFailed) {
      Logger.showNotification("存在部分内容未翻译或插入成功，请重试", "warn");
    }
  }

  private static async writeTranslateResult(
    uri: vscode.Uri,
    key: string,
    translate: any
  ) {
    let path = uri.fsPath ?? uri.path;
    var content = fs.readFileSync(path, "utf-8");
    var obj = JSON.parse(content);
    obj[key] = translate;
    fs.writeFileSync(path, JSON.stringify(obj, null, 2), "utf-8");
  }
}
