import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import { disposeAll, isImage } from "../utils/utils";
import { ConfigUtils } from "../utils/config-utils";
import Logger from "../utils/logger";
import { FlutterSdk } from "../sdk";
import { COMMAND_IMPORT_ANDROID_IMAGES } from "../constants.contexts";

/**
 * 待导入的图片信息（单个变体）
 */
interface PendingImageVariant {
  sourcePath: string; // 源文件路径
  previewData?: string; // 预览用的 base64 数据（可选）
  variant: string | null; // 变体目录（null, 1.5x, 2.0x, 3.0x, 4.0x）
}

/**
 * 待导入的图片组（按文件名分组，包含所有变体）
 */
interface PendingImageGroup {
  baseName: string; // 基础文件名（不含扩展名和密度标识）
  extension: string; // 文件扩展名
  targetName: string; // 目标文件名（可修改，含扩展名）
  variants: PendingImageVariant[]; // 所有变体
  type: "drawable" | "mipmap"; // 图片类型
  hasBatchConflict: boolean; // 与本批次即将导入的数据冲突（重名）
  hasTargetConflict: boolean; // 与目标目录已有文件冲突
  importLast: boolean; // 批次冲突勾选状态：true 导入最后一个同名文件
  overwrite: boolean; // 目标冲突勾选状态：true 覆盖目标目录文件
  batchPreviews: string[]; // 批次冲突时的冲突图片预览
  targetPreviews: string[]; // 目标冲突时已存在文件的预览
}

/**
 * Android 密度目录到 Flutter 变体目录的映射
 */
const DENSITY_MAP: Record<string, string | null> = {
  "drawable-mdpi": null,
  "drawable-hdpi": "1.5x",
  "drawable-xhdpi": "2.0x",
  "drawable-xxhdpi": "3.0x",
  "drawable-xxxhdpi": "4.0x",
  "mipmap-mdpi": null,
  "mipmap-hdpi": "1.5x",
  "mipmap-xhdpi": "2.0x",
  "mipmap-xxhdpi": "3.0x",
  "mipmap-xxxhdpi": "4.0x",
};

/**
 * 需要忽略的变体目录
 */
const VARIANT_DIRS = ["1.5x", "2.0x", "3.0x", "4.0x"];

/**
 * 导入 Android 图片目录格式的图片资源
 */
