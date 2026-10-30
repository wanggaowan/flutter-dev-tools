const vscode = acquireVsCodeApi();

const SPECIAL_PLACEHOLDERS = ["#DATE#", "#TIME#", "#DATETIME#", "#USER#"];

const FOLDER_ICON =
  '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1.4 3.1c0-.4.3-.7.7-.7h3.1l1.3 1.3h5.4c.4 0 .7.3.7.7v6.5c0 .4-.3.7-.7.7H2.1a.7.7 0 0 1-.7-.7V3.1z"/></svg>';
const FILE_ICON =
  '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.3 1.2h4.6L11 4.3v8.5H3.3V1.2zm4.2.9v2.5h2.5L7.5 2.1z"/></svg>';

let initData = { templates: [], targetDir: "" };
const initDataEl = document.getElementById("init-data");
if (initDataEl && initDataEl.textContent) {
  try {
    initData = JSON.parse(initDataEl.textContent);
  } catch (e) {
    console.error("解析初始化数据失败", e);
  }
}

let templates = Array.isArray(initData.templates) ? initData.templates : [];
let selectedTemplate = null;
let selectedNode = null;
let isDarkTheme = initData.isDarkTheme !== false;

const templateListEl = document.getElementById("template-list");
const treeEl = document.getElementById("tree");
const editorTitleEl = document.getElementById("editor-title");
const contentEditorEl = document.getElementById("content-editor");
const editorCodeEl = document.getElementById("editor-code");
const highlightLayerEl = document.getElementById("highlight-layer");
const highlightCodeEl = document.getElementById("highlight-code");
const lineNumbersEl = document.getElementById("line-numbers");
const editorEmptyEl = document.getElementById("editor-empty");
const applyBtn = document.getElementById("apply-btn");
const addTemplateBtn = document.getElementById("add-template-btn");
const addChildBtn = document.getElementById("add-child-btn");
const placeholderDescBtn = document.getElementById("placeholder-desc-btn");
const importBtn = document.getElementById("import-btn");
const exportBtn = document.getElementById("export-btn");
const exportAllBtn = document.getElementById("export-all-btn");
const createBtn = document.getElementById("create-btn");
const createCopyEl = document.getElementById("create-copy");
const cancelBtn = document.getElementById("cancel-btn");
const contextMenuEl = document.getElementById("context-menu");
const modalMaskEl = document.getElementById("modal-mask");
const toastEl = document.getElementById("toast");
const targetDirEl = document.getElementById("target-dir");

targetDirEl.textContent = initData.targetDir
  ? `创建位置：${initData.targetDir}`
  : "";
targetDirEl.title = initData.targetDir || "";

function applyTheme() {
  document.body.classList.toggle("light", !isDarkTheme);
}
applyTheme();

/* ---------------- 公共工具 ---------------- */

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

let toastTimer;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2000);
}

function postSave() {
  vscode.postMessage({ type: "save", templates: templates });
}

function isRoot(node) {
  return node === selectedTemplate;
}

function isContainer(node) {
  return isRoot(node) || node.isFolder === true;
}

function hasChildren(node) {
  return Array.isArray(node.children) && node.children.length > 0;
}

