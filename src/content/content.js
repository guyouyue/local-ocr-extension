let overlayRoot = null;
let floatBallRoot = null;
let floatMenuRoot = null;
let floatPanelRoot = null;
let currentPanelMode = null;
let tesseractReady = false;
let tesseractLoading = null;

console.log('[Content] content script loaded, location:', location.href);

function loadTesseractScript() {
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    if (typeof Tesseract !== 'undefined' && Tesseract.createWorker) {
      console.log('[Content] Tesseract already loaded');
      tesseractReady = true;
      return resolve();
    }
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('libs/tesseract/tesseract.min.js');
    script.onload = () => {
      console.log('[Content] Tesseract script loaded, createWorker:', typeof Tesseract?.createWorker);
      if (typeof Tesseract?.createWorker !== 'function') {
        return reject(new Error('Tesseract.createWorker 不可用'));
      }
      tesseractReady = true;
      resolve();
    };
    script.onerror = (err) => reject(new Error('Tesseract script load failed'));
    document.head.appendChild(script);
  });
  return tesseractLoading;
}

function errorToString(err) {
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string') return err.message;
  return JSON.stringify(err) || '未知错误';
}

async function recognizeImages(images, lang, baseUrl) {
  showStatus('正在加载 OCR 引擎…');
  try {
    await loadTesseractScript();
  } catch (err) {
    console.error('[Content] loadTesseractScript error:', err);
    throw err;
  }
  console.log('[Content] recognizeImages start, images:', images.length, 'lang:', lang, 'base:', baseUrl);
  showStatus('正在初始化 OCR Worker…');

  const workerOptions = {
    logger: (m) => {
      console.log('[Content] tesseract logger:', m.status, m.progress);
      showStatus(`OCR: ${m.status} ${Math.round((m.progress || 0) * 100)}%`);
    },
    errorHandler: (err) => console.error('[Content] worker error:', err),
    workerPath: chrome.runtime.getURL('libs/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('libs/tesseract/'),
    langPath: chrome.runtime.getURL('libs/tessdata/'),
    gzip: false,
    workerBlobURL: false
  };

  console.log('[Content] createWorker options:', workerOptions);
  let worker;
  try {
    worker = await Tesseract.createWorker(lang, 1, workerOptions);
  } catch (err) {
    console.error('[Content] createWorker failed:', err);
    throw new Error('createWorker 失败: ' + errorToString(err));
  }
  console.log('[Content] worker created');

  let allText = '';
  for (let i = 0; i < images.length; i++) {
    showStatus(`正在识别第 ${i + 1}/${images.length} 段…`);
    console.log('[Content] recognizing image', i + 1, '/', images.length);
    try {
      const { data: { text } } = await worker.recognize(images[i]);
      console.log('[Content] image', i + 1, 'recognized text length:', text?.length);
      if (text.trim()) allText += `\n--- 分段 ${i + 1} ---\n${text.trim()}`;
    } catch (err) {
      console.error('[Content] recognize image error:', err);
    }
  }
  await worker.terminate();
  console.log('[Content] recognizeImages done, total length:', allText.length);
  hideStatus();
  return allText.trim() || '(未识别到文字)';
}

function showStatus(text) {
  console.log('[Content] showStatus:', text);
  if (overlayRoot) overlayRoot.remove();
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'kst-ocr-status';
  overlayRoot.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    background: rgba(0,0,0,0.8);
    color: #fff;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
    font-size: 14px;
    pointer-events: none;
    max-width: 260px;
    line-height: 1.4;
  `;
  overlayRoot.textContent = text;
  document.body.appendChild(overlayRoot);
}

function hideStatus() {
  console.log('[Content] hideStatus');
  if (overlayRoot) {
    overlayRoot.remove();
    overlayRoot = null;
  }
}

function createFloatBall() {
  console.log('[Content] createFloatBall');
  if (floatBallRoot) return;

  floatBallRoot = document.createElement('div');
  floatBallRoot.id = 'kst-ocr-float-ball';
  floatBallRoot.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 50%;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    cursor: pointer;
    z-index: 2147483645;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
    user-select: none;
  `;

  const icon = document.createElement('div');
  icon.style.cssText = `
    width: 28px;
    height: 28px;
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>') center/contain no-repeat;
    pointer-events: none;
  `;
  floatBallRoot.appendChild(icon);

  floatBallRoot.addEventListener('mouseenter', () => {
    floatBallRoot.style.transform = 'scale(1.1)';
    floatBallRoot.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
  });

  floatBallRoot.addEventListener('mouseleave', () => {
    floatBallRoot.style.transform = 'scale(1)';
    floatBallRoot.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  });

  floatBallRoot.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFloatMenu();
  });

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let ballStartX = 0;
  let ballStartY = 0;

  floatBallRoot.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = floatBallRoot.getBoundingClientRect();
    ballStartX = rect.left;
    ballStartY = rect.top;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    floatBallRoot.style.left = `${ballStartX + deltaX}px`;
    floatBallRoot.style.top = `${ballStartY + deltaY}px`;
    floatBallRoot.style.bottom = 'auto';
    floatBallRoot.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => { isDragging = false; });

  document.body.appendChild(floatBallRoot);
}

