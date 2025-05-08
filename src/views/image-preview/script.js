const vscode = acquireVsCodeApi();
// 获取DOM元素
const listView = document.getElementById("list-view");
const gridView = document.getElementById("grid-view");
const viewButtons = document.querySelectorAll(".view-btn");
const currentPathElement = document.getElementById("current-path");
const loadingElement = document.getElementById("loading");
const noImagesElement = document.getElementById("no-images");
const refreshBtn = document.getElementById("refresh-btn");
const selectDirBtn = document.getElementById("select-dir-btn");
const searchInput = document.getElementById("search-input");
let isRefresh = false;

// 搜索内容发生变化
searchInput.addEventListener("input", (e) => {});

// 视图切换
viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    // 移除所有按钮的active类
    viewButtons.forEach((btn) => btn.classList.remove("active"));
    // 添加当前按钮的active类
    button.classList.add("active");
    // 获取视图类型
    const viewType = button.getAttribute("data-view");
    // 切换视图
    if (viewType === "list") {
      listView.classList.add("active");
      gridView.classList.remove("active");
    } else {
      gridView.classList.add("active");
      listView.classList.remove("active");
    }
  });
});

// 选择本地目录按钮点击事件
selectDirBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "changeDir" });
});

// 刷新按钮点击事件
refreshBtn.addEventListener("click", () => {
  if (isRefresh) {
    return;
  }

  isRefresh = true;
  if (noImagesElement.style.display == "block") {
    noImagesElement.style.display = "none";
    loadingElement.style.display == "block";
  }
  vscode.postMessage({ type: "refresh" });
});

// 加载图片
function loadImages(images) {
  // 显示加载中
  isRefresh = false;
  loadingElement.style.display = "none";
  if (images == null || images == undefined || images.length === 0) {
    noImagesElement.style.display = "block";
    return;
  }

  noImagesElement.style.display = "none";
  renderImages(images);
}

// 渲染图片
function renderImages(images) {
  // 清空视图
  listView.innerHTML = "";
  gridView.innerHTML = "";

  // 遍历本地图片列表
  images.forEach((image) => {
    // 创建列表视图项
    const listItem = document.createElement("div");
    listItem.className = "list-item";
    listItem.innerHTML = `
            <img src="${image.path}" alt="${image.name}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width%3D%2224%22 height%3D%2224%22 viewBox%3D%220 0 24 24%22%3E%3Cpath fill%3D%22%23CCC%22 d%3D%22M21.9 21.9l-8.9-8.9-8.9 8.9H21.9zM2.1 2.1v19.8L21.9 2.1H2.1z%22%2F%3E%3C%2Fsvg%3E'">
            <div class="image-info">
                <div class="image-name">${image.name}</div>
                <div class="image-path">${image.showPath}</div>
            </div>
        `;
    listView.appendChild(listItem);

    // 创建网格视图项
    const gridItem = document.createElement("div");
    gridItem.className = "grid-item";
    gridItem.innerHTML = `
            <div class="image-container">
                <img src="${image.path}" alt="${image.name}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width%3D%2224%22 height%3D%2224%22 viewBox%3D%220 0 24 24%22%3E%3Cpath fill%3D%22%23CCC%22 d%3D%22M21.9 21.9l-8.9-8.9-8.9 8.9H21.9zM2.1 2.1v19.8L21.9 2.1H2.1z%22%2F%3E%3C%2Fsvg%3E'">
            </div>
            <div class="image-info">
                <div class="image-name">${image.name}</div>
                <div class="image-path">${image.showPath}</div>
            </div>
        `;
    gridView.appendChild(gridItem);

    // 添加点击事件，显示大图预览
    listItem.addEventListener("click", () => showPreview(image.previewPath));
    gridItem.addEventListener("click", () => showPreview(image.previewPath));
  });
}

// 显示图片预览
function showPreview(imagePath) {
  vscode.postMessage({ type: "preview", url: imagePath });
}

function init(data) {
  if (data.isDarkTheme) {
    document.body.classList.add("dark-mode");
  }
  currentPathElement.textContent = data.path;
}

function changeTheme(data) {
  if (data.isDarkTheme) {
    document.body.classList.add("dark-mode");
  } else {
    document.body.classList.remove("dark-mode");
  }
  refreshBtn.setAttribute("src", data.refreshBtnUri);
  viewButtons.forEach((button) => {
    const viewType = button.getAttribute("data-view");
    // 切换视图
    if (viewType === "list") {
      button.setAttribute("src", data.listBtnUri);
    } else {
      button.setAttribute("src", data.gridBtnUri);
    }
  });
}

// Handle messages sent from the extension to the webview
window.addEventListener("message", (event) => {
  const message = event.data; // The json data that the extension sent
  switch (message.type) {
    case "init_data":
      init(message.data);
      break;

    case "changeTheme":
      changeTheme(message);
      break;

    case "loadImages":
      loadImages(message.data);
      break;
  }
});