function findParent(target) {
  if (!selectedTemplate || target === selectedTemplate) {
    return null;
  }

  const search = parent => {
    const children = parent.children || [];
    if (children.indexOf(target) >= 0) {
      return parent;
    }
    for (const child of children) {
      if (child.isFolder) {
        const result = search(child);
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  return search(selectedTemplate);
}

/* ---------------- 语法高亮 ---------------- */

const DART_TOKEN = new RegExp(
  [
    "(?<comment>\\/\\/[^\\n]*)",
    "(?<blockComment>\\/\\*[\\s\\S]*?\\*\\/)",
    '(?<string>r?\'\'\'[\\s\\S]*?\'\'\'|r?"""[\\s\\S]*?"""|r?\'(?:\\\\.|[^\\\\\'\\n])*\'|r?"(?:\\\\.|[^\\\\"\\n])*")',
    "(?<annotation>@[A-Za-z_]\\w*)",
    "(?<keyword>\\b(?:abstract|as|assert|async|await|break|case|catch|class|const|continue|covariant|default|deferred|do|dynamic|else|enum|export|extends|extension|external|factory|false|final|finally|for|get|hide|if|implements|import|in|interface|is|late|library|mixin|new|null|on|operator|part|required|rethrow|return|set|show|static|super|switch|sync|this|throw|true|try|typedef|var|void|while|with|yield)\\b)",
    "(?<number>\\b(?:0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)",
    "(?<punct>[{}()\\[\\];,.:])",
    "(?<op>=>|\\?\\.|\\?\\?|==|!=|<=|>=|&&|\\|\\||\\+\\+|--|\\+=|-=|\\*=|/=|%=|~/|\\+|-|\\*|/|%|=|<|>|!|&|\\||\\^|~|\\?)",
  ].join("|"),
  "g",
);

const JSON_TOKEN = new RegExp(
  [
    "(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)",
    '(?<string>"(?:\\\\.|[^\\\\"\\n])*")',
    "(?<literal>\\b(?:true|false|null)\\b)",
    "(?<number>-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)",
    "(?<punct>[{}\\[\\]:,])",
  ].join("|"),
  "g",
);

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tokenSpan(className, text) {
  return `<span class="tok-${className}">${escapeHtml(text)}</span>`;
}

function tokenize(text, pattern, classify) {
  let html = "";
  let last = 0;
  pattern.lastIndex = 0;

  let match = pattern.exec(text);
  while (match) {
    if (match[0] === "") {
      pattern.lastIndex++;
      match = pattern.exec(text);
      continue;
    }

    if (match.index > last) {
      html += escapeHtml(text.slice(last, match.index));
    }
    html += classify(match, text.slice(pattern.lastIndex));
    last = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (last < text.length) {
    html += escapeHtml(text.slice(last));
  }
  return html;
}

function highlightDart(text) {
  return tokenize(text, DART_TOKEN, match => {
    const groups = match.groups;
    if (groups.comment !== undefined || groups.blockComment !== undefined) {
      return tokenSpan("comment", match[0]);
    }
    if (groups.string !== undefined) {
      return tokenSpan("string", match[0]);
    }
    if (groups.annotation !== undefined) {
      return tokenSpan("annotation", match[0]);
    }
    if (groups.keyword !== undefined) {
      return tokenSpan("keyword", match[0]);
    }
    if (groups.punct !== undefined) {
      return tokenSpan("punct", match[0]);
    }
    if (groups.op !== undefined) {
      return tokenSpan("op", match[0]);
    }
    return tokenSpan("number", match[0]);
  });
}

function highlightJson(text) {
  return tokenize(text, JSON_TOKEN, (match, rest) => {
    const groups = match.groups;
    if (groups.comment !== undefined) {
      return tokenSpan("comment", match[0]);
    }
    if (groups.string !== undefined) {
      return /^\s*:/.test(rest)
        ? tokenSpan("key", match[0])
        : tokenSpan("string", match[0]);
    }
    if (groups.literal !== undefined) {
      return tokenSpan("literal", match[0]);
    }
    if (groups.punct !== undefined) {
      return tokenSpan("punct", match[0]);
    }
    return tokenSpan("number", match[0]);
  });
}

function yamlCommentIndex(line) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return i;
    }
  }
  return -1;
}

function highlightYamlValue(value) {
  const match = /^(\s*)([\s\S]*)$/.exec(value);
  const lead = match[1];
  const body = match[2];
  if (!body) {
    return escapeHtml(lead);
  }

  const quoted = /^("(?:\\.|[^\\"])*"|'(?:''|[^'])*')/.exec(body);
  if (quoted) {
    return (
      escapeHtml(lead) +
      tokenSpan("string", quoted[1]) +
      escapeHtml(body.slice(quoted[1].length))
    );
  }
  if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(body)) {
    return escapeHtml(lead) + tokenSpan("literal", body);
  }
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(body)) {
    return escapeHtml(lead) + tokenSpan("number", body);
  }
  return escapeHtml(lead + body);
}