function toggleFloatMenu() {
  if (floatMenuRoot) {
    floatMenuRoot.remove();
    floatMenuRoot = null;
    return;
  }

  const ballRect = floatBallRoot.getBoundingClientRect();
  floatMenuRoot = document.createElement('div');
  floatMenuRoot.id = 'kst-ocr-float-menu';
  floatMenuRoot.style.cssText = `
    position: fixed;
    bottom: ${window.innerHeight - ballRect.top + 10}px;
    right: ${window.innerWidth - ballRect.right}px;
    width: 180px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    z-index: 2147483644;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
  `;

  const menuItems = [
    { label: '识别整页', icon: '📄', action: () => handleFullPageOcr() },
    { label: '框选识别', icon: '🔲', action: () => handleAreaOcr() },
    { label: '历史记录', icon: '🕒', action: () => showHistoryPanel() },
    { label: '设置', icon: '⚙️', action: () => chrome.runtime.sendMessage({ action: 'openOptions' }) }
  ];

  menuItems.forEach((item, index) => {
    const menuItem = document.createElement('div');
    menuItem.style.cssText = `
      padding: 12px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: #333;
      transition: background 0.2s;
      ${index < menuItems.length - 1 ? 'border-bottom: 1px solid #f0f0f0;' : ''}
    `;

    const iconSpan = document.createElement('span');
    iconSpan.textContent = item.icon;
    iconSpan.style.fontSize = '18px';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;

    menuItem.appendChild(iconSpan);
    menuItem.appendChild(labelSpan);

    menuItem.addEventListener('mouseenter', () => {
      menuItem.style.background = '#f5f5f5';
    });

    menuItem.addEventListener('mouseleave', () => {
      menuItem.style.background = '#fff';
    });

    menuItem.addEventListener('click', () => {
      floatMenuRoot.remove();
      floatMenuRoot = null;
      item.action();
    });

    floatMenuRoot.appendChild(menuItem);
  });

  document.body.appendChild(floatMenuRoot);

  setTimeout(() => {
    document.addEventListener('click', closeFloatMenuOnClickOutside);
  }, 100);
}

function closeFloatMenuOnClickOutside(e) {
  if (floatMenuRoot && !floatMenuRoot.contains(e.target) && !floatBallRoot.contains(e.target)) {
    floatMenuRoot.remove();
    floatMenuRoot = null;
    document.removeEventListener('click', closeFloatMenuOnClickOutside);
  }
}

function ensurePanel() {
  if (floatPanelRoot) return floatPanelRoot;

  floatPanelRoot = document.createElement('div');
  floatPanelRoot.id = 'kst-ocr-float-panel';
  floatPanelRoot.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    width: 420px;
    max-height: 80vh;
    background: #fff;
    color: #333;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.24);
    z-index: 2147483646;
    display: none;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
    font-size: 13px;
  `;

  document.body.appendChild(floatPanelRoot);
  return floatPanelRoot;
}

function showPanel(title, contentEl, mode) {
  const panel = ensurePanel();
  currentPanelMode = mode;
  panel.style.display = 'flex';
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    font-weight: 500;
    cursor: move;
    user-select: none;
  `;
  header.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `
    background: transparent;
    border: none;
    color: #fff;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  `;
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.style.cssText = `
    padding: 0;
    overflow-y: auto;
    max-height: calc(80vh - 48px);
  `;
  body.appendChild(contentEl);

  panel.appendChild(header);
  panel.appendChild(body);

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = `${e.clientX - dragOffsetX}px`;
    panel.style.top = `${e.clientY - dragOffsetY}px`;
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  if (floatMenuRoot) {
    floatMenuRoot.remove();
    floatMenuRoot = null;
  }
}

