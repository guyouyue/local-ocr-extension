# Local OCR Extension

本地 OCR Chrome 扩展，支持整页、区域和容器文字识别。

## 功能特性

- 🖼️ **整页识别**：自动滚动截取整个页面并识别文字
- ✂️ **区域识别**：框选特定区域进行 OCR 识别
- 🎯 **容器识别**：类似开发者工具的元素选择器，点选页面容器进行识别
- 💾 **历史记录**：本地保存识别结果，支持查看、复制、删除、导出
- 🎨 **悬浮球界面**：集成化操作界面，拖动灵活，体验流畅
- 🔒 **本地处理**：所有 OCR 处理在浏览器本地完成，数据不上传

## 项目结构

```
local-ocr-extension/
├── src/
│   ├── background/          # Service Worker（后台服务）
│   ├── content/             # Content Script（页面脚本）
│   ├── pages/               # 扩展页面
│   │   ├── popup/           # 扩展弹窗
│   │   ├── options/         # 设置页面
│   │   ├── result/          # 结果窗口（已弃用）
│   │   └── ocr/             # OCR Worker（已弃用）
│   └── offscreen/           # Offscreen Document（OCR 处理）
├── libs/                    # 第三方库（Tesseract.js）
├── config/                  # 配置文件
├── icons/                   # 扩展图标
└── manifest.json            # 扩展清单
```

## 安装使用

1. 克隆或下载本项目
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目目录（local-ocr-extension/）

## 使用说明

1. 打开任意网页，右下角会出现紫色悬浮球
2. 点击悬浮球展开菜单：
   - **识别整页**：自动滚动识别整个页面
   - **框选识别**：框选特定区域进行识别
   - **容器识别**：类似开发者工具，点选页面容器进行识别
     - 移动鼠标高亮元素，显示标签名、类名、尺寸
     - 点击选中容器
     - 自动处理长容器（超过屏幕高度的内容）
     - 按 ESC 取消选择
   - **历史记录**：查看所有识别历史
   - **设置**：配置 OCR 语言和历史记录上限
3. 识别结果会显示在页面右上方的浮动面板中
4. 可以复制、下载、查看历史记录

## 技术栈

- **Manifest V3**：Chrome 扩展最新版本规范
- **Tesseract.js**：本地 OCR 引擎
- **Offscreen API**：后台 OCR 处理
- **Chrome Storage API**：本地配置和历史记录存储

## 配置说明

默认配置位于 `config/default.json`：

```json
{
  "lang": "chi_sim",      // OCR 语言（简体中文）
  "delay": 300,            // 滚动延迟（毫秒）
  "historyLimit": 50       // 历史记录上限（条）
}
```

实际配置存储在 `chrome.storage.local` 中，可在设置页面修改。

## 开发说明

详细的开发文档请参考 [CLAUDE.md](./CLAUDE.md)

## 许可证

MIT
