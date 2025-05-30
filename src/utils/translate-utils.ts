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

  /// 修复翻译错误，如占位符为大写，\n，%s翻译后被分开成 \ n,% s等错误
  static fixTranslateError(
    translate: string | null | undefined,
    useEscaping?: boolean,
    placeHolderCount?: number
  ): string | null {
    var translateStr = this.fixTranslatePlaceHolderStr(
      translate,
      useEscaping,
      placeHolderCount
    );
    translateStr = this.fixNewLineFormatError(translateStr);
    translateStr = translateStr?.replace('"', '"') ?? null;
    return translateStr;
  }

  /// 修复因翻译，导致占位符被翻译为大写的问题
  private static fixTranslatePlaceHolderStr(
    translate: string | null | undefined,
    useEscaping?: Boolean,
    placeHolderCount?: number
  ): string | null {
    if (!translate || translate.length == 0) {
      return null;
    }

    if (!placeHolderCount || placeHolderCount <= 0) {
      return translate;
    }

    var start = 0;
    var newValue = translate;
    for (let i = 0; i < placeHolderCount; i++) {
      let param = `{Param${i}}`;
      let index = translate.indexOf(param, start);
      if (index != -1) {
        if (useEscaping) {
          let index2 = translate.indexOf(`'${param}'`, start);
          if (index2 != -1) {
            if (index2 == index - 1) {
              continue;
            }

            newValue = newValue.replace(
              newValue.slice(index, index + param.length),
              `{param${i}}`
            );
          } else {
            newValue = newValue.replace(
              newValue.slice(index, index + param.length),
              `{param${i}}`
            );
          }
        } else {
          newValue = newValue.replace(
            newValue.slice(index, index + param.length),
            `{param${i}}`
          );
        }

        start = index + param.length;
      }
    }
    return newValue;
  }

  // 修复格式错误，如\n,翻译成 \ n
  static fixNewLineFormatError(text: string | null): string | null {
    if (!text || text.length == 0) {
      return text;
    }

    // \s+: 空行
    let regex = new RegExp(/\\\s+n/g); // \\\s+n
    return text.replaceAll(regex, "\\n");
  }
}
