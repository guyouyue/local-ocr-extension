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

  // 优化 Tesseract 参数以提升识别率
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,  // 自动页面分割
    preserve_interword_spaces: '1',              // 保留词间空格
    tessedit_char_whitelist: '',                 // 不限制字符集
    // 提升识别质量
    textord_heavy_nr: '1',                       // 更好的噪声处理
    // 中文特定优化
    language_model_penalty_non_dict_word: '0.5', // 降低非字典词的惩罚
    language_model_penalty_non_freq_dict_word: '0.5'
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
