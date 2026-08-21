const axios = require('axios');
const { cache, md5 } = require('../utils/cache');

const CACHE_PREFIX = 'douyin';
// 宿主机抖音解析 HTTP 服务（f2 + Chrome cookie）。生产环境通过环境变量 DOUYIN_RESOLVER_HOST 注入，默认本地。
const RESOLVER_HOST = process.env.DOUYIN_RESOLVER_HOST || 'http://localhost:3008';

class DouyinService {
  // 验证用户提供的抖音 Cookie 是否有效（不存储，各用户用自己的）
  async checkCookieStatus(cookie) {
    if (!cookie) {
      return {
        valid: false,
        isLogin: false,
        message: '未设置Cookie',
        hasCookie: false,
      };
    }
    try {
      const resp = await axios.get(`${RESOLVER_HOST}/cookie/check`, {
        params: { cookie },
        timeout: 30000,
      });
      const data = (resp.data && resp.data.data) || {};
      return {
        valid: data.valid || false,
        isLogin: data.isLogin || false,
        message: data.message || 'Cookie检测失败',
        hasCookie: true,
      };
    } catch (e) {
      console.error(`[Douyin] Cookie检查失败: ${e.message}`);
      return {
        valid: false,
        isLogin: false,
        message: 'Cookie检测失败（解析服务不可用）',
        hasCookie: true,
      };
    }
  }

  async parseShareUrl(shareUrl, userCookie = '') {
    try {
      console.log(`[Douyin] 原始输入: ${shareUrl}`);

      // 从分享文本中提取链接
      const url = this.extractUrl(shareUrl);
      if (!url) {
        console.error(`[Douyin] URL提取失败，原始内容: ${shareUrl}`);
        const error = new Error('未找到有效的抖音链接');
        error.status = 400;
        throw error;
      }
      console.log(`[Douyin] Extracted URL: ${url}`);

      // 尝试从缓存获取（缓存 key 含 cookie 指纹，避免不同用户结果串用）
      const cacheKey = `${CACHE_PREFIX}:parse:${md5(url + userCookie)}`;
      const cachedResult = await cache.get(cacheKey);
      if (cachedResult) {
        console.log(`[Douyin] Cache HIT: ${cacheKey}`);
        return cachedResult;
      }
      console.log(`[Douyin] Cache MISS: ${cacheKey}`);

      // 调用抖音解析服务拿视频信息（含无水印直链）
      // cookie 由用户提供（各用各的，避免服务级共享被封号），透传给解析服务。
      let resp;
      try {
        resp = await axios.get(`${RESOLVER_HOST}/parse`, {
          params: { url, cookie: userCookie },
          timeout: 120000,
        });
      } catch (e) {
        const connErr = e.code === 'ECONNREFUSED' || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT';
        const msg = connErr
          ? `抖音解析服务不可用（${RESOLVER_HOST}）。请配置 DOUYIN_RESOLVER_HOST 指向可用的解析服务，部署方式见 README 或 docs/DOUYIN_RESOLVER.md`
          : `抖音解析服务请求失败: ${e.message}`;
        console.error(`[Douyin] 解析服务连接失败: ${e.code} ${e.message}`);
        const error = new Error(msg);
        error.status = 503;
        throw error;
      }

      if (resp.data.code !== 200 || !resp.data.data) {
        const msg = (resp.data && resp.data.message) || '解析服务返回异常';
        console.error(`[Douyin] 解析失败: ${msg}`);
        const error = new Error(msg);
        error.status = 500;
        throw error;
      }

      const videoInfo = resp.data.data;

      // 存入缓存
      await cache.set(cacheKey, videoInfo);
      console.log(`[Douyin] Cache SET: ${cacheKey}`);

      return videoInfo;
    } catch (error) {
      console.error(`[Douyin] 解析失败: ${error.message}`);
      throw error;
    }
  }

  // 从分享文本中提取抖音链接
  extractUrl(text) {
    const patterns = [
      /https?:\/\/v\.douyin\.com\/[a-zA-Z0-9_-]+\/?/,
      /https?:\/\/www\.douyin\.com\/video\/\d+/,
      /https?:\/\/www\.iesdouyin\.com\/share\/(video|note)\/\d+/,
      /https?:\/\/iesdouyin\.com\/share\/(video|note)\/\d+/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }
    return null;
  }

  // 下载资源（视频/图片）带重试机制
  async downloadResource(url, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Douyin] 下载尝试 ${attempt}/${maxRetries}: ${url.substring(0, 80)}...`);

        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 1800000, // 30分钟超时
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
            'Referer': 'https://www.douyin.com/',
          },
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const ext = contentType.includes('video') ? 'mp4' :
                    contentType.includes('jpeg') ? 'jpg' :
                    contentType.includes('png') ? 'png' : 'jpg';

        const sizeMB = (response.data.byteLength / 1024 / 1024).toFixed(2);
        console.log(`[Douyin] 下载成功，大小: ${sizeMB}MB`);

        return {
          buffer: Buffer.from(response.data),
          contentType,
          ext,
          type: contentType.includes('video') ? 'video' : 'image',
        };
      } catch (error) {
        lastError = error;
        console.error(`[Douyin] 下载失败 (尝试 ${attempt}/${maxRetries}): ${error.code || error.message}`);

        const retryableErrors = ['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'];
        if (retryableErrors.includes(error.code) || error.message.includes('timeout')) {
          if (attempt < maxRetries) {
            const waitTime = attempt * 2000;
            console.log(`[Douyin] 等待 ${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }

        if (attempt >= maxRetries) {
          break;
        }
      }
    }

    console.error(`[Douyin] 下载资源最终失败: ${lastError?.code || lastError?.message}`);
    const err = new Error('下载资源失败，请稍后重试');
    err.status = 500;
    throw err;
  }

  // 下载视频（保留向后兼容）
  async downloadVideo(videoUrl) {
    return this.downloadResource(videoUrl);
  }
}

module.exports = new DouyinService();
