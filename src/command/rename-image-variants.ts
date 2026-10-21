import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { disposeAll, isImage } from "../utils/utils";
import { ImageVariantUtils } from "../utils/image-variant-utils";
import { ImagePreviewUtils } from "../utils/image-preview-utils";
import { COMMAND_RENAME_IMAGE_WITH_VARIANTS } from "../constants.contexts";
import Logger from "../utils/logger";
import { FlutterSdk } from "../sdk";

/**
 * 提示语中最多展示的文件数
 */
const MAX_LIST_LINES = 12;

/**
 * 冲突提示文案
 */
const CONFLICT_MESSAGE = "已存在同名文件";

/**
 * 待重命名的图片组（同一图片及其所有变体）
 */
interface RenameImageGroup {
  baseDir: string; // 图片所在的基础目录（不含变体目录）
  fileName: string; // 当前文件名（含扩展名）
  targetName: string; // 目标文件名（可修改，含扩展名）
  variants: string[]; // 所有需要重命名的文件（基础目录 + 变体目录）
  previewUri?: string; // 预览用的 WebView URI
}

/**
 * 重命名冲突状态
 */
interface RenameConflictState {
  message: string; // 冲突提示，空字符串表示无冲突
  previewUris: string[]; // 冲突图片预览
}

/**
 * 重命名选中的单个或多个图片，同时重命名其在所有变体目录（1.5x、2.0x...）下的同名图片
 */
export class RenameImageWithVariants implements vscode.Disposable {
  private disposableList: vscode.Disposable[] = [];

  constructor(private readonly sdk: FlutterSdk) {
    const dispose = vscode.commands.registerCommand(
      COMMAND_RENAME_IMAGE_WITH_VARIANTS,
      (uri?: vscode.Uri, uris?: vscode.Uri[]) => this.execute(uri, uris),
    );
    this.disposableList.push(dispose);
  }

  dispose() {
    disposeAll(this.disposableList);
  }

  private async execute(
    uri?: vscode.Uri,
    uris?: vscode.Uri[],
  ): Promise<void> {
    const selectedImages = this.getSelectedImages(uri, uris);
    if (selectedImages.length === 0) {
      Logger.showNotification(
        "请在资源管理器中选择要重命名的图片文件",
        "error",
      );
      return;
    }

    const groups = this.collectGroups(selectedImages);
    if (groups.length === 0) {
      Logger.showNotification("未找到需要重命名的图片文件", "error");
      return;
    }

    const targetNames = await this.showRenameDialog(groups);
    if (!targetNames) {
      return;
    }

    await this.renameGroups(groups, targetNames);
  }

  /**
   * 从右键选中项中筛选出图片文件
   */
  private getSelectedImages(
    uri?: vscode.Uri,
    uris?: vscode.Uri[],
  ): vscode.Uri[] {
    const selected = uris && uris.length > 0 ? uris : uri ? [uri] : [];
    return selected.filter(
      item =>
        item && item.scheme === "file" && isImage(path.basename(item.fsPath)),
    );
  }

  /**
   * 按「基础目录 + 文件名」收集图片组及其所有变体
   */
  private collectGroups(selectedImages: vscode.Uri[]): RenameImageGroup[] {
    const groupMap = new Map<string, RenameImageGroup>();

    for (const image of selectedImages) {
      const fileName = path.basename(image.fsPath);
      const baseDir = ImageVariantUtils.getBaseDir(image.fsPath);
      const key = path.join(baseDir, fileName);
      if (groupMap.has(key)) {
        continue;
      }

      const variants = ImageVariantUtils.collectVariants(image.fsPath);
      if (variants.length === 0) {
        continue;
      }

      groupMap.set(key, {
        baseDir,
        fileName,
        targetName: fileName,
        variants,
      });
    }

    return Array.from(groupMap.values()).sort((a, b) => {
      if (a.baseDir === b.baseDir) {
        return a.fileName.localeCompare(b.fileName);
      }
      return a.baseDir.localeCompare(b.baseDir);
    });
  }

  /**
   * 收集预览需要访问的资源根目录
   */
  private collectLocalResourceRoots(
    groups: RenameImageGroup[],
  ): vscode.Uri[] {
    const roots = new Map<string, vscode.Uri>();
    roots.set(this.sdk.workspace.toString(), this.sdk.workspace);
    for (const group of groups) {
      roots.set(group.baseDir, vscode.Uri.file(group.baseDir));
    }
    return Array.from(roots.values());
  }

