console.log('[Offscreen] offscreen.js script start');

// 全局 PaddleOCR 实例
let paddleOCR = null;
let ocrEngine = 'tesseract'; // 'tesseract' | 'paddleocr'

console.log('[Offscreen] initial state - paddleOCR:', paddleOCR, 'ocrEngine:', ocrEngine);

function errorToString(err) {
  if (err instanceof Error) return err.message || err.toString();
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string') return err.message;
  return JSON.stringify(err) || '未知错误';
}

// 发送进度到 background
function reportProgress(message) {
  console.log('[Offscreen Progress]', message);
  // 可以通过 chrome.runtime.sendMessage 发送进度给 background
}

/**
 * 使用 Tesseract 识别
 */
async function recognizeWithTesseract(images, lang) {
  console.log('[Offscreen] recognizeWithTesseract start, images:', images?.length, 'lang:', lang);
  reportProgress('使用 Tesseract 引擎');

  if (typeof Tesseract === 'undefined' || typeof Tesseract.createWorker !== 'function') {
    throw new Error('Tesseract 未加载');
  }

  reportProgress('初始化 Tesseract Worker...');
  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      console.log('[Offscreen] tesseract logger:', m.status, m.progress);
      if (m.status) reportProgress(`Tesseract: ${m.status} ${Math.round(m.progress * 100)}%`);
    },
    errorHandler: (err) => console.error('[Offscreen] worker error:', err),
    workerPath: chrome.runtime.getURL('libs/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('libs/tesseract/'),
    langPath: chrome.runtime.getURL('libs/tessdata/'),
    gzip: false,
    workerBlobURL: false
  });

  // 优化 Tesseract 参数以提升识别率
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: '',
    textord_heavy_nr: '1',
    language_model_penalty_non_dict_word: '0.5',
    language_model_penalty_non_freq_dict_word: '0.5'
  });

  let allText = '';
  for (let i = 0; i < images.length; i++) {
    reportProgress(`识别图片 ${i + 1}/${images.length}`);
    console.log('[Offscreen] recognizing image', i + 1, '/', images.length);
    const { data: { text } } = await worker.recognize(images[i]);
    console.log('[Offscreen] image', i + 1, 'recognized text length:', text?.length);
    if (text.trim()) {
      allText += (allText ? '\n' : '') + text.trim();
    }
  }
  await worker.terminate();
  console.log('[Offscreen] recognizeWithTesseract done, total length:', allText.length);
  return allText.trim() || '(未识别到文字)';
}

/**
 * 使用 PaddleOCR 识别
 */
async function recognizeWithPaddleOCR(images) {
  console.log('[Offscreen] recognizeWithPaddleOCR start, images:', images?.length);
  reportProgress('使用 PaddleOCR 引擎');

  // 初始化 PaddleOCR（如果还未初始化）
  if (!paddleOCR) {
    console.log('[Offscreen] initializing PaddleOCR...');
    reportProgress('正在初始化 PaddleOCR...');

    if (typeof PaddleOCR === 'undefined') {
      throw new Error('PaddleOCR 未加载');
    }

    paddleOCR = new PaddleOCR();
    const modelDir = chrome.runtime.getURL('libs/paddleocr');
    console.log('[Offscreen] model directory:', modelDir);
    reportProgress('正在加载模型（首次需要 5-10 秒）...');

    try {
      await paddleOCR.init(modelDir);
      console.log('[Offscreen] PaddleOCR initialized successfully');
      reportProgress('PaddleOCR 初始化完成');
    } catch (err) {
      console.error('[Offscreen] PaddleOCR init failed:', err);
      reportProgress(`初始化失败: ${err.message}`);
      throw err;
    }
  }

  let allText = '';
  for (let i = 0; i < images.length; i++) {
    reportProgress(`PaddleOCR 识别图片 ${i + 1}/${images.length}`);
    console.log('[Offscreen] recognizing image', i + 1, '/', images.length);
    try {
      const result = await paddleOCR.ocr(images[i]);
      console.log('[Offscreen] image', i + 1, 'recognized text length:', result.text?.length);
      reportProgress(`图片 ${i + 1} 识别完成，文字数: ${result.text?.length || 0}`);
      if (result.text.trim()) {
        allText += (allText ? '\n' : '') + result.text.trim();
      }
    } catch (err) {
      console.error('[Offscreen] PaddleOCR recognition failed for image', i, err);
      reportProgress(`图片 ${i + 1} 识别失败: ${err.message}`);
    }
  }

  console.log('[Offscreen] recognizeWithPaddleOCR done, total length:', allText.length);
  return allText.trim() || '(未识别到文字)';
}

/**
 * 主识别函数
 */
async function recognizeImages(images, lang, engine = 'tesseract') {
  console.log('[Offscreen] recognizeImages start, images:', images?.length, 'lang:', lang, 'engine:', engine);
  reportProgress(`开始识别，引擎: ${engine}`);

  ocrEngine = engine;

  if (engine === 'paddleocr') {
    return await recognizeWithPaddleOCR(images);
  } else {
    return await recognizeWithTesseract(images, lang);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Offscreen] received message:', request.action, 'from:', sender);

  // 响应 ping 消息
  if (request.action === 'ping') {
    console.log('[Offscreen] responding to ping');
    sendResponse({ ok: true, ready: true });
    return false;
  }

  if (request.action === 'recognizeImages') {
    recognizeImages(request.images, request.lang, request.engine)
      .then((text) => {
        console.log('[Offscreen] recognizeImages success');
        reportProgress('识别完成');
        sendResponse({ text });
      })
      .catch((err) => {
        const msg = errorToString(err);
        console.error('[Offscreen] recognizeImages error:', msg, err);
        reportProgress(`识别失败: ${msg}`);
        sendResponse({ error: msg });
      });
    return true;
  }
  // 不处理其他消息，返回 false 让其他 listener 处理
  return false;
});

// 监听端口连接（用于 OCR 识别）
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Offscreen] port connected:', port.name);

  if (port.name === 'ocr-channel') {
    port.onMessage.addListener(async (request) => {
      console.log('[Offscreen] received message via port:', request.action);

      if (request.action === 'recognizeImages') {
        try {
          const text = await recognizeImages(request.images, request.lang, request.engine);
          console.log('[Offscreen] recognizeImages success via port');
          reportProgress('识别完成');
          port.postMessage({ text });
        } catch (err) {
          const msg = errorToString(err);
          console.error('[Offscreen] recognizeImages error via port:', msg, err);
          reportProgress(`识别失败: ${msg}`);
          port.postMessage({ error: msg });
        }
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[Offscreen] port disconnected');
    });
  }
});

console.log('[Offscreen] message listener registered');
