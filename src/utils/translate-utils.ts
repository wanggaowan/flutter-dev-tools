import alimt20181012, * as $alimt20181012 from "@alicloud/alimt20181012";
import OpenApi, * as $OpenApi from "@alicloud/openapi-client";

export class TranslateUtils {
  private static client: alimt20181012 | undefined;
  private static async createClient(
    accessKeyId: string,
    accessKeySecret: string
  ): Promise<alimt20181012> {
    let config = new $OpenApi.Config({
      accessKeyId: accessKeyId,
      accessKeySecret: accessKeySecret,
      regionId: "cn-hangzhou",
    });
    return new alimt20181012(config);
  }

  static async translate(
    sourceLanguage: string,
    targetLanguage: string,
    text: string
  ) {
    if (!TranslateUtils.client) {
      TranslateUtils.client = await TranslateUtils.createClient(
        this.mapValue("TFRBSTV0UnFrbzY3QThVeFZDOGt4dHNu"),
        this.mapValue("V3FWRGI3c210UW9rOGJUOXF2VHhENnYzbmF1bjU1")
      );
    }

    let request = new $alimt20181012.TranslateGeneralRequest({
      formatType: "text",
      sourceLanguage,
      targetLanguage,
      sourceText: text,
      scene: "general",
    });
    let response = await TranslateUtils.client.translateGeneral(request);
    if (response.body.code != 200) {
      return null;
    }
    return response.body.data?.translated;
  }

  private static mapValue(value: String): string {
    return Buffer.from(value, "base64").toString();
  }

  /**
   * 修复翻译后格式错误，如占位符为大写，\n，%s翻译后被分开成 \ n,% s等错误
   *
   * @param useEscaping arb文件是否启用转义字符
   * @param isByTemplate 是否根据模板翻译
   */
  static fixTranslateError(
    translate: string | null | undefined,
    useEscaping?: boolean,
    isByTemplate: Boolean = false
  ): string | null {
    var translateStr = this.fixTranslatePlaceHolderStr(
      translate,
      useEscaping,
      isByTemplate
    );
    translateStr = this.fixNewLineFormatError(translateStr);
    if (translateStr) {
      // 处理单引号多余的转义斜杠。以下正则匹配单引号前面的反斜杠
      var regex = RegExp(/[\\\x20]*'/g);
      translateStr = this.fixEscapeFormatError(regex, translateStr, false);
      // 处理双引号缺失的转义斜杠。以下正则匹配双引号前面的反斜杠。以下注释是因为写入文件时，通过JSON.stringify会处理双引号转义
      // regex = RegExp(/[\\\s]*"/g);
      // translateStr = this.fixEscapeFormatError(regex, translateStr);

      translateStr = this.inseartWhiteSpace(translateStr, useEscaping);
    }
    return translateStr;
  }

  // 修复因翻译，导致占位符被翻译为大写，字符中间增加空格等问题
  private static fixTranslatePlaceHolderStr(
    translate: string | null | undefined,
    useEscaping: Boolean = false,
    isByTemplate: Boolean = false
  ): string | null {
    if (!translate || translate.length == 0) {
      return null;
    }

    let regex: RegExp;
    if (isByTemplate) {
      if (useEscaping) {
        regex = RegExp(
          /((['\x20]+\x20*\{\x20*[Pp]aram[0-9]*\x20*\}\x20*['\x20]+)|(\{\x20*[Pp]aram[0-9]*\x20*\}))/g
        );
      } else {
        regex = RegExp(/\{\x20*[Pp]aram[0-9]*\x20*\}/g);
      }
    } else if (useEscaping) {
      regex = RegExp(/<\x20*[Pp]aram[0-9]*\x20*>/g);
    } else {
      regex = RegExp(/\{\x20*[Pp]aram[0-9]*\x20*\}/g);
    }

    translate = this.fixWhiteFormatError(
      regex,
      translate,
      useEscaping,
      isByTemplate
    );

    if (useEscaping) {
      let matchResult: RegExpMatchArray | null;
      if (isByTemplate) {
        // 查找单引号，但前后不能是{或}
        let regex = RegExp(/(?<![{}]\x20*)('+[\x20']*)(?!\x20*[{}])/g);
        do {
          matchResult = regex.exec(translate);
          if (matchResult != null) {
            let placeHolder = matchResult[0];
            let oldLength = placeHolder.length;
            let placeHolder2 = placeHolder.replaceAll("'", "");
            if (oldLength - placeHolder2.length == 1) {
              // 仅处理单引号只有一个的数据，存在连续多个单引号不处理
              placeHolder = placeHolder.replaceAll("'", "''");
              translate = this.replaceRange(
                translate,
                matchResult.index!,
                oldLength,
                placeHolder
              );
            }
            regex.lastIndex = matchResult.index! + placeHolder.length;
          }
        } while (matchResult != null);
      } else {
        // 不是根据模板翻译且启用转义的情况下，如果文本中出现单引号，需要再追加一个单引号进行转义
        translate = translate.replaceAll("'", "''");
        // 需要对出现的{进行转义
        translate = translate.replaceAll("{", "'{'");
        // 需要对出现的}进行转义
        translate = translate.replaceAll("}", "'}'");
        translate = this.replacePlaceHolder(
          RegExp(/<param[0-9]*>/g),
          translate
        );
      }
    }

    return translate;
  }