  /**
   * 计算所有图片组的冲突状态
   * 目标目录已存在同名文件、多个图片组重命名后目标路径相同都视为冲突
   */
  private computeConflictStates(
    groups: RenameImageGroup[],
    names: string[],
    webview: vscode.Webview,
  ): RenameConflictState[] {
    const states: RenameConflictState[] = groups.map(() => ({
      message: "",
      previewUris: [],
    }));
    const targetPathOwners = new Map<string, number[]>();

    groups.forEach((group, index) => {
      const state = states[index];
      const newName = (names[index] ?? group.fileName).trim();

      if (newName.length === 0) {
        state.message = "文件名不能为空";
        return;
      }
      if (newName.includes("/") || newName.includes("\\")) {
        state.message = "文件名不能包含路径分隔符";
        return;
      }
      if (!isImage(newName)) {
        state.message = "文件扩展名无效";
        return;
      }

      // 名称未变化时不会产生冲突
      if (newName === group.fileName) {
        return;
      }

      for (const variantPath of group.variants) {
        const targetPath = path.join(path.dirname(variantPath), newName);

        const owners = targetPathOwners.get(targetPath);
        if (owners) {
          owners.push(index);
        } else {
          targetPathOwners.set(targetPath, [index]);
        }

        // 仅大小写变化时，目标路径在大小写不敏感的文件系统上指向同一文件
        if (
          targetPath === variantPath ||
          (targetPath.toLowerCase() === variantPath.toLowerCase() &&
            this.isSameFile(targetPath, variantPath))
        ) {
          continue;
        }
        if (!fs.existsSync(targetPath)) {
          continue;
        }

        state.message = CONFLICT_MESSAGE;
        if (state.previewUris.length === 0) {
          state.previewUris.push(
            ImagePreviewUtils.toWebviewUri(webview, targetPath),
          );
        }
      }
    });

    // 多个图片组重命名到相同目标路径
    for (const owners of targetPathOwners.values()) {
      if (owners.length < 2) {
        continue;
      }
      for (const index of owners) {
        const state = states[index];
        state.message = CONFLICT_MESSAGE;
        for (const otherIndex of owners) {
          if (otherIndex === index) {
            continue;
          }
          const previewUri = groups[otherIndex].previewUri;
          if (previewUri && !state.previewUris.includes(previewUri)) {
            state.previewUris.push(previewUri);
          }
        }
      }
    }

    return states;
  }

  /**
   * 显示重命名列表对话框，冲突时不允许确认
   */
  private async showRenameDialog(
    groups: RenameImageGroup[],
  ): Promise<string[] | undefined> {
    const panel = vscode.window.createWebviewPanel(
      "renameImageWithVariantsPreview",
      "重命名图片",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: this.collectLocalResourceRoots(groups),
      },
    );

    // 生成预览用的 WebView URI
    for (const group of groups) {
      const previewPath =
        group.variants.find(
          variant => path.dirname(variant) === group.baseDir,
        ) ?? group.variants[0];
      group.previewUri = ImagePreviewUtils.toWebviewUri(
        panel.webview,
        previewPath,
      );
    }

    // 初始化冲突状态
    const initialStates = this.computeConflictStates(
      groups,
      groups.map(group => group.targetName),
      panel.webview,
    );

    return new Promise<string[] | undefined>(resolve => {
      let isResolved = false;

      panel.webview.html = this.getRenameHtml(groups, initialStates);

      const messageListener = panel.webview.onDidReceiveMessage(message => {
        switch (message.command) {
          case "confirm": {
            if (isResolved) {
              return;
            }
            // 确认时再次校验冲突，避免预览期间目标文件发生变化
            const names = (message.names as string[]) ?? [];
            const states = this.computeConflictStates(
              groups,
              names,
              panel.webview,
            );
            if (states.some(state => state.message.length > 0)) {
              panel.webview.postMessage({
                command: "updateConflicts",
                states,
              });
              return;
            }
            isResolved = true;
            panel.dispose();
            resolve(names);
            break;
          }

          case "cancel":
            if (isResolved) {
              return;
            }
            isResolved = true;
            panel.dispose();
            resolve(undefined);
            break;

          case "checkConflict": {
            const states = this.computeConflictStates(
              groups,
              (message.names as string[]) ?? [],
              panel.webview,
            );
            panel.webview.postMessage({
              command: "updateConflicts",
              states,
            });
            break;
          }
        }
      });

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
   * 生成重命名列表对话框的 HTML
   */
  private getRenameHtml(
    groups: RenameImageGroup[],
    initialStates: RenameConflictState[],
  ): string {
    // 防止文件名中的特殊字符破坏内联脚本
    const groupsJson = JSON.stringify(
      groups.map(group => ({
        targetName: group.targetName,
        previewUri: group.previewUri ?? "",
      })),
    ).replace(/</g, "\\u003c");
    const statesJson = JSON.stringify(
      initialStates.map(state => ({
        message: state.message,
        previewUris: state.previewUris,
      })),
    ).replace(/</g, "\\u003c");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>重命名图片</title>
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
    
    h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
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
    <button class="btn-confirm" id="confirmBtn">确认重命名</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const groups = ${groupsJson};
    const initialStates = ${statesJson};
    
    function esc(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    
    function renderThumbs(previews) {
      return (previews || [])
        .map(src => '<img src="' + src + '">')
        .join('');
    }
    
    function applyStates(states) {
      let hasConflict = false;
      
      states.forEach((state, index) => {
        const message = state && state.message ? state.message : '';
        if (message) {
          hasConflict = true;
        }
        
        const row = document.getElementById('conflict-' + index);
        if (row) {
          row.classList[message ? 'add' : 'remove']('show');
        }
        const text = document.getElementById('conflict-text-' + index);
        if (text) {
          text.textContent = message;
        }
        const thumbs = document.getElementById('conflict-thumbs-' + index);
        if (thumbs) {
          thumbs.innerHTML = renderThumbs(state ? state.previewUris : []);
        }
      });
      
      // 只要存在冲突就不允许执行重命名
      document.getElementById('confirmBtn').disabled = hasConflict;
    }
    
    function renderAll() {
      const contentEl = document.getElementById('content');
      let html = '<h3>图片 (' + groups.length + ' 组)</h3>';
      html += '<div class="image-list">';
      
      groups.forEach((group, index) => {
        html += '<div class="image-item">';
        
        // 图片预览
        html += '<div class="image-preview">';
        if (group.previewUri) {
          html += '<img src="' + group.previewUri + '" alt="' + esc(group.targetName) + '">';
        }
        html += '</div>';
        
        // 信息区域
        html += '<div class="image-info">';
        html += '<input type="text" class="name-input" value="' + esc(group.targetName) + 
                '" data-index="' + index + '">';
        
        // 冲突提示
        html += '<div class="conflict-row" id="conflict-' + index + '">' +
                '<div class="conflict-thumbs" id="conflict-thumbs-' + index + '"></div>' +
                '<span class="conflict-text" id="conflict-text-' + index + '"></span>' +
                '</div>';
        
        html += '</div></div>';
      });
      
      html += '</div>';
      contentEl.innerHTML = html;
      
      // 绑定输入事件
      document.querySelectorAll('.name-input').forEach(input => {
        input.addEventListener('input', event => {
          const target = event.target;
          const index = parseInt(target.dataset.index);
          groups[index].targetName = target.value;
          
          vscode.postMessage({
            command: 'checkConflict',
            names: groups.map(g => g.targetName),
          });
        });
      });
      
      applyStates(initialStates);
    }
    
    // 更新冲突状态
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'updateConflicts') {
        applyStates(message.states);
      }
    });
    
    // 按钮事件
    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });
    
    document.getElementById('confirmBtn').addEventListener('click', () => {
      vscode.postMessage({
        command: 'confirm',
        names: groups.map(g => g.targetName),
      });
    });
    
    // 初始化
    renderAll();
  </script>