export class ImportAndroidImages implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];
  private lastSelectedDir: string | undefined; // 记录上次选择的目录（内存中，不持久化）

  constructor(private readonly sdk: FlutterSdk) {
    const disposable = vscode.commands.registerCommand(
      COMMAND_IMPORT_ANDROID_IMAGES,
      uri => this.importImages(uri),
    );
    this.disposableList.push(disposable);
  }

  dispose() {
    this.lastSelectedDir = undefined;
    disposeAll(this.disposableList);
  }

  private async importImages(uri?: vscode.Uri) {
    if (!uri) {
      Logger.showNotification("请选择目标文件夹", "error");
      return;
    }

    // 获取目标图片目录配置
    const imageSrcPath = ConfigUtils.imageSrcPath;
    if (!imageSrcPath) {
      Logger.showNotification("请在设置中配置图片资源目录路径", "error");
      return;
    }

    const targetBasePath = path.join(this.sdk.workspace.fsPath, imageSrcPath);
    const selectedPath = uri.fsPath;

    // 检查选中路径是否是目标目录或其子目录
    const isInTargetDir =
      selectedPath === targetBasePath ||
      selectedPath.startsWith(targetBasePath + path.sep);

    if (!isInTargetDir) {
      Logger.showNotification(
        `只能在图片资源目录（${imageSrcPath}）及其子目录下执行此操作`,
        "error",
      );
      return;
    }

    // 检查是否是变体目录（1.5x, 2.0x, 3.0x, 4.0x）或其子目录
    if (this.isVariantDirectory(selectedPath, targetBasePath)) {
      Logger.showNotification(
        "不能在变体目录（1.5x, 2.0x, 3.0x, 4.0x）及其子目录下执行此操作",
        "error",
      );
      return;
    }

    // 确定对话框的默认打开目录
    let defaultUri: vscode.Uri;
    if (this.lastSelectedDir && fs.existsSync(this.lastSelectedDir)) {
      // 如果上次有选择且目录仍存在，从上次选择的目录开始
      defaultUri = vscode.Uri.file(this.lastSelectedDir);
    } else {
      // 首次使用或上次的目录不存在，从桌面开始
      const homeDir = require("os").homedir();
      const desktopPath = path.join(homeDir, "Desktop");
      defaultUri = vscode.Uri.file(
        fs.existsSync(desktopPath) ? desktopPath : homeDir,
      );
    }

    // 让用户选择外部的 Android 密度目录或压缩文件（支持多选）
    const selectedUris = await vscode.window.showOpenDialog({
      defaultUri: defaultUri,
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      filters: {
        压缩包: ["zip"],
        所有文件: ["*"],
      },
      openLabel: "选择",
      title: "选择 Android 密度目录、包含密度目录的父目录，或 ZIP 压缩文件",
    });

    if (!selectedUris || selectedUris.length === 0) {
      return; // 用户取消选择
    }

    // 记录用户选择的第一个目录的父目录，作为下次打开的默认位置
    const firstSelectedPath = selectedUris[0].fsPath;
    if (fs.statSync(firstSelectedPath).isDirectory()) {
      this.lastSelectedDir = path.dirname(firstSelectedPath);
    }

    // 收集所有需要处理的密度目录
    const densityDirsToProcess: Array<[string, string]> = [];

    // 跟踪需要清理的临时解压目录
    const tempDirsToDelete: string[] = [];

    try {
      try {
        for (const selectedUri of selectedUris) {
          const sourcePath = selectedUri.fsPath;
          const stat = fs.statSync(sourcePath);

          // 检查是文件还是目录
          if (stat.isFile()) {
            // 处理压缩文件
            if (sourcePath.toLowerCase().endsWith(".zip")) {
              const tempDir = await this.extractZipFile(sourcePath);
              if (tempDir) {
                tempDirsToDelete.push(tempDir);

                // 在解压后的目录中查找密度目录
                const subDensityDirs = this.findDensityDirectories(tempDir);
                if (subDensityDirs.length > 0) {
                  densityDirsToProcess.push(...subDensityDirs);
                }
              }
            }
            // 忽略非 zip 文件
          } else if (stat.isDirectory()) {
            // 处理目录（原有逻辑）
            const dirName = path.basename(sourcePath);

            // 检查选中的目录本身是否是密度目录
            if (dirName in DENSITY_MAP) {
              // 直接选择了密度目录
              densityDirsToProcess.push([dirName, sourcePath]);
            } else {
              // 选择的是父目录，查找其下的密度子目录
              const subDensityDirs = this.findDensityDirectories(sourcePath);
              if (subDensityDirs.length > 0) {
                densityDirsToProcess.push(...subDensityDirs);
              }
              // 如果不是密度目录且没有密度子目录，则忽略（不报错）
            }
          }
        }
      } catch (e) {
        Logger.e("处理选择的文件时出错", e);
        Logger.showNotification("处理文件失败", "error");
        return;
      }

      if (densityDirsToProcess.length === 0) {
        Logger.showNotification(
          "未找到有效的 Android 密度目录（drawable-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi 或 mipmap-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi）",
          "warn",
        );
        return;
      }

      // 收集所有待导入的图片信息（按文件名分组）
      const pendingImageGroups: Map<string, PendingImageGroup> = new Map();
      for (const [dirName, dirPath] of densityDirsToProcess) {
        const variant = DENSITY_MAP[dirName];
        const imageType = dirName.startsWith("drawable")
          ? "drawable"
          : "mipmap";
        await this.collectPendingImagesAsGroups(
          dirPath,
          variant,
          imageType,
          pendingImageGroups,
        );
      }

      if (pendingImageGroups.size === 0) {
        Logger.showNotification("未找到可导入的图片", "warn");
        return;
      }

      // 按类型分组：drawable 和 mipmap
      const drawableGroups: PendingImageGroup[] = [];
      const mipmapGroups: PendingImageGroup[] = [];
      for (const group of pendingImageGroups.values()) {
        if (group.type === "drawable") {
          drawableGroups.push(group);
        } else {
          mipmapGroups.push(group);
        }
      }

      // 生成预览用的 base64 数据，冲突检测的冲突图片展示也依赖此数据
      await this.convertImagesToBase64(drawableGroups);
      await this.convertImagesToBase64(mipmapGroups);

      // 初始化冲突状态
      this.refreshGroupConflicts(
        [...drawableGroups, ...mipmapGroups],
        selectedPath,
      );

      // 显示预览对话框，让用户确认和重命名
      const confirmedGroups = await this.showPreviewDialog(
        drawableGroups,
        mipmapGroups,
        selectedPath,
      );
      if (!confirmedGroups || confirmedGroups.length === 0) {
        Logger.showNotification("已取消导入", "info");
        return;
      }

      // 执行导入
      let importedCount = 0;
      try {
        const writtenFiles = new Set<string>();
        for (const group of confirmedGroups) {
          const count = await this.copyImageGroup(
            group,
            selectedPath,
            writtenFiles,
          );
          importedCount += count;
        }

        if (importedCount > 0) {
          const relativePath = path.relative(
            this.sdk.workspace.fsPath,
            selectedPath,
          );
          Logger.showNotification(
            `成功导入 ${importedCount} 个图片文件到 "${relativePath}"`,
            "info",
          );
        } else {
          Logger.showNotification("导入失败或文件已存在", "warn");
        }
      } catch (e) {
        Logger.e("导入图片时出错", e);
        Logger.showNotification("导入图片失败", "error");
      }
    } finally {
      // 导入结束或取消后清理临时解压目录
      for (const tempDir of tempDirsToDelete) {
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (e) {
          Logger.e(`删除临时目录失败: ${tempDir}`, e);
        }
      }
    }
  }

  /**
   * 解压 ZIP 文件到临时目录
   * @param zipPath ZIP 文件路径
   * @returns 解压后的临时目录路径，失败返回 undefined
   */
  private async extractZipFile(zipPath: string): Promise<string | undefined> {
    try {
      // 创建临时目录
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "android-images-"));

      // 解压 ZIP 文件
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true); // true = 覆盖已存在的文件

      Logger.d(`ZIP 文件已解压到: ${tempDir}`);
      return tempDir;
    } catch (e) {
      Logger.e(`解压 ZIP 文件失败: ${zipPath}`, e);
      Logger.showNotification(
        `解压文件失败: ${path.basename(zipPath)}`,
        "error",
      );
      return undefined;
    }
  }

  /**
   * 检查路径是否在变体目录或其子目录下
   */
  private isVariantDirectory(
    selectedPath: string,
    targetBasePath: string,
  ): boolean {
    let currentPath = selectedPath;

    while (currentPath !== targetBasePath) {
      const dirName = path.basename(currentPath);
      if (VARIANT_DIRS.includes(dirName)) {
        return true;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }

    return false;
  }

  /**
   * 查找所有 Android 密度目录
   */
  private findDensityDirectories(sourcePath: string): Array<[string, string]> {
    const result: Array<[string, string]> = [];

    try {
      const entries = fs.readdirSync(sourcePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name;
          if (dirName in DENSITY_MAP) {
            result.push([dirName, path.join(sourcePath, dirName)]);
          }
        }
      }
    } catch (e) {
      Logger.e(e);
    }

    return result;
  }

  /**
   * 收集待导入的图片信息（按文件名分组）
   */
  private async collectPendingImagesAsGroups(
    sourceDir: string,
    variant: string | null,
    imageType: "drawable" | "mipmap",
    pendingImageGroups: Map<string, PendingImageGroup>,
  ): Promise<void> {
    try {
      const files = fs.readdirSync(sourceDir);
      for (const file of files) {
        const sourceFile = path.join(sourceDir, file);
        const stat = fs.statSync(sourceFile);

        // 跳过子目录
        if (!stat.isFile()) {
          continue;
        }

        // 检查是否是图片文件
        if (!isImage(file)) {
          continue;
        }

        // 解析文件名：去掉扩展名
        const ext = path.extname(file);
        const baseName = path.basename(file, ext);

        // 获取或创建图片组
        const groupKey = `${baseName}${ext}`;
        let group = pendingImageGroups.get(groupKey);

        if (!group) {
          group = {
            baseName: baseName,
            extension: ext,
            targetName: file,
            variants: [],
            type: imageType,
            hasBatchConflict: false,
            hasTargetConflict: false,
            importLast: false,
            overwrite: false,
            batchPreviews: [],
            targetPreviews: [],
          };
          pendingImageGroups.set(groupKey, group);
        }

        // 添加变体
        group.variants.push({
          sourcePath: sourceFile,
          variant: variant,
        });
      }
    } catch (e) {
      Logger.e(`读取目录失败: ${sourceDir}`, e);
    }
  }

  /**
   * 显示预览对话框，让用户确认和重命名
   */
  private async showPreviewDialog(
    drawableGroups: PendingImageGroup[],
    mipmapGroups: PendingImageGroup[],
    targetBasePath: string,
  ): Promise<PendingImageGroup[] | undefined> {
    // 创建 WebView 面板
    const panel = vscode.window.createWebviewPanel(
      "importAndroidImagesPreview",
      "待导入图片预览",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    return new Promise<PendingImageGroup[] | undefined>(resolve => {
      let isResolved = false;

      // 设置 HTML 内容
      panel.webview.html = this.getPreviewHtml(drawableGroups, mipmapGroups);

      // 监听消息
      const messageListener = panel.webview.onDidReceiveMessage(
        async message => {
          switch (message.command) {
            case "confirm":
              if (isResolved) {
                return;
              }
              // 用户确认导入，勾选状态已包含在 groups 中，冲突不再阻断导入
              isResolved = true;
              panel.dispose();
              resolve(message.groups as PendingImageGroup[]);
              break;

            case "cancel":
              if (isResolved) {
                return;
              }
              // 用户取消
              isResolved = true;
              panel.dispose();
              resolve(undefined);
              break;

            case "checkConflict": {
              // 实时检查所有图片组的冲突状态
              const names = message.names as string[];
              const allGroups = [...drawableGroups, ...mipmapGroups];
              const states = this.computeConflictStates(
                allGroups,
                names,
                targetBasePath,
              );

              panel.webview.postMessage({
                command: "updateConflicts",
                states: states,
              });
              break;
            }
          }
        },
      );

      // 监听面板关闭
      const disposeListener = panel.onDidDispose(() => {
        messageListener.dispose();
        disposeListener.dispose();
        if (!isResolved) {
          isResolved = true;
          resolve(undefined);
        }
      });
    });
  }

  /**
   * 将图片转换为 base64 编码用于预览
   */
  private async convertImagesToBase64(
    groups: PendingImageGroup[],
  ): Promise<void> {
    for (const group of groups) {
      for (const variant of group.variants) {
        const dataUri = this.toImageDataUri(variant.sourcePath);
        if (dataUri) {
          // 保存到 previewData，不修改 sourcePath
          variant.previewData = dataUri;
        } else {
          Logger.e(`读取图片失败: ${variant.sourcePath}`);
        }
      }
    }
  }

  /**
   * 读取图片文件并转换为 data URI
   */
  private toImageDataUri(filePath: string): string | undefined {
    try {
      const ext = path.extname(filePath).toLowerCase();
      let mimeType = "image/png";
      if (ext === ".jpg" || ext === ".jpeg") {
        mimeType = "image/jpeg";
      } else if (ext === ".webp") {
        mimeType = "image/webp";
      } else if (ext === ".gif") {
        mimeType = "image/gif";
      } else if (ext === ".svg") {
        mimeType = "image/svg+xml";
      }
      return `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`;
    } catch (e) {
      Logger.e(`读取图片失败: ${filePath}`, e);
      return undefined;
    }
  }

  /**
   * 生成预览对话框的 HTML
   */
  private getPreviewHtml(
    drawableGroups: PendingImageGroup[],
    mipmapGroups: PendingImageGroup[],
  ): string {
    const drawableJson = JSON.stringify(
      drawableGroups.map(g => ({
        ...g,
        variants: g.variants.map(v => ({ ...v })),
      })),
    );
    const mipmapJson = JSON.stringify(
      mipmapGroups.map(g => ({
        ...g,
        variants: g.variants.map(v => ({ ...v })),
      })),
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>待导入图片预览</title>
  <style>
    html,
    body {
      height: 100%;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    
    h2 {
      margin-top: 0;
      margin-bottom: 15px;
      font-size: 16px;
      font-weight: 600;
      flex-shrink: 0;
    }
    
    h3 {
      margin: 20px 0 10px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
    
    #content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    
    .image-list {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      margin-bottom: 15px;
    }
    
    .image-item {
      display: flex;
      align-items: center;
      padding: 10px 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
      gap: 12px;
    }
    
    .image-item:last-child {
      border-bottom: none;
    }
    
    .image-preview {
      width: 48px;
      height: 48px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .image-preview img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    
    .image-info {
      flex: 1;
      min-width: 0;
    }
    
    .name-input {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-size: 13px;
      box-sizing: border-box;
    }
    
    .name-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    
    .conflict-row {
      display: none;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      padding: 4px 8px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 3px;
    }
    
    .conflict-row.show {
      display: flex;
    }
    
    .conflict-text {
      flex: 1;
      color: var(--vscode-errorForeground);
      font-size: 11px;
      line-height: 1.4;
    }
    
    .conflict-thumbs {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    
    .conflict-thumbs img {
      width: 24px;
      height: 24px;
      object-fit: contain;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      background-color: var(--vscode-editor-background);
    }
    
    .conflict-checkbox {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      margin: 0;
      cursor: pointer;
    }
    
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
      flex-shrink: 0;
    }
    
    button {
      padding: 8px 20px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    
    .btn-cancel {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    
    .btn-cancel:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    
    .btn-confirm {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-confirm:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    
    .btn-confirm:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div id="content"></div>
  
  <div class="buttons">
    <button class="btn-cancel" id="cancelBtn">取消</button>
    <button class="btn-confirm" id="confirmBtn">确认导入</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const drawableGroups = ${drawableJson};
    const mipmapGroups = ${mipmapJson};
    
    function allGroups() {
      return [...drawableGroups, ...mipmapGroups];
    }
    
    function esc(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    
    function toggleConflictRow(id, visible) {
      const el = document.getElementById(id);
      if (el) {
        el.classList[visible ? 'add' : 'remove']('show');
      }
    }
    
    function renderThumbs(previews) {
      return (previews || [])
        .map(src => '<img src="' + src + '">')
        .join('');
    }
    
    // 渲染分组列表
    function renderGroup(title, groups, offsetIndex) {
      if (groups.length === 0) return '';
      
      let html = '<h3>' + title + ' (' + groups.length + ' 个)</h3>';
      html += '<div class="image-list">';
      
      groups.forEach((group, idx) => {
        const index = offsetIndex + idx;
        const firstVariant = group.variants[0];
        // 使用 previewData 而不是 sourcePath
        const previewSrc = firstVariant ? (firstVariant.previewData || '') : '';
        
        html += '<div class="image-item">';
        
        // 图片预览
        html += '<div class="image-preview">';
        if (previewSrc) {
          html += '<img src="' + previewSrc + '" alt="' + esc(group.targetName) + '">';
        }
        html += '</div>';
        
        // 信息区域
        html += '<div class="image-info">';
        
        // 输入框
        html += '<input type="text" class="name-input" value="' + esc(group.targetName) + 
                '" data-index="' + index + '">';
        
        // 批次内同名冲突提示
        const batchClass = group.hasBatchConflict ? ' show' : '';
        html += '<div class="conflict-row' + batchClass + '" id="batch-conflict-' + index + '">' +
                '<div class="conflict-thumbs" id="batch-thumbs-' + index + '">' +
                renderThumbs(group.batchPreviews) +
                '</div>' +
                '<span class="conflict-text">导入的文件存在相同文件，勾选则导入最后一个同名文件，否则导入第一个同名文件。</span>' +
                '<input type="checkbox" class="conflict-checkbox" data-index="' + index + '" data-kind="batch"' +
                (group.importLast ? ' checked' : '') + '>' +
                '</div>';
        
        // 目标目录已存在冲突提示
        const targetClass = group.hasTargetConflict ? ' show' : '';
        html += '<div class="conflict-row' + targetClass + '" id="target-conflict-' + index + '">' +
                '<div class="conflict-thumbs" id="target-thumbs-' + index + '">' +
                renderThumbs(group.targetPreviews) +
                '</div>' +
                '<span class="conflict-text">已存在同名文件,是否覆盖原文件？不勾选则跳过导入。</span>' +
                '<input type="checkbox" class="conflict-checkbox" data-index="' + index + '" data-kind="target"' +
                (group.overwrite ? ' checked' : '') + '>' +
                '</div>';
        
        html += '</div></div>';
      });
      
      html += '</div>';
      return html;
    }
    
    // 渲染所有内容
    function renderAll() {
      const contentEl = document.getElementById('content');
      let html = '';
      
      html += renderGroup('Drawable 图片', drawableGroups, 0);
      html += renderGroup('Mipmap 图标', mipmapGroups, drawableGroups.length);
      
      contentEl.innerHTML = html;
      
      // 绑定输入事件
      document.querySelectorAll('.name-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const target = e.target;
          const index = parseInt(target.dataset.index);
          
          // 更新数据
          allGroups()[index].targetName = target.value;
          
          // 检查冲突
          vscode.postMessage({
            command: 'checkConflict',
            names: allGroups().map(g => g.targetName),
            index: index,
          });
        });
      });
      
      // 绑定冲突勾选框事件
      document.querySelectorAll('.conflict-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const target = e.target;
          const index = parseInt(target.dataset.index);
          
          if (target.dataset.kind === 'batch') {
            // 组内冲突的勾选联动：同名冲突文件要么全选，要么全不选
            const checked = target.checked;
            const changedName = allGroups()[index].targetName;
            allGroups().forEach((g, i) => {
              if (g.targetName !== changedName) {
                return;
              }
              g.importLast = checked;
              const el = document.querySelector(
                '.conflict-checkbox[data-kind="batch"][data-index="' + i + '"]'
              );
              if (el) {
                el.checked = checked;
              }
            });
          } else {
            allGroups()[index].overwrite = target.checked;
          }
        });
      });
    }
    
    // 更新冲突状态
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'updateConflicts') {
        message.states.forEach((state, index) => {
          toggleConflictRow('batch-conflict-' + index, state.batch);
          toggleConflictRow('target-conflict-' + index, state.target);
          
          // 刷新冲突图片展示
          const batchThumbs = document.getElementById('batch-thumbs-' + index);
          if (batchThumbs) {
            batchThumbs.innerHTML = renderThumbs(state.batchPreviews);
          }
          const targetThumbs = document.getElementById('target-thumbs-' + index);
          if (targetThumbs) {
            targetThumbs.innerHTML = renderThumbs(state.targetPreviews);
          }
        });
        
        // 重命名后产生新的组内冲突时，参照已有同名冲突的勾选状态设置默认值
        const groups = allGroups();
        groups.forEach((group, index) => {
          if (!message.states[index] || !message.states[index].batch) {
            return;
          }
          const others = groups.filter((g, i) =>
            i !== index &&
            g.targetName === group.targetName &&
            message.states[i] &&
            message.states[i].batch
          );
          if (others.length === 0) {
            return;
          }
          group.importLast = others.some(g => g.importLast);
          const el = document.querySelector(
            '.conflict-checkbox[data-kind="batch"][data-index="' + index + '"]'
          );
          if (el) {
            el.checked = group.importLast;
          }
        });
      }
    });
    
    // 按钮事件
    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });
    
    document.getElementById('confirmBtn').addEventListener('click', () => {
      vscode.postMessage({
        command: 'confirm',
        groups: allGroups(),
      });
    });
    
    // 初始化
    renderAll();
  </script>
