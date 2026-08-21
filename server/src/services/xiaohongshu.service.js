const axios = require('axios');
const { cache, md5 } = require('../utils/cache');

const CACHE_PREFIX = 'xhs';

class XiaohongshuService {
  async parseShareUrl(shareUrl) {
    try {
      // 记录原始输入
      console.log(`[Xiaohongshu] 原始输入: ${shareUrl}`);

      // 从分享文本中提取链接
      const url = this.extractUrl(shareUrl);
      if (!url) {
        console.error(`[Xiaohongshu] URL提取失败，原始内容: ${shareUrl}`);
        const error = new Error('未找到有效的小红书链接');
        error.status = 400;
        throw error;
      }
      console.log(`[Xiaohongshu] Extracted URL: ${url}`);

      // 尝试从缓存获取
      const cacheKey = `${CACHE_PREFIX}:parse:${md5(url)}`;
      const cachedResult = await cache.get(cacheKey);
      if (cachedResult) {
        console.log(`[Xiaohongshu] Cache HIT: ${cacheKey}`);
        return cachedResult;
      }
      console.log(`[Xiaohongshu] Cache MISS: ${cacheKey}`);

      // 1. 获取笔记ID和数据
      let noteId = null;
      let noteInfo = null;

      if (url.includes("xhslink")) {
        // 短链接：直接请求页面，从中提取笔记ID和数据
        const result = await this.fetchNoteIdFromShortUrl(url);
        noteId = result.noteId;
        if (result.data) {
          // 直接从短链接页面提取到了数据，存入缓存
          await cache.set(cacheKey, result.data);
          console.log(`[Xiaohongshu] Cache SET (short URL): ${cacheKey}`);
          return result.data;
        }
        console.log(`[Xiaohongshu] Note ID from short URL: ${noteId}`);
      } else {
        // 标准链接：直接提取笔记ID
        noteId = this.extractNoteId(url);
        console.log(`[Xiaohongshu] Note ID from URL: ${noteId}`);
      }

      if (!noteId) {
        const error = new Error('无法解析笔记ID');
        error.status = 400;
        throw error;
      }

      // 2. 获取笔记详情（备用方案）
      noteInfo = await this.getNoteDetail(noteId);

      // 存入缓存
      await cache.set(cacheKey, noteInfo);
      console.log(`[Xiaohongshu] Cache SET: ${cacheKey}`);

      return noteInfo;
    } catch (error) {
      console.error(`[Xiaohongshu] 解析失败: ${error.message}`);
      throw error;
    }
  }