  // 在{，}前后插入空格
  private static inseartWhiteSpace(
    translate: string,
    useEscaping: Boolean = false
  ): string {
    if (!useEscaping || translate.length == 0) {
      return translate;
    }

    let matchResult: RegExpMatchArray | null;
    // 如果{前面存在单引号且不止一个，则需要在离{最近的单引号前加空格，否则此转义单引号会被当做普通单引号字符处理
    let regex = RegExp(/\x20*'\x20*\{/g);
    do {
      matchResult = regex.exec(translate);
      if (matchResult != null) {
        var placeHolder = matchResult[0];
        if (!placeHolder.startsWith(" ")) {
          let start = matchResult.index!;
          if (start > 0) {
            let str = translate.substring(start - 1, start);
            if (str == "'") {
              placeHolder = ` ${placeHolder}`;
              translate = this.replaceRange(
                translate,
                matchResult.index!,
                placeHolder.length - 1,
                placeHolder
              );
            }
          }
        }
        regex.lastIndex = matchResult.index! + placeHolder.length;
      }
    } while (matchResult != null);

    // 如果}后面存在单引号且不止一个，则需要在离}最近的单引号后加空格，否则此转义单引号会被当做普通单引号字符处理
    regex = RegExp(/\}\x20*'\x20*/g);
    do {
      matchResult = regex.exec(translate);
      if (matchResult != null) {
        var placeHolder = matchResult[0];
        if (!placeHolder.endsWith(" ")) {
          let end = matchResult.index! + placeHolder.length;
          if (end < translate.length) {
            let str = translate.substring(end + 1, end + 2);
            if (str == "'") {
              placeHolder = `${placeHolder} `;
              translate = this.replaceRange(
                translate,
                matchResult.index!,
                placeHolder.length - 1,
                placeHolder
              );
            }
          }
        }
        regex.lastIndex = matchResult.index! + placeHolder.length;
      }
    } while (matchResult != null);

    return translate;
  }

  // 修复格式错误，如\n,翻译成 \ n
  static fixNewLineFormatError(text: string | null): string | null {
    if (!text || text.length == 0) {
      return text;
    }

    let regex = new RegExp(/\x20*\\\x20*[nN]\x20*/g);
    text = text.replaceAll(regex, "\\n");
    return text;
  }

  /**
   * 修复多了空格、大小写错误，比如%s翻译后是%S，\n翻译后是\N，或者中间有空格如% s，\ n等
   *
   * [text]为需要修复的文本
   * [regex]为查找错误格式文本的正则表达式
   */
  private static fixWhiteFormatError(
    regex: RegExp,
    text: string,
    useEscaping: Boolean = false,
    isByTemplate: Boolean = false
  ): string {
    if (text.length == 0) {
      return text;
    }

    let matchResut = regex.exec(text);
    if (!matchResut) {
      return text;
    }

    var placeHolder = matchResut[0];
    var needReplace = true;
    if (isByTemplate && useEscaping) {
      let start = placeHolder.indexOf("{");
      let end = placeHolder.indexOf("}");
      // 起始单引号数量
      let startSymbolCount = placeHolder
        .substring(0, start)
        .replaceAll(" ", "").length;
      // 尾部单引号数量
      let endSymbolCount = placeHolder
        .substring(end + 1)
        .replaceAll(" ", "").length;
      if (startSymbolCount != endSymbolCount || startSymbolCount % 2 != 0) {
        // 使用了转义字符包裹占位符，保持原样
        // startSymbolCount != endSymbolCount,此时dart执行gen-l10n命令时会报错，启用转义时，单引号要成对出现，因此不处理
        // startSymbolCount % 2 != 0,单引号为奇数个，存在一对单引号用来转义{}占位符
        needReplace = false;
      }
    }

    let length = placeHolder.length;
    if (needReplace) {
      let oldLength = placeHolder.length;
      placeHolder = placeHolder.replaceAll(" ", "").toLowerCase();
      length -= oldLength - placeHolder.length;
      text = this.replaceRange(text, matchResut.index!, oldLength, placeHolder);
    }

    // 跳过指定长度后开始匹配文本
    regex.lastIndex = matchResut.index! + length;
    return this.fixWhiteFormatError(regex, text, useEscaping, isByTemplate);
  }

  /**
   * 替换占位符，当不是根据模版翻译时，需要将<param0>替换为{param0}
   */
  private static replacePlaceHolder(regex: RegExp, text: string): string {
    if (text.length == 0) {
      return text;
    }

    let matchResult = regex.exec(text);
    if (!matchResult) {
      return text;
    }

    let placeHolder = matchResult[0];
    let oldLength = placeHolder.length;
    placeHolder = placeHolder.replaceAll("<", "{").replaceAll(">", "}");
    return this.replacePlaceHolder(
      regex,
      this.replaceRange(text, matchResult.index, oldLength, placeHolder)
    );
  }

  /**
   * 修复转义错误，比如'，"未加反斜杠或反斜杠数量多了
   *
   * [text] 为需要修复的文本
   * [regex] 为查找错误格式文本的正则表达式
   * [isAdd] 表示是添加还是去除反斜杠
   */
  static fixEscapeFormatError(
    regex: RegExp,
    text: string,
    isAdd: Boolean = true,
    isLineBreaks = false,
  ): string {
    if (text.length == 0) {
      return text;
    }

    let matchResult = regex.exec(text);
    if (!matchResult) {
      return text;
    }

    var placeHolder = matchResult[0];
    let oldLength = placeHolder.length;
    placeHolder = placeHolder.replaceAll(" ", "");

    let count = 0;
    for (let i = 0; i < placeHolder.length; i++) {
      if (placeHolder[i] === "\\") {
        count++;
      }
    }

    if (isAdd) {
      if (count % 2 == 0) {
        // 新增转义字符时，只有之前存在偶数个时才处理
        placeHolder = `\\${placeHolder}`;
      }
    } else if (count % 2 != 0) {
      // 移除转义字符时，只有之前存在奇数个时才处理
      placeHolder = placeHolder.substring(1, placeHolder.length);

    }

    regex.lastIndex =
      matchResult.index! + oldLength + (placeHolder.length - oldLength);
    return this.fixEscapeFormatError(
      regex,
      this.replaceRange(text, matchResult.index, oldLength, placeHolder),
      isAdd
    );
  }

  private static replaceRange(
    str: string,
    start: number,
    length: number,
    replacement: string
  ): string {
    return (
      str.substring(0, start) + replacement + str.substring(start + length)
    );
  }
}
