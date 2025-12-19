/*
/\s/	  // 匹配任何空白字符，包括空格、制表符、换页符等等。等价于 [\f\n\r\t\v]。
/\S/    // 匹配非空格
/\x20/	// 匹配一个空格。
/\f/	  // 匹配一个换页符。
/\n/	  // 匹配一个换行符。
/\r/	  // 匹配一个回车符。
*/ 


// 匹配 import *;,允许;前换行回车
export const importRegex = new RegExp(/import[\S\s]*?;/g);

// 匹配 part *;,允许;前换行回车
export const partRegex = new RegExp(/part[\S\s]*?;/g);

// 匹配字符串""或''
export const strRegex = new RegExp(/"((\\")|[^"])*"|'((\\')|[^'])*'/g);

// 匹配字符中引用表达式，如：$userName 或${userName}
// (?<!\字符)用于匹配当前位置前不存在指定字符的情况
// 以下正则则匹配$前无反斜杠
export const strRefRegex = new RegExp(/((?<!\\)\$[A-Za-z_][A-Za-z_0-9]*|(?<!\\)\${.*?})/g);

// 匹配 S.current.xxx 或 S.of(xxx).xxx 格式字符串
export const strCallRegex = new RegExp(
  /S\s*.\s*(of\(.*\)|current)\s*.\s*[a-zA-Z_][a-zA-Z_0-9]*/g
);

// 匹配图片资源的引用，如Images.xxx，点号前后允许空格和换行
export const imageRefRegex = new RegExp(/Images\s*.\s*[a-zA-Z_][a-zA-Z_0-9]*/g);

// 匹配 List<GetPage>
export const getPageListRegex = new RegExp(/List<[\s\S]*?GetPage[\s\S]*?>/g);

// 匹配 page: () => xxx
export const pageParamRegex = new RegExp(
  /page:[\s]*\([\s\S]*\)[\s]*=>[\s\S]*?\)/g
);

// 匹配 "*": 格式
export const jsonKeyRegex = new RegExp(/".*"\s*:/g);

/// 匹配给定methodName的get方法，如static String get methodName => 'xxx'
export function getStaticGetMethodRegex(methodName: string) {
  return new RegExp(
    `static(\n|\r|\\s)+String(\n|\r|\\s)+get(\n|\r|\\s)+${methodName}(\n|\r|\\s)*=>(\n|\r|\\s)*(\'.*\'|\".*\")`,
    "g"
  );
}

/// 匹配GetPage(name:pageName)
export function getNewGetPageRegex(pageName: string) {
  return new RegExp(
    `GetPage[\\s]*?\\([\\s]*?name[\\s]*?:[\\s]*?('${pageName}'|"${pageName}")[\\s\\S]*?\\),`,
    "g"
  );
}