function highlightYamlLine(code) {
  const match = /^(\s*)(-+\s+)?([^\s:#][^:]*?)(:)([\s\S]*)$/.exec(code);
  if (!match) {
    return highlightYamlValue(code);
  }

  return (
    escapeHtml(match[1]) +
    escapeHtml(match[2] || "") +
    tokenSpan("key", match[3]) +
    escapeHtml(match[4]) +
    highlightYamlValue(match[5])
  );
}

function highlightYaml(text) {
  return text
    .split("\n")
    .map(line => {
      const index = yamlCommentIndex(line);
      if (index < 0) {
        return highlightYamlLine(line);
      }
      return (
        highlightYamlLine(line.slice(0, index)) +
        tokenSpan("comment", line.slice(index))
      );
    })
    .join("\n");
}

function getLanguage(fileName) {
  const name = (fileName || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";
  if (ext === "dart") {
    return "dart";
  }
  if (ext === "json") {
    return "json";
  }
  if (ext === "yaml" || ext === "yml") {
    return "yaml";
  }
  return "plain";
}

function highlightText(text, language) {
  if (language === "dart") {
    return highlightDart(text);
  }
  if (language === "json") {
    return highlightJson(text);
  }
  if (language === "yaml") {
    return highlightYaml(text);
  }
  return escapeHtml(text);
}

function syncEditorScroll() {
  highlightLayerEl.scrollTop = contentEditorEl.scrollTop;
  highlightLayerEl.scrollLeft = contentEditorEl.scrollLeft;
  lineNumbersEl.scrollTop = contentEditorEl.scrollTop;
}

function refreshHighlight() {
  const value = contentEditorEl.value || "";
  if (contentEditorEl.disabled) {
    highlightCodeEl.innerHTML = "";
    lineNumbersEl.textContent = "";
    return;
  }

  const language = getLanguage(selectedNode && selectedNode.name);
  highlightCodeEl.innerHTML = highlightText(value + "\n", language);

  const lineCount = value.split("\n").length;
  const numbers = [];
  for (let i = 1; i <= lineCount; i++) {
    numbers.push(String(i));
  }
  lineNumbersEl.textContent = numbers.join("\n");

  syncEditorScroll();
}

/* ---------------- 渲染 ---------------- */

function render() {
  renderTemplateList();
  renderTree();
  renderEditor();
  addChildBtn.disabled = !selectedTemplate;
}

function renderTemplateList() {
  templateListEl.innerHTML = "";
  if (templates.length === 0) {
    templateListEl.appendChild(
      el("div", "tree-empty", "暂无模板，点击右下角 + 新增"),
    );
    return;
  }

  templates.forEach(template => {
    const item = el(
      "div",
      "template-item" + (template === selectedTemplate ? " selected" : ""),
    );
    item.appendChild(el("span", "template-name", template.name));

    item.addEventListener("click", () => {
      selectTemplate(template);
    });
    item.addEventListener("contextmenu", event => {
      event.preventDefault();
      selectTemplate(template);
      showContextMenu(event.clientX, event.clientY, buildTemplateMenu(template));
    });

    templateListEl.appendChild(item);
  });
}

function renderTree() {
  treeEl.innerHTML = "";
  if (!selectedTemplate) {
    treeEl.appendChild(el("div", "tree-empty", "请选择左侧模板"));
    return;
  }

  if (selectedTemplate.createFolder) {
    renderNode(selectedTemplate, 0);
    return;
  }

  const children = selectedTemplate.children || [];
  if (children.length === 0) {
    treeEl.appendChild(
      el("div", "tree-empty", "该模板没有文件，点击右下角 + 新增"),
    );
    return;
  }

  children.forEach(child => renderNode(child, 0));
}

function renderNode(node, depth) {
  const container = isContainer(node);
  const expanded = node._expanded !== false;

  const row = el("div", "tree-row" + (node === selectedNode ? " selected" : ""));
  row.style.paddingLeft = 10 + depth * 14 + "px";

  const arrow = el("span", "tree-arrow");
  if (container && hasChildren(node)) {
    arrow.textContent = expanded ? "▾" : "▸";
    arrow.addEventListener("click", event => {
      event.stopPropagation();
      node._expanded = !expanded;
      renderTree();
    });
  }
  row.appendChild(arrow);

  const icon = el("span", "tree-icon");
  icon.innerHTML = container ? FOLDER_ICON : FILE_ICON;
  row.appendChild(icon);

  row.appendChild(el("span", "tree-name", node.name));

  row.addEventListener("click", () => {
    selectedNode = node;
    renderTree();
    renderEditor();
  });

  row.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopPropagation();
    selectedNode = node;
    renderTree();
    renderEditor();
    showContextMenu(event.clientX, event.clientY, buildNodeMenu(node));
  });

  treeEl.appendChild(row);

  if (container && expanded) {
    (node.children || []).forEach(child => renderNode(child, depth + 1));
  }
}

function renderEditor() {
  const node = selectedNode;
  const editable = !!node && !isContainer(node);

  contentEditorEl.disabled = !editable;
  contentEditorEl.style.display = editable ? "block" : "none";
  editorEmptyEl.style.display = editable ? "none" : "flex";
  editorTitleEl.textContent = editable ? node.name : "内容";

  if (editable) {
    contentEditorEl.value =
      node.tempContent !== undefined
        ? node.tempContent
        : node.content !== undefined
          ? node.content
          : "";
    contentEditorEl.scrollTop = 0;
    contentEditorEl.scrollLeft = 0;
    applyBtn.disabled = contentEditorEl.value === (node.content || "");
  } else {
    contentEditorEl.value = "";
    applyBtn.disabled = true;
  }

  refreshHighlight();
}

/* ---------------- 右键菜单 ---------------- */

function showContextMenu(x, y, items) {
  contextMenuEl.innerHTML = "";
  items.forEach(item => {
    if (item.separator) {
      contextMenuEl.appendChild(el("div", "menu-separator"));
      return;
    }

    const row = el("div", "menu-item" + (item.disabled ? " disabled" : ""));
    row.textContent = item.label;
    if (!item.disabled) {
      row.addEventListener("click", () => {
        hideContextMenu();
        item.action();
      });
    }
    contextMenuEl.appendChild(row);
  });

  contextMenuEl.style.left = "0px";
  contextMenuEl.style.top = "0px";
  contextMenuEl.classList.add("show");

  const rect = contextMenuEl.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  contextMenuEl.style.left = left + "px";
  contextMenuEl.style.top = top + "px";
}

function hideContextMenu() {
  contextMenuEl.classList.remove("show");
  contextMenuEl.innerHTML = "";
}

function buildMoveItems(list, node, onChange) {
  const index = list.indexOf(node);
  const last = list.length - 1;
  return [
    {
      label: "移动到第一个",
      disabled: index <= 0,
      action: () => moveItem(list, index, 0, onChange),
    },
    {
      label: "移动到最后一个",
      disabled: index >= last,
      action: () => moveItem(list, index, last, onChange),
    },
    {
      label: "往上移动",
      disabled: index <= 0,
      action: () => moveItem(list, index, index - 1, onChange),
    },
    {
      label: "往下移动",
      disabled: index >= last,
      action: () => moveItem(list, index, index + 1, onChange),
    },
  ];
}

function moveItem(list, from, to, onChange) {
  if (from === to || from < 0 || to < 0 || to >= list.length) {
    return;
  }
  const item = list.splice(from, 1)[0];
  list.splice(to, 0, item);
  onChange();
}

function buildTemplateMenu(template) {
  const items = [
    { label: "重命名", action: () => renameTemplate(template) },
    { label: "删除", action: () => deleteTemplate(template) },
    { label: "复制模板", action: () => copyTemplate(template) },
    { separator: true },
  ];

  items.push(
    ...buildMoveItems(templates, template, () => {
      postSave();
      render();
    }),
  );

  items.push({ separator: true });
  items.push({
    label: template.createFolder ? "仅作为分类" : "同时作为目录",
    action: () => {
      template.createFolder = !template.createFolder;
      postSave();
      render();
    },
  });

  return items;
}

function buildNodeMenu(node) {
  const items = [];
  if (isContainer(node)) {
    items.push({ label: "新增", action: () => addChild(node) });
    items.push({ separator: true });
  }

  if (isRoot(node)) {
    return items;
  }

  items.push({ label: "重命名", action: () => renameNode(node) });
  items.push({ label: "删除", action: () => deleteNode(node) });

  const parent = findParent(node);
  const siblings = parent && parent.children ? parent.children : null;
  if (siblings && siblings.length > 1) {
    items.push({ separator: true });
    items.push(
      ...buildMoveItems(siblings, node, () => {
        postSave();
        render();
      }),
    );
  }

  return items;
}

document.addEventListener("click", hideContextMenu);
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    hideContextMenu();
  }
});