async function showResultInPanel(text, title, type = '') {
  console.log('[Content] showResultInPanel, text length:', text?.length);
  const content = document.createElement('div');
  content.style.cssText = 'padding: 14px; display: flex; flex-direction: column; gap: 12px;';

  const resultText = document.createElement('div');
  resultText.style.cssText = `
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    max-height: 50vh;
    overflow-y: auto;
    padding: 10px;
    background: #f8f9fa;
    border-radius: 6px;
    font-size: 13px;
  `;
  resultText.textContent = text || '(无内容)';

  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; gap: 8px;';

  const copyBtn = createPanelButton('复制全部', '#1a73e8', '#fff');
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '已复制';
      setTimeout(() => copyBtn.textContent = '复制全部', 1500);
    });
  };

  const downloadBtn = createPanelButton('下载 TXT', '#fff', '#333');
  downloadBtn.style.border = '1px solid #dadce0';
  downloadBtn.onclick = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocr-result.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const historyBtn = createPanelButton('查看历史', '#fff', '#333');
  historyBtn.style.border = '1px solid #dadce0';
  historyBtn.onclick = () => showHistoryPanel();

  footer.appendChild(copyBtn);
  footer.appendChild(downloadBtn);
  footer.appendChild(historyBtn);
  content.appendChild(resultText);
  content.appendChild(footer);

  showPanel(title || 'OCR 识别结果', content, 'result');
}

function createPanelButton(text, bg, color) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    flex: 1;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: ${bg};
    color: ${color};
    font-size: 13px;
    cursor: pointer;
    transition: opacity 0.2s;
  `;
  btn.addEventListener('mouseenter', () => btn.style.opacity = '0.85');
  btn.addEventListener('mouseleave', () => btn.style.opacity = '1');
  return btn;
}

async function showHistoryPanel(highlightId = null) {
  console.log('[Content] showHistoryPanel');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ action: 'getHistory' });
  } catch (err) {
    console.error('[Content] getHistory failed:', err);
    showResultInPanel('获取历史记录失败: ' + (err?.message || err), '错误');
    return;
  }
  console.log('[Content] getHistory response:', res);
  const history = (res && res.history) || [];
  console.log('[Content] history count:', history.length);

  const content = document.createElement('div');
  content.style.cssText = 'display: flex; flex-direction: column;';

  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    display: flex;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid #e8eaed;
    background: #f8f9fa;
  `;

  const clearBtn = createPanelButton('清空全部', '#ea4335', '#fff');
  clearBtn.onclick = async () => {
    if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) return;
    await chrome.runtime.sendMessage({ action: 'clearHistory' });
    showHistoryPanel();
  };

  const exportBtn = createPanelButton('导出全部', '#fff', '#333');
  exportBtn.style.border = '1px solid #dadce0';
  exportBtn.onclick = async () => {
    const res = await chrome.runtime.sendMessage({ action: 'getHistory' });
    const history = res.history || [];
    if (!history.length) return alert('没有历史记录可导出');
    const text = history.map(item => {
      return `[${item.date}] ${item.type === 'full' ? '整页识别' : '框选识别'} (${item.id})\n${item.text}\n${'='.repeat(50)}`;
    }).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-history-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const countSpan = document.createElement('span');
  countSpan.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: flex-end; font-size: 13px; color: #666;';
  countSpan.textContent = `共 ${history.length} 条`;

  toolbar.appendChild(clearBtn);
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(countSpan);
  content.appendChild(toolbar);

  const listContainer = document.createElement('div');
  listContainer.style.cssText = 'max-height: 60vh; overflow-y: auto; padding: 8px 0;';

  if (history.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.style.cssText = 'text-align: center; padding: 40px 20px; color: #999;';
    emptyEl.textContent = '暂无历史记录';
    listContainer.appendChild(emptyEl);
  } else {
    history.forEach((item, index) => {
      const itemEl = document.createElement('div');
      const isHighlighted = item.id === highlightId;
      itemEl.style.cssText = `
        padding: 12px 14px;
        border-bottom: 1px solid #f0f0f0;
        cursor: pointer;
        transition: background 0.2s;
        background: ${isHighlighted ? '#e8f0fe' : '#fff'};
      `;
      itemEl.addEventListener('mouseenter', () => { if (!isHighlighted) itemEl.style.background = '#f8f9fa'; });
      itemEl.addEventListener('mouseleave', () => { itemEl.style.background = isHighlighted ? '#e8f0fe' : '#fff'; });

      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;';

      const title = document.createElement('span');
      title.style.cssText = 'font-weight: 500; color: #1a73e8; font-size: 13px;';
      title.textContent = `#${index + 1} ${item.type === 'full' ? '整页识别' : '框选识别'}`;

      const time = document.createElement('span');
      time.style.cssText = 'font-size: 12px; color: #999;';
      time.textContent = item.date;

      const preview = document.createElement('div');
      preview.style.cssText = `
        font-size: 13px;
        color: #555;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      `;
      preview.textContent = item.text || '(无内容)';

      const actions = document.createElement('div');
      actions.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';

      const viewBtn = createSmallButton('查看');
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        showHistoryItemDetail(item);
      };

      const copyBtn = createSmallButton('复制');
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(item.text);
        copyBtn.textContent = '已复制';
        setTimeout(() => copyBtn.textContent = '复制', 1500);
      };

      const deleteBtn = createSmallButton('删除', '#ea4335');
      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('确定删除这条历史记录吗？')) return;
        await chrome.runtime.sendMessage({ action: 'deleteHistoryItem', id: item.id });
        showHistoryPanel();
      };

      actions.appendChild(viewBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(deleteBtn);

      header.appendChild(title);
      header.appendChild(time);
      itemEl.appendChild(header);
      itemEl.appendChild(preview);
      itemEl.appendChild(actions);

      itemEl.addEventListener('click', () => showHistoryItemDetail(item));
      listContainer.appendChild(itemEl);
    });
  }

  content.appendChild(listContainer);
  showPanel('历史记录', content, 'history');
}

