console.log('[Offscreen] loaded');

function errorToString(err) {
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string') return err.message;
  return JSON.stringify(err) || '未知错误';
}

async function recognizeImages(images, lang) {
  console.log('[Offscreen] recognizeImages start, images:', images?.length, 'lang:', lang);
  if (typeof Tesseract === 'undefined' || typeof Tesseract.createWorker !== 'function') {
    throw new Error('Tesseract 未加载');
  }

  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => console.log('[Offscreen] tesseract logger:', m.status, m.progress),
    errorHandler: (err) => console.error('[Offscreen] worker error:', err),
    workerPath: chrome.runtime.getURL('libs/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('libs/tesseract/'),
    langPath: chrome.runtime.getURL('libs/tessdata/'),
    gzip: false,
    workerBlobURL: false
  });

  let allText = '';
  for (let i = 0; i < images.length; i++) {
    console.log('[Offscreen] recognizing image', i + 1, '/', images.length);
    const { data: { text } } = await worker.recognize(images[i]);
    console.log('[Offscreen] image', i + 1, 'recognized text length:', text?.length);
    if (text.trim()) {
      allText += (allText ? '\n' : '') + text.trim();
    }
  }
  await worker.terminate();
  console.log('[Offscreen] recognizeImages done, total length:', allText.length);
  return allText.trim() || '(未识别到文字)';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Offscreen] received message:', request.action);
  if (request.action === 'recognizeImages') {
    recognizeImages(request.images, request.lang)
      .then((text) => {
        console.log('[Offscreen] recognizeImages success');
        sendResponse({ text });
      })
      .catch((err) => {
        const msg = errorToString(err);
        console.error('[Offscreen] recognizeImages error:', msg, err);
        sendResponse({ error: msg });
      });
    return true;
  }
  // 不处理其他消息，返回 false 让其他 listener 处理
  return false;
});