/* ---------------- 弹窗 ---------------- */

function showModal(build) {
  return new Promise(resolve => {
    let settled = false;

    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    };

    const close = value => {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      modalMaskEl.classList.remove("show");
      modalMaskEl.innerHTML = "";
      resolve(value);
    };

    document.addEventListener("keydown", onKeyDown);
    modalMaskEl.innerHTML = "";
    const box = el("div", "modal");
    modalMaskEl.appendChild(box);
    modalMaskEl.classList.add("show");
    build(box, close);
  });
}

function showInputDialog(options) {
  return showModal((box, close) => {
    box.appendChild(el("div", "modal-title", options.title));

    if (options.label) {
      box.appendChild(el("div", "modal-label", options.label));
    }

    const input = el("input", "modal-input");
    input.type = "text";
    input.value = options.value || "";
    input.placeholder = options.placeholder || "";
    box.appendChild(input);

    let checkbox = null;
    if (options.checkboxLabel) {
      const label = el("label", "modal-checkbox");
      checkbox = el("input", "");
      checkbox.type = "checkbox";
      checkbox.checked = options.checkboxChecked === true;
      label.appendChild(checkbox);
      label.appendChild(el("span", "", options.checkboxLabel));
      box.appendChild(label);
    }

    const actions = el("div", "modal-actions");
    const cancel = el("button", "", "取消");
    cancel.addEventListener("click", () => close(null));
    const ok = el("button", "primary", "确定");
    ok.addEventListener("click", () => {
      const text = input.value.trim();
      if (!text) {
        showToast("内容不能为空");
        input.focus();
        return;
      }
      close({ text: text, checked: checkbox ? checkbox.checked : false });
    });
    actions.appendChild(cancel);
    actions.appendChild(ok);
    box.appendChild(actions);

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        ok.click();
      }
    });

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