  // 从短链接页面提取笔记ID和数据
  async fetchNoteIdFromShortUrl(shortUrl) {
    try {
      // 确保使用HTTPS
      const url = shortUrl.replace(/^http:/, 'https:');
      console.log(`[Xiaohongshu] Fetching short URL: ${url}`);

      const response = await axios.get(url, {
        maxRedirects: 1,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });

      const html = response.data;

      // 从HTML中提取笔记ID
      let noteId = null;
      const noteIdMatch = html.match(/"noteId"\s*:\s*"([a-zA-Z0-9]{24})"/);
      if (noteIdMatch) {
        noteId = noteIdMatch[1];
        console.log(`[Xiaohongshu] Extracted noteId: ${noteId}`);
      }

      if (!noteId) {
        const altMatch = html.match(/noteId["\s:=]+([a-zA-Z0-9]{24})/);
        if (altMatch) {
          noteId = altMatch[1];
          console.log(`[Xiaohongshu] Extracted noteId (alt): ${noteId}`);
        }
      }

      // 直接从HTML提取数据
      const data = this.extractDataFromHtml(html, noteId);
      if (data) {
        console.log(`[Xiaohongshu] Successfully extracted data from HTML`);
        return { noteId, html, data };
      }

      if (!noteId) {
        throw new Error('无法从短链接页面提取笔记ID');
      }

      return { noteId, html, data: null };
    } catch (error) {
      console.error(`[Xiaohongshu] 获取短链接失败: ${error.message}`);
      throw new Error('获取短链接信息失败');
    }
  }

  // 从分享文本中提取小红书链接
  extractUrl(text) {
    const patterns = [
      /https?:\/\/xhslink\.(?:com|cn)\/[a-zA-Z0-9\/_-]+/,
      /https?:\/\/www\.xiaohongshu\.com\/explore\/[a-zA-Z0-9]+/,
      /https?:\/\/m\.xiaohongshu\.com\/explore\/[a-zA-Z0-9]+/,
      /https?:\/\/www\.xiaohongshu\.com\/discovery\/item\/[a-zA-Z0-9]+/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }
    return null;
  }

  // 获取短链接重定向URL
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

  // 从URL中提取笔记ID
  extractNoteId(url) {
    const patterns = [
      /explore\/([a-zA-Z0-9]{24})/,
      /discovery\/item\/([a-zA-Z0-9]{24})/,
      /noteId=([a-zA-Z0-9]{24})/,
      /\/([a-zA-Z0-9]{24})(?:\?|\/|$)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  // 获取短链接重定向URL（保留备用）
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

  // 获取笔记详情
  async getNoteDetail(noteId) {
    // 尝试从移动端页面获取数据
    const mobileUrl = `https://m.xiaohongshu.com/explore/${noteId}`;

    try {
      console.log(`[Xiaohongshu] Fetching: ${mobileUrl}`);
      const response = await axios.get(mobileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });

      const html = response.data;

      // 尝试从页面中提取 __INITIAL_STATE__
      const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
      if (stateMatch) {
        try {
          const state = JSON.parse(stateMatch[1]);
          console.log(`[Xiaohongshu] Found __INITIAL_STATE__`);

          const noteDetail = state?.note?.noteDetailMap?.[noteId]?.note;
          if (noteDetail) {
            return this.parseNoteData(noteDetail);
          }
        } catch (parseError) {
          console.error(`[Xiaohongshu] 解析 __INITIAL_STATE__ 失败: ${parseError.message}`);
        }
      }

      // 尝试从页面中提取其他格式的数据
      const noteDataMatch = html.match(/"noteId"\s*:\s*"([^"]+)"/);
      if (noteDataMatch) {
        console.log(`[Xiaohongshu] Found noteId in HTML, trying to extract data...`);
        const result = this.extractDataFromHtml(html, noteId);
        if (result) {
          return result;
        }
      }

      throw new Error('获取笔记信息失败');
    } catch (error) {
      console.error(`[Xiaohongshu] 获取笔记详情失败: ${error.message}`);

      // 尝试PC端页面
      try {
        return await this.fetchFromPcPage(noteId);
      } catch (pcError) {
        throw new Error('获取笔记信息失败');
      }
    }
  }

  // 从PC端页面获取数据
  async fetchFromPcPage(noteId) {
    const pcUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
    console.log(`[Xiaohongshu] Trying PC page: ${pcUrl}`);

    const response = await axios.get(pcUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });

    const html = response.data;

    // 尝试提取 __INITIAL_STATE__
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (stateMatch) {
      const state = JSON.parse(stateMatch[1]);
      const noteDetail = state?.note?.noteDetailMap?.[noteId]?.note;
      if (noteDetail) {
        return this.parseNoteData(noteDetail);
      }
    }

    throw new Error('PC端页面解析失败');
  }

  // 从HTML中提取数据（fallback方案）
  extractDataFromHtml(html, noteId) {
    try {
      // 提取标题
      const titleMatch = html.match(/"title"\s*:\s*"([^"]+)"/);
      const title = titleMatch ? this.decodeUnicode(titleMatch[1]) : '无标题';

      // 提取正文描述
      let desc = '';
      const descMatches = html.matchAll(/"desc"\s*:\s*"([^"]*)"/g);
      for (const match of descMatches) {
        const d = this.decodeUnicode(match[1]);
        // 选择第一个非空的desc
        if (d && d.trim()) {
          desc = d.trim();
          break;
        }
      }
      console.log(`[Xiaohongshu] Extracted desc: ${desc.substring(0, 50)}...`);

      // 去掉换行符，前端单行展示
      if (desc) {
        desc = desc.replace(/\\n/g, ' ').replace(/\n/g, ' ');
      }

      // 提取作者昵称（优先匹配nickName大写N，这是作者字段）
      let author = '未知作者';
      const nickNameMatch = html.match(/"nickName"\s*:\s*"([^"]+)"/);
      if (nickNameMatch) {
        author = this.decodeUnicode(nickNameMatch[1]);
      } else {
        const authorMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
        if (authorMatch) {
          author = this.decodeUnicode(authorMatch[1]);
        }
      }