</body>
</html>`;
  }

  /**
   * 计算所有图片组的冲突状态
   * batch: 与本批次即将导入的数据冲突（批次内重名）
   * target: 与目标目录已有文件冲突
   */
  private computeConflictStates(
    allGroups: PendingImageGroup[],
    names: string[],
    targetBasePath: string,
  ): Array<{
    batch: boolean;
    target: boolean;
    batchPreviews: string[];
    targetPreviews: string[];
  }> {
    const nameCount = new Map<string, number>();
    for (const name of names) {
      nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
    }

    return allGroups.map((group, index) => {
      const name = names[index] ?? group.targetName;
      const variantKeys = group.variants.map(v => v.variant ?? "");

      // 组内多个文件会写入同一个目标文件，或批次内其它图片组重名
      const hasDuplicateVariant =
        new Set(variantKeys).size !== variantKeys.length;
      const hasSameNameGroup = (nameCount.get(name) ?? 0) > 1;

      // 只检查该组实际会写入的变体目录；相同图片只取一张，优先从低分辨率目录查找
      const targetPreviews: string[] = [];
      let hasTargetConflict = false;
      const variantOrder = ["", "1.5x", "2.0x", "3.0x", "4.0x"];
      const sortedVariantKeys = [...new Set(variantKeys)].sort(
        (a, b) => variantOrder.indexOf(a) - variantOrder.indexOf(b),
      );
      for (const key of sortedVariantKeys) {
        const targetFile = path.join(
          key ? path.join(targetBasePath, key) : targetBasePath,
          name,
        );
        if (!fs.existsSync(targetFile)) {
          continue;
        }
        hasTargetConflict = true;
        const preview = this.toImageDataUri(targetFile);
        if (preview) {
          targetPreviews.push(preview);
        }
        break;
      }

      // 批次冲突时收集冲突图片来源：组内重复文件 + 其它同名组的代表图片
      const batchPreviews: string[] = [];
      if (hasDuplicateVariant || hasSameNameGroup) {
        const seenKeys = new Set<string>();
        for (const variant of group.variants) {
          const key = variant.variant ?? "";
          if (seenKeys.has(key)) {
            if (
              variant.previewData &&
              !batchPreviews.includes(variant.previewData)
            ) {
              batchPreviews.push(variant.previewData);
            }
          } else {
            seenKeys.add(key);
          }
        }
        if (hasSameNameGroup) {
          allGroups.forEach((other, otherIndex) => {
            if (
              otherIndex === index ||
              (names[otherIndex] ?? other.targetName) !== name
            ) {
              return;
            }
            const preview = other.variants[0]?.previewData;
            if (preview && !batchPreviews.includes(preview)) {
              batchPreviews.push(preview);
            }
          });
        }
      }

      return {
        // 优先检测目标目录冲突，无目标冲突时才检测批次内冲突
        batch: !hasTargetConflict && (hasDuplicateVariant || hasSameNameGroup),
        target: hasTargetConflict,
        batchPreviews,
        targetPreviews,
      };
    });
  }

  /**
   * 初始化（或重新计算）图片组的冲突状态
   */
  private refreshGroupConflicts(
    allGroups: PendingImageGroup[],
    targetBasePath: string,
  ): void {
    const states = this.computeConflictStates(
      allGroups,
      allGroups.map(group => group.targetName),
      targetBasePath,
    );
    allGroups.forEach((group, index) => {
      group.hasBatchConflict = states[index].batch;
      group.hasTargetConflict = states[index].target;
      group.batchPreviews = states[index].batchPreviews;
      group.targetPreviews = states[index].targetPreviews;
    });
  }

  /**
   * 复制单个图片组（包含所有变体）
   */
  private async copyImageGroup(
    group: PendingImageGroup,
    selectedPath: string,
    writtenFiles: Set<string>,
  ): Promise<number> {
    let copiedCount = 0;

    // 同一变体目录存在多个同名来源时，勾选导入最后一个，否则导入第一个
    const variants = new Map<string, PendingImageVariant>();
    for (const variant of group.variants) {
      const key = variant.variant ?? "";
      if (!variants.has(key) || group.importLast) {
        variants.set(key, variant);
      }
    }

    try {
      for (const [variantKey, variant] of variants) {
        // 确定目标路径
        const targetDir = variantKey
          ? path.join(selectedPath, variantKey)
          : selectedPath;

        // 确保目标目录存在
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));

        const targetFile = path.join(targetDir, group.targetName);
        const existsOnDisk = fs.existsSync(targetFile);
        const writtenInBatch = writtenFiles.has(targetFile);

        // 目标目录已存在同名文件：勾选覆盖才写入，否则跳过
        if (existsOnDisk && !writtenInBatch && !group.overwrite) {
          Logger.d(`文件已存在，跳过: ${targetFile}`);
          continue;
        }
        // 本批次已导入过同名文件：勾选导入最后一个才覆盖，否则导入第一个
        if (writtenInBatch && !group.importLast) {
          Logger.d(`批次内已导入同名文件，跳过: ${targetFile}`);
          continue;
        }

        // 复制文件
        const content = fs.readFileSync(variant.sourcePath);
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(targetFile),
          content,
        );
        writtenFiles.add(targetFile);

        copiedCount++;
      }
    } catch (e) {
      Logger.e(`复制图片组失败: ${group.targetName}`, e);
    }

    return copiedCount;
  }
}