function showPlaceholderDialog(names) {
  return showModal((box, close) => {
    box.appendChild(el("div", "modal-title", "输入占位符内容"));
    const form = el("div", "placeholder-form");
    const inputs = {};

    names.forEach(name => {
      const row = el("div", "placeholder-row");
      row.appendChild(el("label", "placeholder-label", name + ":"));
      const input = el("input", "modal-input");
      input.type = "text";
      row.appendChild(input);
      inputs[name] = input;
      form.appendChild(row);
    });
    box.appendChild(form);

    const actions = el("div", "modal-actions");
    const cancel = el("button", "", "取消");
    cancel.addEventListener("click", () => close(null));
    const ok = el("button", "primary", "创建");
    ok.addEventListener("click", () => {
      const values = {};
      names.forEach(name => {
        values[name] = inputs[name].value.trim();
      });
      close(values);
    });
    actions.appendChild(cancel);
    actions.appendChild(ok);
    box.appendChild(actions);

    setTimeout(() => {
      if (names.length > 0) {
        inputs[names[0]].focus();
      }
    }, 0);
  });
}

function showPlaceholderDesc() {
  const desc = [
    "#DATE#：     当前日期，格式：yyyy-MM-dd",
    "#TIME#：     当前时间，格式：HH:mm",
    "#DATETIME#： 当前日期时间，格式：yyyy-MM-dd HH:mm",
    "#USER#：     当前系统登录的用户",
  ].join("\n");

  showModal((box, close) => {
    box.appendChild(el("div", "modal-title", "特殊占位符说明"));
    box.appendChild(el("pre", "placeholder-desc", desc));
    const actions = el("div", "modal-actions");
    const ok = el("button", "primary", "确定");
    ok.addEventListener("click", () => close(true));
    actions.appendChild(ok);
    box.appendChild(actions);
  });
}