      // 判断类型：检查是否有视频
      const videoMatch = html.match(/"video"\s*:\s*\{/);
      const hasVideo = !!videoMatch;

      // 提取封面 - 优先使用 sns-webpic 域名的缩略图（无水印）
      let cover = '';

      // 格式1: sns-webpic 域名的 style 缩略图（无水印）
      const styleThumbMatch = html.match(/"(https?:\\u002F\\u002Fsns-webpic[^"]*!style_[^"]+)"/);
      if (styleThumbMatch) {
        cover = this.decodeUnicode(styleThumbMatch[1]);
        // 确保使用 HTTPS（微信小程序要求）
        cover = cover.replace(/^http:/, 'https:');
        console.log('[Xiaohongshu] Found style thumbnail cover (no watermark)');
      }

      // 格式2: "cover":{"url":"..."}
      if (!cover) {
        const coverObjMatch = html.match(/"cover"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/);
        if (coverObjMatch) {
          cover = this.decodeUnicode(coverObjMatch[1]);
        }
      }

      // 格式3: "cover":"..."
      if (!cover) {
        const coverStrMatch = html.match(/"cover"\s*:\s*"([^"]+)"/);
        if (coverStrMatch) {
          cover = this.decodeUnicode(coverStrMatch[1]);
        }
      }

      // 确保封面使用 HTTPS
      if (cover) {
        cover = cover.replace(/^http:/, 'https:');
      }