function createSmallButton(text, color = '#1a73e8') {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    padding: 4px 10px;
    border: 1px solid ${color};
    border-radius: 4px;
    background: transparent;
    color: ${color};
    font-size: 12px;
    cursor: pointer;
  `;
  return btn;
}

function showHistoryItemDetail(item) {
  console.log('[Content] showHistoryItemDetail, id:', item.id);
  showResultInPanel(item.text, `历史记录 #${item.id}`, item.type);
}

async function handleFullPageOcr() {
  console.log('[Content] handleFullPageOcr');
  try {
    showStatus('正在识别整页…');
    const res = await chrome.runtime.sendMessage({ action: 'startFullOcr' });
    console.log('[Content] startFullOcr response:', res);
  } catch (err) {
    console.error('[Content] handleFullPageOcr failed:', err);
    hideStatus();
    showResultInPanel(`错误：${err.message}`, '识别失败');
  }
}

async function handleAreaOcr() {
  console.log('[Content] handleAreaOcr');
  startAreaSelection();
}

function getPageMetrics(captureArea = null) {
  console.log('[Content] getPageMetrics called, captureArea:', captureArea);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const doc = document.documentElement;
  const body = document.body;
  const fullWidth = captureArea ? captureArea.width : Math.max(doc.scrollWidth, body.scrollWidth);
  const fullHeight = captureArea ? captureArea.height : Math.max(doc.scrollHeight, body.scrollHeight);

  const metrics = {
    viewportWidth: width,
    viewportHeight: height,
    totalWidth: fullWidth,
    totalHeight: fullHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    captureArea: captureArea ? { x: captureArea.x, y: captureArea.y, width: captureArea.width, height: captureArea.height } : null
  };
  console.log('[Content] metrics:', metrics);
  return metrics;
}

function scrollToY(y) {
  console.log('[Content] scrollToY:', y);
  window.scrollTo(0, y);
}

function cropScreenshot(dataUrl, offsetY, metrics, captureArea) {
  console.log('[Content] cropScreenshot called, dataUrl length:', dataUrl?.length, 'offsetY:', offsetY, 'captureArea:', captureArea);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      console.log('[Content] image loaded size:', img.width, 'x', img.height);
      const dpr = metrics.devicePixelRatio;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const vpW = metrics.viewportWidth * dpr;
      const vpH = metrics.viewportHeight * dpr;

      let srcX = 0;
      let srcY = 0;
      let srcW = vpW;
      let srcH = Math.min(vpH, img.height);

      if (captureArea) {
        const ax = captureArea.x * dpr;
        const ay = captureArea.y * dpr;
        const aw = captureArea.width * dpr;
        const ah = captureArea.height * dpr;
        const offsetYPx = offsetY * dpr;

        if (ay + ah <= offsetYPx || ay >= offsetYPx + vpH) {
          console.log('[Content] area out of current viewport, skip');
          return resolve(null);
        }

        srcX = ax;
        srcY = Math.max(0, ay - offsetYPx);
        const maxSrcH = vpH - srcY;
        srcW = aw;
        srcH = Math.min(ah, maxSrcH);
      }

      canvas.width = srcW;
      canvas.height = srcH;
      console.log('[Content] cropping canvas:', srcW, 'x', srcH, 'from', srcX, srcY);
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      resolve({ result: canvas.toDataURL('image/png') });
    };
    img.onerror = (err) => {
      console.error('[Content] image load error:', err);
      resolve({ error: '截图加载失败' });
    };
    img.src = dataUrl;
  });
}