</body>
</html>`;
  }

  /**
   * 按用户输入的新文件名重命名所有图片组及其变体
   */
  private async renameGroups(
    groups: RenameImageGroup[],
    targetNames: string[],
  ): Promise<void> {
    let renamedGroupCount = 0;
    let renamedFileCount = 0;
    const failedPaths: string[] = [];

    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      const newName = (targetNames[index] ?? group.fileName).trim();
      if (newName === group.fileName) {
        continue;
      }

      let groupRenamed = false;
      for (const oldPath of group.variants) {
        const newPath = path.join(path.dirname(oldPath), newName);
        if (newPath === oldPath) {
          continue;
        }

        try {
          await vscode.workspace.fs.rename(
            vscode.Uri.file(oldPath),
            vscode.Uri.file(newPath),
            // 仅大小写变化时，目标路径在大小写不敏感的文件系统上指向同一文件
            {
              overwrite:
                newPath.toLowerCase() === oldPath.toLowerCase() &&
                this.isSameFile(newPath, oldPath),
            },
          );
          renamedFileCount++;
          groupRenamed = true;
        } catch (e) {
          Logger.e(`重命名图片失败: ${oldPath}`, e);
          failedPaths.push(this.toRelativePath(oldPath));
        }
      }

      if (groupRenamed) {
        renamedGroupCount++;
      }
    }

    if (renamedGroupCount > 0) {
      Logger.showNotification(
        `已重命名 ${renamedGroupCount} 组图片（共 ${renamedFileCount} 个文件）`,
      );
    } else if (failedPaths.length === 0) {
      Logger.showNotification("未做任何修改");
    }

    if (failedPaths.length > 0) {
      Logger.showNotification(
        `以下图片重命名失败：\n${this.buildListText(failedPaths)}`,
        "error",
      );
    }
  }

  /**
   * 判断两个路径是否指向同一个文件（用于大小写不敏感的文件系统）
   */
  private isSameFile(a: string, b: string): boolean {
    try {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      // 部分文件系统的 ino 恒为 0，此时无法确认是同一文件
      return (
        statA.ino !== 0 &&
        statA.dev === statB.dev &&
        statA.ino === statB.ino
      );
    } catch {
      return false;
    }
  }

  private toRelativePath(filePath: string): string {
    const rootPath = this.sdk.workspace.fsPath;
    if (filePath.startsWith(rootPath)) {
      return path.relative(rootPath, filePath);
    }
    return filePath;
  }

  private buildListText(paths: string[]): string {
    const shown = paths.slice(0, MAX_LIST_LINES).join("\n");
    if (paths.length <= MAX_LIST_LINES) {
      return shown;
    }
    return `${shown}\n...等 ${paths.length} 个文件`;
  }
}