      if (hasVideo) {
        // 视频类型 - 提取视频URL
        let videoUrl = '';

        // 优先匹配带签名的 xhscdn.com 链接（微信小程序需要 HTTPS）
        // 格式: https://sns-video-hs.xhscdn.com/stream/.../xxx_114.mp4?sign=...&t=...
        // 优先级: _109 > _114 > _259（_109 质量更清晰）
        const qualitySuffixes = ['_109', '_114', '_259'];

        // 先尝试匹配带签名的链接
        for (const suffix of qualitySuffixes) {
          const patterns = [
            new RegExp(`"(https?:\\\\u002F\\\\u002F[^\"]*xhscdn\\.com[^\"]*${suffix}\\.mp4\\?sign=[^"]*)"`),
            new RegExp(`"(https?:\\/\\/[^"]*xhscdn\\.com[^\"]*${suffix}\\.mp4\\?sign=[^"]*)"`),
          ];

          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
              videoUrl = this.decodeUnicode(match[1]);
              // 确保使用 HTTPS（微信小程序要求）
              videoUrl = videoUrl.replace(/^http:/, 'https:');
              console.log(`[Xiaohongshu] Found signed ${suffix} URL: ${videoUrl.substring(0, 100)}...`);
              break;
            }
          }
          if (videoUrl) break;
        }

        // 如果没找到带签名的，尝试任意 xhscdn.com 域名的 mp4 链接
        if (!videoUrl) {
          for (const suffix of qualitySuffixes) {
            const patterns = [
              new RegExp(`"(https?:\\\\u002F\\\\u002F[^"]*xhscdn\\.com[^\"]*${suffix}\\.mp4[^"]*)"`),
              new RegExp(`"(https?:\\/\\/[^"]*xhscdn\\.com[^\"]*${suffix}\\.mp4[^"]*)"`),
            ];

            for (const pattern of patterns) {
              const match = html.match(pattern);
              if (match) {
                videoUrl = this.decodeUnicode(match[1]);
                // 确保使用 HTTPS（微信小程序要求）
                videoUrl = videoUrl.replace(/^http:/, 'https:');
                console.log(`[Xiaohongshu] Found xhscdn ${suffix} URL: ${videoUrl.substring(0, 100)}...`);
                break;
              }
            }
            if (videoUrl) break;
          }
        }

        // 如果没有找到xhscdn链接，则提取所有masterUrl，按质量优先级选择
        if (!videoUrl) {
          const allMasterUrls = html.match(/"masterUrl"\s*:\s*"([^"]+)"/g) || [];

          // 质量优先级: 109 (4K) > 259 (高清) > 其他
          const qualityPriority = ['_109.', '_259.'];

          for (const quality of qualityPriority) {
            for (const match of allMasterUrls) {
              const urlMatch = match.match(/"masterUrl"\s*:\s*"([^"]+)"/);
              if (urlMatch) {
                const url = this.decodeUnicode(urlMatch[1]);
                if (url.includes(quality)) {
                  videoUrl = url;
                  console.log(`[Xiaohongshu] Found ${quality.replace('_', '').replace('.', '')} quality video`);
                  break;
                }
              }
            }
            if (videoUrl) break;
          }

          // 如果没有找到优先质量的，使用第一个可用的
          if (!videoUrl && allMasterUrls.length > 0) {
            const urlMatch = allMasterUrls[0].match(/"masterUrl"\s*:\s*"([^"]+)"/);
            if (urlMatch) {
              videoUrl = this.decodeUnicode(urlMatch[1]);
            }
          }
        }

        // 备选: streamUrl
        if (!videoUrl) {
          const streamUrlMatch = html.match(/"streamUrl"\s*:\s*"([^"]+)"/);
          if (streamUrlMatch) {
            videoUrl = this.decodeUnicode(streamUrlMatch[1]);
          }
        }

        // 备选: flowUrl
        if (!videoUrl) {
          const flowUrlMatch = html.match(/"flowUrl"\s*:\s*"([^"]+)"/);
          if (flowUrlMatch) {
            videoUrl = this.decodeUnicode(flowUrlMatch[1]);
          }
        }

        if (videoUrl) {
          console.log(`[Xiaohongshu] Found video URL: ${videoUrl.substring(0, 100)}...`);
          return {
            type: 'video',
            title,
            desc,
            author,
            cover,
            videoUrl,
          };
        }
      } else {
        // 图文类型 - 提取图片列表
        const images = this.extractImageUrlsFromHtml(html);
        if (images.length > 0) {
          console.log(`[Xiaohongshu] Found ${images.length} images`);
          return {
            type: 'images',
            title,
            desc,
            author,
            cover: cover || images[0],
            images,
          };
        }
      }

      return null;
    } catch (error) {
      console.error(`[Xiaohongshu] extractDataFromHtml error: ${error.message}`);
      return null;
    }
  }

  // 解码Unicode转义字符
  decodeUnicode(str) {
    if (!str) return '';
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, code) => {
      return String.fromCharCode(parseInt(code, 16));
    }).replace(/\\u002F/g, '/');
  }

  // 从HTML中提取图片URL列表
  extractImageUrlsFromHtml(html) {
    const imageMap = new Map(); // 用于去重，key为图片唯一标识

    // 方案1：提取 notes_pre_post 格式的图片URL（放宽条件，不限制后缀）
    const notesPrePostPatterns = [
      /"url"\s*:\s*"(https?:\\u002F\\u002F[^"]+notes_pre_post[^"]+)"/g,
      /"url"\s*:\s*"(https?:\/\/[^"]+notes_pre_post[^"]+)"/g,
    ];

    for (const pattern of notesPrePostPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1];
        url = this.decodeUnicode(url);
        url = url.replace(/^http:/, 'https:');

        // 提取图片ID（notes_pre_post/后面的部分，去掉后缀参数）
        const idMatch = url.match(/notes_pre_post\/([^/!?]+)/);
        if (idMatch) {
          const imageId = idMatch[1];

          // 构建无水印高清URL
          const hasCPath = url.includes('/c/notes_pre_post/');
          let noWatermarkUrl;
          if (hasCPath) {
            noWatermarkUrl = `https://sns-na-i1.xhscdn.com/c/notes_pre_post/${imageId}?imageView2/2/w/1080/format/webp&origin=0`;
          } else {
            noWatermarkUrl = `https://sns-na-i1.xhscdn.com/notes_pre_post/${imageId}?imageView2/2/w/1080/format/webp&origin=0`;
          }

          // 只有当imageId不存在时才添加，避免覆盖
          if (!imageMap.has(imageId)) {
            imageMap.set(imageId, noWatermarkUrl);
          }
        }
      }
    }

    console.log(`[Xiaohongshu] Found ${imageMap.size} notes_pre_post format images`);

    // 方案2：提取 sns-webpic 格式的图片URL（放宽条件，不限制后缀）
    const webpicPatterns = [
      /"url"\s*:\s*"(https?:\\u002F\\u002Fsns-webpic[^"]+)"/g,
      /"url"\s*:\s*"(https?:\/\/sns-webpic[^"]+)"/g,
    ];

    for (const pattern of webpicPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1];
        url = this.decodeUnicode(url);
        url = url.replace(/^http:/, 'https:');

        // 提取图片ID（格式：/hash/imageId!suffix 或 /hash/imageId）
        const idMatch = url.match(/\/([a-f0-9]+)\/(1040g[a-z0-9]+)/);
        if (idMatch) {
          const imageId = idMatch[2];
          const noWatermarkUrl = `https://sns-na-i1.xhscdn.com/${imageId}?imageView2/2/w/1080/format/webp&origin=0`;

          // 只有当imageId不存在时才添加，避免覆盖
          if (!imageMap.has(imageId)) {
            imageMap.set(imageId, noWatermarkUrl);
          }
        }
      }
    }

    console.log(`[Xiaohongshu] Total images after sns-webpic: ${imageMap.size}`);

    // 方案3：提取 spectrum 格式的图片URL（新格式）
    // 格式: sns-webpic-qc.xhscdn.com/.../spectrum/1040g...!h5_1080jpg
    // 构建无水印URL
    const spectrumPatterns = [
      /"url"\s*:\s*"(https?:\\u002F\\u002F[^"]+spectrum[^"]+!h5_1080jpg)"/g,
      /"url"\s*:\s*"(https?:\/\/[^"]+spectrum[^"]+!h5_1080jpg)"/g,
    ];

    for (const pattern of spectrumPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1];
        url = this.decodeUnicode(url);
        url = url.replace(/^http:/, 'https:');

        // 提取图片ID（格式：spectrum/1040g...）
        const idMatch = url.match(/spectrum\/(1040g[a-z0-9]+)/);
        if (idMatch) {
          const imageId = idMatch[1];
          // 构建无水印高清URL
          const noWatermarkUrl = `https://sns-na-i1.xhscdn.com/spectrum/${imageId}?imageView2/2/w/1080/format/webp&origin=0`;

          // 只有当imageId不存在时才添加，避免覆盖
          if (!imageMap.has(imageId)) {
            imageMap.set(imageId, noWatermarkUrl);
          }
        }
      }
    }

    console.log(`[Xiaohongshu] Total images after spectrum: ${imageMap.size}`);

    // 方案3：从 imageList 数组中提取图片URL
    // 匹配格式: "imageList":[{...},{...}]
    const imageListMatch = html.match(/"imageList"\s*:\s*\[[\s\S]*?\]/);
    if (imageListMatch) {
      try {
        // 提取每个图片对象的 urlList
        const urlListPattern = /"urlList"\s*:\s*\[([^\]]+)\]/g;
        let urlMatch;
        while ((urlMatch = urlListPattern.exec(imageListMatch[0])) !== null) {
          const urls = urlMatch[1].match(/"(https?:[^"]+)"/g);
          if (urls) {
            for (const urlStr of urls) {
              let url = urlStr.replace(/^"/, '').replace(/"$/, '');
              url = this.decodeUnicode(url);
              url = url.replace(/^http:/, 'https:');

              // 提取图片ID用于去重
              const idMatch = url.match(/\/([a-f0-9]+)\/(1040g[a-z0-9]+)/) ||
                             url.match(/notes_pre_post\/([^/!?]+)/) ||
                             url.match(/spectrum\/(1040g[a-z0-9]+)/);
              if (idMatch) {
                const imageId = idMatch[2] || idMatch[1];
                if (!imageMap.has(imageId)) {
                  // 根据URL格式构建对应的图片URL
                  let finalUrl;
                  if (url.includes('/spectrum/')) {
                    // spectrum格式：构建无水印URL
                    finalUrl = `https://sns-na-i1.xhscdn.com/spectrum/${imageId}?imageView2/2/w/1080/format/webp&origin=0`;
                  } else if (url.includes('notes_pre_post')) {
                    // notes_pre_post格式：构建无水印URL
                    finalUrl = `https://sns-na-i1.xhscdn.com/notes_pre_post/${imageId}?imageView2/2/w/1080/format/webp&origin=0`;
                  } else if (url.includes('sns-webpic')) {
                    // sns-webpic格式：构建无水印URL
                    finalUrl = `https://sns-na-i1.xhscdn.com/${imageId}?imageView2/2/w/1080/format/webp&origin=0`;
                  } else {
                    // 其他格式：移除水印参数后使用原始URL
                    finalUrl = url.replace(/[?&]watermark=[^&]*/g, '');
                  }
                  imageMap.set(imageId, finalUrl);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error(`[Xiaohongshu] Error parsing imageList: ${e.message}`);
      }
    }

    console.log(`[Xiaohongshu] Total images after imageList: ${imageMap.size}`);

    if (imageMap.size === 0) {
      console.log(`[Xiaohongshu] No images found`);
    }

    return Array.from(imageMap.values());
  }

  // 解析笔记数据
  parseNoteData(noteDetail) {
    const title = noteDetail.title || '无标题';
    let desc = noteDetail.desc || '';
    // 去掉换行符，前端单行展示
    if (desc) {
      desc = desc.replace(/\\n/g, ' ').replace(/\n/g, ' ');
    }
    const author = noteDetail.user?.nickname || '未知作者';

    // 判断是否为视频类型
    const isVideo = noteDetail.type === 'video' || noteDetail.video;

    if (isVideo && noteDetail.video) {
      // 视频类型
      const videoUrl = this.extractVideoUrl(noteDetail.video);
      const cover = noteDetail.imageList?.[0]?.urlList?.[0] ||
                    noteDetail.video?.cover ||
                    '';

      return {
        type: 'video',
        title,
        desc,
        author,
        cover,
        videoUrl,
        duration: noteDetail.video?.duration,
      };
    } else {
      // 图文类型
      const images = this.extractImageUrls(noteDetail.imageList);
      const cover = images[0] || '';

      return {
        type: 'images',
        title,
        desc,
        author,
        cover,
        images,
      };
    }
  }

  // 提取视频URL
  extractVideoUrl(videoData) {
    // 尝试多种路径获取视频URL
    const streamUrls = videoData?.stream?.h264 ||
                       videoData?.media?.stream?.h264 ||
                       [];

    if (streamUrls.length > 0) {
      // 优先选择高清流
      const hdStream = streamUrls.find(s => s.quality === 'hd') || streamUrls[0];
      return hdStream.masterUrl || hdStream.url || '';
    }

    // 备选路径
    return videoData?.flowUrl ||
           videoData?.url ||
           videoData?.streamUrl ||
           '';
  }

  // 提取图片URL列表
  extractImageUrls(imageList) {
    if (!imageList || !Array.isArray(imageList)) return [];

    return imageList.map(img => {
      const urlList = img.urlList || img.url_list || [];
      if (urlList.length > 0) {
        // 获取原图URL
        let url = urlList[0];
        // 移除水印相关参数
        url = url.replace(/[\?&]watermark=[^&]*/g, '');
        return url;
      }
      return '';
    }).filter(url => url);
  }

  // 下载资源（视频/图片）带重试机制
  async downloadResource(url, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Xiaohongshu] 下载尝试 ${attempt}/${maxRetries}: ${url.substring(0, 80)}...`);

        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 1800000, // 30分钟超时
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'Referer': 'https://www.xiaohongshu.com/',
          },
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const ext = contentType.includes('video') ? 'mp4' :
                    contentType.includes('jpeg') ? 'jpg' :
                    contentType.includes('png') ? 'png' : 'jpg';

        const sizeMB = (response.data.byteLength / 1024 / 1024).toFixed(2);
        console.log(`[Xiaohongshu] 下载成功，大小: ${sizeMB}MB`);

        return {
          buffer: Buffer.from(response.data),
          contentType,
          ext,
          type: contentType.includes('video') ? 'video' : 'image',
        };
      } catch (error) {
        lastError = error;
        console.error(`[Xiaohongshu] 下载失败 (尝试 ${attempt}/${maxRetries}): ${error.code || error.message}`);

        const retryableErrors = ['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'];
        if (retryableErrors.includes(error.code) || error.message.includes('timeout')) {
          if (attempt < maxRetries) {
            const waitTime = attempt * 2000;
            console.log(`[Xiaohongshu] 等待 ${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }

        if (attempt >= maxRetries) {
          break;
        }
      }
    }

    console.error(`[Xiaohongshu] 下载资源最终失败: ${lastError?.code || lastError?.message}`);
    const err = new Error('下载资源失败，请稍后重试');
    err.status = 500;
    throw err;
  }
}

module.exports = new XiaohongshuService();
