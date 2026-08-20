// Mermaid + ECharts + Translate renderers.
// Each block diagram / chart / translation in the assistant message
// stream is rendered by one of these.

export const renderers = {
  // Mermaid
  "Failed to render Mermaid diagram": "Mermaid 图渲染失败",
  "Failed to render SVG": "SVG 渲染失败",
  "Download SVG": "下载 SVG",
  ASCII: "ASCII",
  "Copy as ASCII": "复制为 ASCII",
  "View source": "查看源码",
  "View diagram": "查看图表",

  // ECharts
  "Failed to render ECharts chart": "ECharts 图表渲染失败",
  "Download PNG": "下载 PNG",
  "Rendering…": "渲染中…",

  // Translate panel (right-panel tab)
  "Translate": "翻译",
  "Translate (⌘+Enter)": "翻译 (⌘+Enter)",
  "Open translate": "打开翻译",
  "Target language": "目标语言",
  "toChinese": "to中文",
  "toEnglish": "to英文",
  "Current target: {lang}": "当前目标语言：{lang}",
  "Switch to {lang}": "切换为{lang}",
  "Translation input": "翻译输入",
  "Translation output": "译文",
  "Type text to translate…": "输入要翻译的内容…",
  "Translated text will appear here": "翻译结果将显示在此处",
  "Translating…": "正在翻译…",
  "Translation failed": "翻译失败",
  "Prompt preview": "提示词预览",
  "Reset to default": "恢复默认",
} as const;