/* ---------------- 交互逻辑 ---------------- */

function selectTemplate(template) {
  selectedTemplate = template;
  selectedNode =
    template.children && template.children.length > 0
      ? template.children[0]
      : template.createFolder
        ? template
        : null;
  render();
}

function addTemplate() {
  showInputDialog({
    title: "新增模板",
    label: "输入名称：",
    checkboxLabel: "同时作为目录",
  }).then(result => {
    if (!result) {
      return;
    }

    const template = {
      name: result.text,
      createFolder: result.checked,
      children: [],
    };
    templates.push(template);
    selectedTemplate = template;
    selectedNode = null;
    postSave();
    render();
  });
}

function renameTemplate(template) {
  showInputDialog({
    title: "重命名模板",
    label: "输入名称：",
    value: template.name,
  }).then(result => {
    if (!result) {
      return;
    }
    template.name = result.text;
    postSave();
    render();
  });
}

function deleteTemplate(template) {
  const index = templates.indexOf(template);
  if (index < 0) {
    return;
  }

  templates.splice(index, 1);
  if (selectedTemplate === template) {
    selectedTemplate =
      templates.length === 0
        ? null
        : templates[Math.min(index, templates.length - 1)];
    selectedNode =
      selectedTemplate && selectedTemplate.children && selectedTemplate.children.length > 0
        ? selectedTemplate.children[0]
        : null;
  }

  postSave();
  render();
}

function copyTemplate(template) {
  showInputDialog({
    title: "复制模板",
    label: "输入名称：",
    value: template.name + "_copy",
  }).then(result => {
    if (!result) {
      return;
    }

    const copy = cloneTemplate(template, result.text);
    templates.push(copy);
    selectedTemplate = copy;
    selectedNode = copy.children && copy.children.length > 0 ? copy.children[0] : null;
    postSave();
    render();
  });
}

function cloneTemplate(template, name) {
  const cloneChildren = children =>
    (children || []).map(child => {
      const node = { name: child.name, isFolder: child.isFolder === true };
      if (child.content !== undefined) {
        node.content = child.content;
      }
      if (child.children && child.children.length > 0) {
        node.children = cloneChildren(child.children);
      }
      return node;
    });

  const copy = { name: name, createFolder: template.createFolder === true };
  if (template.children && template.children.length > 0) {
    copy.children = cloneChildren(template.children);
  }
  return copy;
}

function addChild(parent) {
  showInputDialog({
    title: "新增",
    label: "输入名称：",
    placeholder: "如：view.dart",
    checkboxLabel: "创建目录",
  }).then(result => {
    if (!result) {
      return;
    }

    if (!Array.isArray(parent.children)) {
      parent.children = [];
    }

    const node = { name: result.text, isFolder: result.checked };
    parent.children.push(node);
    parent._expanded = true;
    selectedNode = node;
    postSave();
    render();
  });
}

function renameNode(node) {
  showInputDialog({
    title: "重命名",
    label: "输入名称：",
    value: node.name,
  }).then(result => {
    if (!result) {
      return;
    }
    node.name = result.text;
    postSave();
    render();
  });
}

function deleteNode(node) {
  const parent = findParent(node);
  if (!parent) {
    return;
  }

  const children = parent.children || [];
  const index = children.indexOf(node);
  if (index < 0) {
    return;
  }

  children.splice(index, 1);
  if (selectedNode === node) {
    selectedNode = parent;
  }
  postSave();
  render();
}

