export const EXTENSION_NAME = "FlutterDevTools";

export const IS_FLUTTER_PROJECT = "flutterDevTools.isFlutterProject";
export const EXIST_VSCODEFLUTTERTOOL = "flutterDevTools.exist.vscodefluttertool";

// flutter项目视图上下文常量
export const PROJECT_TREE_VIEW_ID = "flutterProjectView";
export const Folder_NODE_CONTEXT = "flutterDevTools.isFolder";
export const File_DART_CONTEXT = "flutterDevTools.dartFile";
export const File_ARB_CONTEXT = "flutterDevTools.arbFile";
export const File_YAML_CONTEXT = "flutterDevTools.yamlFile";
export const File_MARKDOWN_CONTEXT = "flutterDevTools.markdownFile";
export const File_TXT_CONTEXT = "flutterDevTools.txtFile";
export const File_HTML_CONTEXT = "flutterDevTools.htmlFile";
export const File_CSS_CONTEXT = "flutterDevTools.cssFile";
export const File_JS_CONTEXT = "flutterDevTools.jsFile";
export const File_TS_CONTEXT = "flutterDevTools.tsFile";
export const File_PYTHON_CONTEXT = "flutterDevTools.pyFile";
export const File_IMAGE_CONTEXT = "flutterDevTools.imageFile";
export const File_OTHER_CONTEXT = "flutterDevTools.otherFile";

export const COMMAND_PROJECT_VIEW_ADD_FILE = `${PROJECT_TREE_VIEW_ID}.addFile`;
export const COMMAND_PROJECT_VIEW_ADD_FOLDER = `${PROJECT_TREE_VIEW_ID}.addFolder`;
export const COMMAND_PROJECT_VIEW_RENAME = `${PROJECT_TREE_VIEW_ID}.rename`;
export const COMMAND_PROJECT_VIEW_DELETE_FILE = `${PROJECT_TREE_VIEW_ID}.delete`;
export const COMMAND_PROJECT_VIEW_REFRESH = `${PROJECT_TREE_VIEW_ID}.refresh`;
export const COMMAND_PROJECT_VIEW_LOCATION = `${PROJECT_TREE_VIEW_ID}.location`;

// 图片预览项目视图Id
export const IMAGE_PREVIEW_VIEW_ID = "imagePreviewView";

// 注册的命令常量
export const COMMAND_JSON2DART = `flutterDevTools.json2dart`;
export const COMMAND_GEN_CONSTRUCTOR = `flutterDevTools.genConstructor`;
export const COMMAND_GETTER = `flutterDevTools.getter`;
export const COMMAND_SETTER = `flutterDevTools.setter`;
export const COMMAND_GETTER_AND_SETTER = `flutterDevTools.getterAndSetter`;
export const COMMAND_GEN_SERIALIZATION = `flutterDevTools.genSerialization`;
export const COMMAND_GEN_G_FILE = `flutterDevTools.genGFile`;
export const COMMAND_GEN_G_FILE_SINGLE = `flutterDevTools.genGFileSingle`;
export const COMMAND_SHOW_DEPS = `flutterDevTools.showDeps`;
export const COMMAND_TRANSLATE_ARB = `flutterDevTools.translateArb`;
export const COMMAND_EXTRACT_L10N = `flutterDevTools.extractL10n`;
export const COMMAND_EXTRACT_L10N_AND_TRANSLATE = `flutterDevTools.extractL10nAndTranslate`;
export const COMMAND_EXPLORE_FILE_LOCATION = `flutterDevTools.file.location`;