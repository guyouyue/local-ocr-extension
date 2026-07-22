# 配置文件说明

本目录用于存储插件配置文件。

## 文件说明

- `default.json` - 默认配置模板（提交到 Git）
- 其他 `.json` 文件会被 `.gitignore` 忽略（本地配置）

## 配置字段

```json
{
  "lang": "chi_sim",          // OCR 语言包（tessdata）
  "delay": 300,               // 滚动截图延迟（毫秒）
  "historyLimit": 50          // 历史记录上限（条）
}
```

## 数据存储

实际配置数据存储在 `chrome.storage.local` 中，本目录仅作为配置模板和文档说明。

插件启动时会自动从 `default.json` 读取默认值，并与已保存的配置合并（缺失字段自动补全）。