function startAreaSelection() {
  console.log('[Content] startAreaSelection called');
  const overlayId = 'kst-ocr-overlay';
  if (document.getElementById(overlayId)) {
    console.log('[Content] overlay already exists');
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483647;
    cursor: crosshair;
    background: rgba(0,0,0,0.3);
  `;

  const selection = document.createElement('div');
  selection.style.cssText = `
    position: absolute;
    border: 2px dashed #1a73e8;
    background: rgba(26,115,232,0.15);
    display: none;
  `;
  overlay.appendChild(selection);
  document.body.appendChild(overlay);

  let startX = 0;
  let startY = 0;

  function onMouseDown(e) {
    startX = e.clientX;
    startY = e.clientY;
    selection.style.left = `${startX}px`;
    selection.style.top = `${startY}px`;
    selection.style.width = '0px';
    selection.style.height = '0px';
    selection.style.display = 'block';
  }

  function onMouseMove(e) {
    if (selection.style.display === 'none') return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    selection.style.left = `${x}px`;
    selection.style.top = `${y}px`;
    selection.style.width = `${Math.abs(e.clientX - startX)}px`;
    selection.style.height = `${Math.abs(e.clientY - startY)}px`;
  }

  async function onMouseUp(e) {
    overlay.removeEventListener('mousedown', onMouseDown);
    overlay.removeEventListener('mousemove', onMouseMove);
    overlay.removeEventListener('mouseup', onMouseUp);
    overlay.remove();

    const x = Math.min(e.clientX, startX) + window.scrollX;
    const y = Math.min(e.clientY, startY) + window.scrollY;
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);

    if (width < 10 || height < 10) return;

    console.log('[Content] area selected:', { x, y, width, height });
    try {
      showStatus('正在识别框选区域…');
      const res = await chrome.runtime.sendMessage({ action: 'startAreaOcr', area: { x, y, width, height } });
      console.log('[Content] startAreaOcr response:', res);
    } catch (err) {
      console.error('[Content] startAreaOcr failed:', err);
      hideStatus();
      showResultInPanel(`错误：${err.message}`, '识别失败');
    }
  }

  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup', onMouseUp);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content] received message:', request.action, 'from:', sender?.id);

  if (request.action === 'ping') {
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === 'getPageMetrics') {
    try {
      const metrics = getPageMetrics(request.captureArea);
      console.log('[Content] sending metrics:', metrics);
      sendResponse(metrics);
    } catch (err) {
      console.error('[Content] getPageMetrics error:', err);
      sendResponse({ error: errorToString(err) });
    }
    return true;
  }
  if (request.action === 'scrollToY') {
    try {
      scrollToY(request.y);
      sendResponse({ ok: true });
    } catch (err) {
      console.error('[Content] scrollToY error:', err);
      sendResponse({ error: errorToString(err) });
    }
    return true;
  }
  if (request.action === 'cropScreenshot') {
    cropScreenshot(request.dataUrl, request.offsetY, request.metrics, request.captureArea)
      .then((res) => {
        console.log('[Content] cropScreenshot resolved:', res ? (res.length ? 'data url length ' + res.length : res) : 'null');
        sendResponse(res);
      })
      .catch((err) => {
        console.error('[Content] cropScreenshot error:', err);
        sendResponse({ error: errorToString(err) });
      });
    return true;
  }
  if (request.action === 'startAreaSelection') {
    try {
      startAreaSelection();
      sendResponse({ ok: true });
    } catch (err) {
      console.error('[Content] startAreaSelection error:', err);
      sendResponse({ error: errorToString(err) });
    }
    return true;
  }
  if (request.action === 'recognizeImages') {
    console.log('[Content] recognizeImages message received');
    recognizeImages(request.images, request.lang, request.baseUrl)
      .then((text) => {
        console.log('[Content] recognizeImages success, text length:', text?.length);
        sendResponse({ text });
      })
      .catch((err) => {
        const msg = errorToString(err);
        console.error('[Content] recognizeImages error:', msg, err);
        sendResponse({ error: msg });
      });
    return true;
  }
  if (request.action === 'showOcrResult') {
    console.log('[Content] received showOcrResult, text length:', request.text?.length);
    hideStatus();
    if (request.error) {
      showResultInPanel(`错误：${request.error}`, '识别失败');
    } else {
      showResultInPanel(request.text || '(未识别到文字)', request.title || 'OCR 识别结果', request.type);
    }
    sendResponse({ ok: true });
    return true;
  }
});

setTimeout(() => {
  createFloatBall();
}, 500);
