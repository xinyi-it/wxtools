const axios = require('axios');
const crypto = require('crypto');
const { cache, md5 } = require('../utils/cache');

const CACHE_PREFIX = 'bilibili';

// 画质配置
const QUALITY_OPTIONS = {
  low: 16,      // 360P
  medium: 32,   // 480P
  high: 64,     // 720P
  hd: 80,       // 1080P (需要登录)
  hd60: 112,    // 1080P60 (需要登录)
  fourk: 120,   // 4K (需要大会员)
};

// 默认画质（请求最高画质，B站会根据用户会员状态返回实际可用的最高画质）
const DEFAULT_QUALITY = QUALITY_OPTIONS.fourk; // 4K，自动降级到用户可用的最高画质

// WBI签名混淆表（固定值）
const MIX_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

class BilibiliService {
  // 验证Cookie状态（不存储）
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
      const response = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
          'Cookie': cookie,
        },
        timeout: 10000,
      });

      const data = response.data;
      if (data.code !== 0) {
        return {
          valid: false,
          isLogin: false,
          message: 'Cookie无效',
          hasCookie: true,
        };
      }

      const userInfo = data.data;
      return {
        valid: true,
        isLogin: userInfo.isLogin || false,
        userId: userInfo.uname || '',
        level: userInfo.level_info?.current_level || 0,
        isVip: userInfo.vipStatus === 1,
        message: userInfo.isLogin ? '登录正常' : '未登录',
        hasCookie: true,
      };
    } catch (error) {
      console.error(`[Bilibili] Cookie检查失败: ${error.message}`);
      return {
        valid: false,
        isLogin: false,
        message: 'Cookie检查失败',
        hasCookie: true,
      };
    }
  }

  async parseShareUrl(shareUrl, cookie = '') {
    try {
      console.log(`[Bilibili] 原始输入: ${shareUrl}`);

      // 从分享文本中提取链接
      const url = this.extractUrl(shareUrl);
      if (!url) {
        console.error(`[Bilibili] URL提取失败，原始内容: ${shareUrl}`);
        const error = new Error('未找到有效的B站链接');
        error.status = 400;
        throw error;
      }
      console.log(`[Bilibili] Extracted URL: ${url}`);

      // 尝试从缓存获取
      const cacheKey = `${CACHE_PREFIX}:parse:${md5(url)}`;
      const cachedResult = await cache.get(cacheKey);
      if (cachedResult) {
        console.log(`[Bilibili] Cache HIT: ${cacheKey}`);
        return cachedResult;
      }
      console.log(`[Bilibili] Cache MISS: ${cacheKey}`);

      // 1. 处理短链接重定向
      let realUrl = url;
      if (url.includes('b23.tv')) {
        realUrl = await this.getRedirectUrl(url);
        console.log(`[Bilibili] Redirect URL: ${realUrl}`);
      }

      // 2. 提取BV号
      const bvid = this.extractBvid(realUrl);
      if (!bvid) {
        const error = new Error('无法解析视频BV号');
        error.status = 400;
        throw error;
      }
      console.log(`[Bilibili] BV号: ${bvid}`);

      // 3. 获取视频信息
      const videoInfo = await this.getVideoInfo(bvid, cookie);

      // 存入缓存
      await cache.set(cacheKey, videoInfo);
      console.log(`[Bilibili] Cache SET: ${cacheKey}`);

      return videoInfo;
    } catch (error) {
      console.error(`[Bilibili] 解析失败: ${error.message}`);
      throw error;
    }
  }

  // 从分享文本中提取B站链接
  extractUrl(text) {
    const patterns = [
      /https?:\/\/b23\.tv\/[a-zA-Z0-9]+\/?/,
      /https?:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+\/?/,
      /https?:\/\/m\.bilibili\.com\/video\/[a-zA-Z0-9]+\/?/,
      /https?:\/\/bilibili\.com\/video\/[a-zA-Z0-9]+\/?/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }
    return null;
  }

  // 获取短链接重定向地址
  async getRedirectUrl(shortUrl) {
    try {
      const response = await axios.head(shortUrl, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        },
      });

      if (response.status === 302 || response.status === 301) {
        return response.headers.location;
      }
      return shortUrl;
    } catch (error) {
      if (error.response && (error.response.status === 302 || error.response.status === 301)) {
        return error.response.headers.location;
      }
      throw new Error('获取重定向URL失败');
    }
  }

  // 提取BV号
  extractBvid(url) {
    // BV号格式: BV开头，后跟10位字符
    const bvMatch = url.match(/(BV[a-zA-Z0-9]{10})/);
    if (bvMatch) {
      return bvMatch[1];
    }

    // AV号格式: av后面跟数字
    const avMatch = url.match(/av(\d+)/);
    if (avMatch) {
      // 需要将AV号转换为BV号
      return this.avToBv(parseInt(avMatch[1]));
    }

    return null;
  }

  // AV号转BV号（简化算法）
  avToBv(av) {
    const table = 'fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF';
    const tr = {};
    for (let i = 0; i < table.length; i++) {
      tr[table[i]] = i;
    }

    const s = [11, 10, 3, 8, 4, 6];
    const xor = 177451812;
    const add = 8728348608;

    let x = (av ^ xor) + add;
    let r = ['B', 'V', '1', ' ', ' ', '4', ' ', '1', ' ', '7', ' ', ' '];

    for (let i = 0; i < 6; i++) {
      r[s[i]] = table[Math.floor(x / Math.pow(58, i)) % 58];
    }

    return r.join('');
  }

  // 获取视频信息
  async getVideoInfo(bvid, cookie = '') {
    try {
      // 获取视频基本信息
      const infoUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
      console.log(`[Bilibili] Fetching video info: ${infoUrl}`);

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      };
      if (cookie) {
        headers['Cookie'] = cookie;
      }

      const infoResponse = await axios.get(infoUrl, { headers });

      const data = infoResponse.data;
      if (data.code !== 0) {
        throw new Error(data.message || '获取视频信息失败');
      }

      const videoData = data.data;
      const cid = videoData.cid;
      const title = videoData.title;
      const author = videoData.owner?.name || '未知作者';
      const cover = videoData.pic;
      const duration = videoData.duration * 1000; // 转为毫秒
      const desc = videoData.desc;

      console.log(`[Bilibili] 视频标题: ${title}, CID: ${cid}`);

      // 获取播放地址
      const playUrl = await this.getPlayUrl(bvid, cid, cookie);

      // 处理返回结果
      let videoUrl = '';
      let isDash = false;
      if (typeof playUrl === 'string') {
        videoUrl = playUrl;
      } else if (playUrl && playUrl.type === 'dash') {
        videoUrl = playUrl.videoUrl;
        isDash = true;
        console.log(`[Bilibili] DASH格式，视频流URL: ${videoUrl.substring(0, 60)}...`);
      }

      return {
        type: 'video',
        title: title,
        author: author,
        cover: cover,
        videoUrl: videoUrl,
        duration: duration,
        desc: desc,
        bvid: bvid,
        isDash: isDash, // 标记是否为DASH格式（音视频分离）
      };
    } catch (error) {
      console.error(`[Bilibili] 获取视频信息失败: ${error.message}`);
      throw new Error('获取视频信息失败: ' + error.message);
    }
  }

  // 获取播放地址
  async getPlayUrl(bvid, cid, cookie = '') {
    try {
      // 使用登录Cookie获取高清画质
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      };
      if (cookie) {
        headers['Cookie'] = cookie;
      }

      // 方案1: 尝试获取FLV/MP4格式（单流，包含音视频）
      const flvUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${DEFAULT_QUALITY}&fnval=0&fourk=1`;
      console.log(`[Bilibili] Fetching playurl (qn=${DEFAULT_QUALITY}): ${flvUrlApi}`);

      let response = await axios.get(flvUrlApi, { headers });

      let data = response.data;
      if (data.code === 0 && data.data?.durl && data.data.durl.length > 0) {
        // 获取到单流格式
        const quality = data.data.quality || DEFAULT_QUALITY;
        console.log(`[Bilibili] 获取到单流视频URL，画质: ${quality}`);
        return data.data.durl[0].url;
      }

      // 方案2: 尝试获取DASH格式的高清视频
      const dashUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${DEFAULT_QUALITY}&fnval=16&fourk=1`;
      console.log(`[Bilibili] Fetching DASH playurl: ${dashUrlApi}`);

      response = await axios.get(dashUrlApi, { headers });

      data = response.data;
      if (data.code !== 0) {
        console.log(`[Bilibili] playurl API失败: ${data.message}`);
        return await this.getPlayUrlWithWbi(bvid, cid);
      }

      const dashInfo = data.data;

      // 优先使用durl（单流格式）
      if (dashInfo.durl && dashInfo.durl.length > 0) {
        console.log(`[Bilibili] 获取到直接视频URL`);
        return dashInfo.durl[0].url;
      }

      // DASH格式：返回音频和视频流信息
      if (dashInfo.dash) {
        const videoStream = dashInfo.dash.video?.[0];
        const audioStream = dashInfo.dash.audio?.[0];

        if (videoStream && videoStream.baseUrl) {
          const quality = videoStream.id || 'unknown';
          console.log(`[Bilibili] 获取到DASH视频流，画质ID: ${quality}`);
          return {
            type: 'dash',
            videoUrl: videoStream.baseUrl,
            audioUrl: audioStream?.baseUrl || null,
            quality: quality,
          };
        }
      }

      throw new Error('无法获取视频播放地址');
    } catch (error) {
      console.error(`[Bilibili] 获取播放地址失败: ${error.message}`);
      return await this.getPlayUrlWithWbi(bvid, cid);
    }
  }

  // 使用WBI签名获取播放地址
  async getPlayUrlWithWbi(bvid, cid) {
    try {
      console.log(`[Bilibili] 尝试WBI签名方式获取播放地址`);

      // 获取WBI密钥
      const wbiKeys = await this.getWbiKeys();
      console.log(`[Bilibili] 获取到WBI密钥`);

      // 构建参数
      const params = {
        bvid: bvid,
        cid: cid,
        qn: 16,
        fnval: 16,
        fourk: 0,
      };

      // 签名
      const signedParams = this.wbiSign(params, wbiKeys);
      const playUrlApi = `https://api.bilibili.com/x/player/wbi/playurl?${signedParams}`;
      console.log(`[Bilibili] WBI签名后URL: ${playUrlApi.substring(0, 100)}...`);

      const response = await axios.get(playUrlApi, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
        },
      });

      const data = response.data;
      if (data.code !== 0) {
        throw new Error(data.message || 'WBI签名获取播放地址失败');
      }

      const dashInfo = data.data;
      if (dashInfo.dash) {
        const videoStream = dashInfo.dash.video[0];
        if (videoStream && videoStream.baseUrl) {
          return videoStream.baseUrl;
        }
      }

      if (dashInfo.durl && dashInfo.durl.length > 0) {
        return dashInfo.durl[0].url;
      }

      throw new Error('无法获取视频播放地址');
    } catch (error) {
      console.error(`[Bilibili] WBI签名获取播放地址失败: ${error.message}`);
      throw error;
    }
  }

  // 获取WBI密钥
  async getWbiKeys() {
    try {
      const navUrl = 'https://api.bilibili.com/x/web-interface/nav';
      const response = await axios.get(navUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
        },
      });

      const data = response.data;
      if (data.code !== 0) {
        throw new Error('获取WBI密钥失败');
      }

      const imgKey = data.data.wbi_img.img_url.split('/').pop().split('.')[0];
      const subKey = data.data.wbi_img.sub_url.split('/').pop().split('.')[0];

      return {
        imgKey: imgKey,
        subKey: subKey,
      };
    } catch (error) {
      console.error(`[Bilibili] 获取WBI密钥失败: ${error.message}`);
      // 使用备用固定密钥（可能会失效）
      return {
        imgKey: '7cd08494199828e6ced350a6a8a6f1a3',
        subKey: '491f9a3b7c0e8b7f6e5d4c3b2a190887',
      };
    }
  }

  // WBI签名
  wbiSign(params, keys) {
    // 混淆密钥
    const orig = keys.imgKey + keys.subKey;
    let mixKey = '';
    for (let i = 0; i < 32; i++) {
      mixKey += orig[MIX_KEY_TABLE[i]];
    }

    // 参数排序并拼接
    const sortedKeys = Object.keys(params).sort();
    const queryParts = [];
    for (const key of sortedKeys) {
      const value = params[key];
      // 过滤特殊字符
      const filteredValue = String(value).replace(/[!'()*]/g, '');
      queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(filteredValue)}`);
    }
    const query = queryParts.join('&');

    // 添加时间戳
    const wts = Math.floor(Date.now() / 1000);
    const queryWithTs = query + `&wts=${wts}`;

    // 计算MD5
    const wRid = crypto.createHash('md5').update(queryWithTs + mixKey).digest('hex');

    return `${queryWithTs}&w_rid=${wRid}`;
  }

  // 下载资源
  async downloadResource(url, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Bilibili] 下载尝试 ${attempt}/${maxRetries}: ${url.substring(0, 80)}...`);

        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 1800000, // 30分钟超时
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.bilibili.com/',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'identity',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'video',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'cross-site',
          },
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const ext = contentType.includes('video') ? 'mp4' :
                    contentType.includes('jpeg') ? 'jpg' :
                    contentType.includes('png') ? 'png' : 'mp4';

        const sizeMB = (response.data.byteLength / 1024 / 1024).toFixed(2);
        console.log(`[Bilibili] 下载成功，大小: ${sizeMB}MB`);

        return {
          buffer: Buffer.from(response.data),
          contentType,
          ext,
          type: 'video',
        };
      } catch (error) {
        lastError = error;
        console.error(`[Bilibili] 下载失败 (尝试 ${attempt}/${maxRetries}): ${error.code || error.message}`);

        const retryableErrors = ['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'];
        if (retryableErrors.includes(error.code) || error.message.includes('timeout')) {
          if (attempt < maxRetries) {
            const waitTime = attempt * 2000;
            console.log(`[Bilibili] 等待 ${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }

        if (attempt >= maxRetries) {
          break;
        }
      }
    }

    console.error(`[Bilibili] 下载资源最终失败: ${lastError?.code || lastError?.message}`);
    const err = new Error('下载资源失败，请稍后重试');
    err.status = 500;
    throw err;
  }
}

module.exports = new BilibiliService();
