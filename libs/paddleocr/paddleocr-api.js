console.log('[PaddleOCR API] loaded');

/**
 * PaddleOCR 在线 API 客户端
 */
class PaddleOCRAPI {
  constructor() {
    this.apiUrl = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
    this.token = null;
    this.model = 'PaddleOCR-VL-1.6';
  }

  /**
   * 设置 API Token
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * 设置模型
   */
  setModel(model) {
    this.model = model;
  }

  /**
   * 提交 OCR 任务
   */
  async submitJob(imageDataUrl) {
    if (!this.token) {
      throw new Error('PaddleOCR API token not set');
    }

    console.log('[PaddleOCR API] Submitting OCR job...');
    console.log('[PaddleOCR API] Token:', this.token ? `${this.token.substring(0, 10)}...` : 'null');
    console.log('[PaddleOCR API] Model:', this.model);

    // 将 data URL 转换为 blob
    const blob = await this.dataURLToBlob(imageDataUrl);
    console.log('[PaddleOCR API] Image blob size:', blob.size, 'bytes');

    // 构建表单数据
    const formData = new FormData();
    formData.append('file', blob, 'image.png');
    formData.append('model', this.model);
    formData.append('optionalPayload', JSON.stringify({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false
    }));

    // 提交任务
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${this.token}`
      },
      body: formData
    });

    console.log('[PaddleOCR API] Response status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('[PaddleOCR API] Error response:', text);
      throw new Error(`API request failed: ${response.status} ${text}`);
    }

    const result = await response.json();
    if (!result.data || !result.data.jobId) {
      throw new Error('Invalid API response: missing jobId');
    }

    const jobId = result.data.jobId;
    console.log('[PaddleOCR API] Job submitted, jobId:', jobId);

    return jobId;
  }

  /**
   * 轮询任务状态
   */
  async pollJobStatus(jobId, onProgress) {
    console.log('[PaddleOCR API] Polling job status:', jobId);

    const maxAttempts = 60; // 最多轮询 60 次（5 分钟）
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;

      const response = await fetch(`${this.apiUrl}/${jobId}`, {
        headers: {
          'Authorization': `bearer ${this.token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get job status: ${response.status}`);
      }

      const result = await response.json();
      const state = result.data.state;

      if (state === 'pending') {
        console.log('[PaddleOCR API] Job pending...');
        if (onProgress) onProgress('等待处理中...');
      } else if (state === 'running') {
        const totalPages = result.data.extractProgress?.totalPages || 0;
        const extractedPages = result.data.extractProgress?.extractedPages || 0;
        console.log(`[PaddleOCR API] Job running: ${extractedPages}/${totalPages}`);
        if (onProgress) onProgress(`识别中：${extractedPages}/${totalPages} 页`);
      } else if (state === 'done') {
        console.log('[PaddleOCR API] Job completed');
        const jsonlUrl = result.data.resultUrl?.jsonUrl;
        if (!jsonlUrl) {
          throw new Error('Missing result URL in completed job');
        }
        return jsonlUrl;
      } else if (state === 'failed') {
        const errorMsg = result.data.errorMsg || 'Unknown error';
        throw new Error(`OCR job failed: ${errorMsg}`);
      }

      // 等待 5 秒后继续轮询
      await this.sleep(5000);
    }

    throw new Error('OCR job timeout after 5 minutes');
  }

  /**
   * 获取识别结果
   */
  async getResult(jsonlUrl) {
    console.log('[PaddleOCR API] Fetching result from:', jsonlUrl);

    const response = await fetch(jsonlUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch result: ${response.status}`);
    }

    const text = await response.text();
    const lines = text.trim().split('\n');

    let allText = '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const data = JSON.parse(line);
        const result = data.result;

        if (result && result.layoutParsingResults) {
          for (const layoutResult of result.layoutParsingResults) {
            if (layoutResult.markdown && layoutResult.markdown.text) {
              allText += layoutResult.markdown.text + '\n';
            }
          }
        }
      } catch (err) {
        console.error('[PaddleOCR API] Failed to parse line:', err);
      }
    }

    return allText.trim();
  }

  /**
   * 完整的 OCR 流程
   */
  async recognize(imageDataUrl, onProgress) {
    try {
      // 1. 提交任务
      if (onProgress) onProgress('提交任务...');
      const jobId = await this.submitJob(imageDataUrl);

      // 2. 轮询状态
      const jsonlUrl = await this.pollJobStatus(jobId, onProgress);

      // 3. 获取结果
      if (onProgress) onProgress('获取结果...');
      const text = await this.getResult(jsonlUrl);

      console.log('[PaddleOCR API] Recognition complete, text length:', text.length);
      return text;
    } catch (err) {
      console.error('[PaddleOCR API] Recognition failed:', err);
      throw err;
    }
  }

  /**
   * 工具函数：Data URL 转 Blob
   */
  async dataURLToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  /**
   * 工具函数：延迟
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出（在浏览器环境中作为全局变量）
if (typeof window !== 'undefined') {
  window.PaddleOCRAPI = PaddleOCRAPI;
}