function collectPlaceholders(children) {
  const set = new Set();
  const walk = list => {
    (list || []).forEach(node => {
      if (node.isFolder) {
        walk(node.children);
        return;
      }

      const content =
        node.tempContent !== undefined
          ? node.tempContent
          : node.content !== undefined
            ? node.content
            : "";
      const matches = content.match(/#[A-Za-z0-9_]*#/g);
      if (matches) {
        matches.forEach(item => set.add(item));
      }
    });
  };
  walk(children);
  return set;
}

function tryCreate() {
  const template = selectedTemplate;
  if (!template) {
    showToast("请选择要创建的模板");
    return;
  }

  const children = template.children || [];
  if (!template.createFolder && children.length === 0) {
    showToast("该模板没有可创建的内容");
    return;
  }

  const placeholders = collectPlaceholders(children);
  const customPlaceholders = Array.from(placeholders).filter(
    item => SPECIAL_PLACEHOLDERS.indexOf(item) === -1,
  );

  const send = values => {
    createBtn.disabled = true;
    vscode.postMessage({
      type: "create",
      templates: templates,
      index: templates.indexOf(template),
      placeholders: values,
      createCopy: createCopyEl.checked,
    });
  };

  if (customPlaceholders.length === 0) {
    send({});
    return;
  }

  showPlaceholderDialog(customPlaceholders).then(values => {
    if (!values) {
      return;
    }
    send(values);
  });
}

/* ---------------- 事件绑定 ---------------- */

contentEditorEl.addEventListener("input", () => {
  const node = selectedNode;
  if (!node || isContainer(node)) {
    return;
  }
  node.tempContent = contentEditorEl.value;
  applyBtn.disabled = contentEditorEl.value === (node.content || "");
  refreshHighlight();
});

contentEditorEl.addEventListener("scroll", syncEditorScroll);

contentEditorEl.addEventListener("compositionstart", () => {
  editorCodeEl.classList.add("composing");
});

contentEditorEl.addEventListener("compositionend", () => {
  editorCodeEl.classList.remove("composing");
  refreshHighlight();
});

contentEditorEl.addEventListener("keydown", event => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = contentEditorEl.selectionStart;
    const end = contentEditorEl.selectionEnd;
    const value = contentEditorEl.value;
    contentEditorEl.value =
      value.substring(0, start) + "  " + value.substring(end);
    contentEditorEl.selectionStart = contentEditorEl.selectionEnd = start + 2;
    contentEditorEl.dispatchEvent(new Event("input"));
  }
});

applyBtn.addEventListener("click", () => {
  const node = selectedNode;
  if (!node || isContainer(node)) {
    return;
  }
  node.content = contentEditorEl.value;
  node.tempContent = contentEditorEl.value;
  applyBtn.disabled = true;
  postSave();
});

addTemplateBtn.addEventListener("click", addTemplate);

addChildBtn.addEventListener("click", () => {
  if (selectedTemplate) {
    addChild(selectedTemplate);
  }
});

placeholderDescBtn.addEventListener("click", showPlaceholderDesc);

importBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "import" });
});

exportBtn.addEventListener("click", () => {
  if (!selectedTemplate) {
    showToast("请选择要导出的模板");
    return;
  }
  vscode.postMessage({
    type: "export",
    templates: [selectedTemplate],
    fileName: "template.json",
  });
});

exportAllBtn.addEventListener("click", () => {
  if (templates.length === 0) {
    showToast("没有可导出的模板");
    return;
  }
  vscode.postMessage({
    type: "export",
    templates: templates,
    fileName: "templates.json",
  });
});

createBtn.addEventListener("click", tryCreate);

cancelBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "cancel" });
});

window.addEventListener("message", event => {
  const message = event.data;
  if (!message) {
    return;
  }

  if (message.type === "createFailed") {
    createBtn.disabled = false;
    return;
  }

  if (message.type === "changeTheme") {
    isDarkTheme = message.isDarkTheme !== false;
    applyTheme();
    return;
  }

  if (message.type === "imported") {
    const imported = Array.isArray(message.templates) ? message.templates : [];
    if (imported.length === 0) {
      showToast("没有导入任何模板");
      return;
    }

    templates.push(...imported);
    postSave();
    render();
    showToast(`已导入 ${imported.length} 个模板`);
  }
});

if (templates.length > 0) {
  selectTemplate(templates[0]);
} else {
  render();
}
