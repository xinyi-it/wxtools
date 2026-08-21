const axios = require('axios');
const { cache, md5 } = require('../utils/cache');

const CACHE_PREFIX = 'kuaishou';

class KuaishouService {
  async parseShareUrl(shareUrl) {
    try {
      // 记录原始输入
      console.log(`[Kuaishou] 原始输入: ${shareUrl}`);

      const url = this.extractUrl(shareUrl);
      if (!url) {
        console.error(`[Kuaishou] URL提取失败，原始内容: ${shareUrl}`);
        const error = new Error('未找到有效的快手链接');
        error.status = 400;
        throw error;
      }
      console.log(`[Kuaishou] Extracted URL: ${url}`);

      // 尝试从缓存获取
      const cacheKey = `${CACHE_PREFIX}:parse:${md5(url)}`;
      const cachedResult = await cache.get(cacheKey);
      if (cachedResult) {
        console.log(`[Kuaishou] Cache HIT: ${cacheKey}`);
        return cachedResult;
      }
      console.log(`[Kuaishou] Cache MISS: ${cacheKey}`);

      let realUrl = url;
      if (url.includes('v.kuaishou.com') || url.includes('kuaishou.cn') || url.includes('chenzhongtech.com')) {
        realUrl = await this.getRedirectUrl(url);
        console.log(`[Kuaishou] Redirect URL: ${realUrl}`);
      }

      let photoId = this.extractPhotoId(realUrl);

      if (!photoId && realUrl.includes('photoId=')) {
        const match = realUrl.match(/photoId=([a-zA-Z0-9_-]+)/);
        if (match) {
          photoId = match[1];
        }
      }

      if (!photoId) {
        const error = new Error('无法解析视频ID');
        error.status = 400;
        throw error;
      }
      console.log(`[Kuaishou] Photo ID: ${photoId}`);

      if (realUrl.includes('chenzhongtech.com') || realUrl.includes('fw/photo')) {
        const result = await this.fetchFromRedirectUrl(realUrl, photoId);
        if (result) {
          // 存入缓存
          await cache.set(cacheKey, result);
          console.log(`[Kuaishou] Cache SET (redirect): ${cacheKey}`);
          return result;
        }
      }

      const videoInfo = await this.getVideoDetail(photoId);

      // 存入缓存
      await cache.set(cacheKey, videoInfo);
      console.log(`[Kuaishou] Cache SET: ${cacheKey}`);

      return videoInfo;
    } catch (error) {
      console.error(`[Kuaishou] 解析失败: ${error.message}`);
      throw error;
    }
  }

  extractUrl(text) {
    const patterns = [
      /https?:\/\/v\.kuaishou\.com\/[a-zA-Z0-9_-]+\/?/,
      /https?:\/\/kuaishou\.cn\/[a-zA-Z0-9_-]+\/?/,
      /https?:\/\/www\.kuaishou\.com\/short-video\/[a-zA-Z0-9_-]+/,
      /https?:\/\/m\.kuaishou\.com\/short-video\/[a-zA-Z0-9_-]+/,
      /https?:\/\/[a-zA-Z0-9-]*\.?kuaishouapp\.com\/[a-zA-Z0-9_\/-]+/,
      /https?:\/\/[a-zA-Z0-9-]*\.?chenzhongtech\.com\/[a-zA-Z0-9_\/?-]+/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }
    return null;
  }

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

  extractPhotoId(url) {
    const patterns = [
      /short-video\/([a-zA-Z0-9_-]+)/,
      /\/photo\/([a-zA-Z0-9_-]+)/,
      /photoId=([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  async fetchFromRedirectUrl(redirectUrl, photoId) {
    try {
      console.log(`[Kuaishou] Fetching from redirect URL: ${redirectUrl}`);
      const response = await axios.get(redirectUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });

      const html = response.data;
      console.log(`[Kuaishou] HTML length: ${html.length}`);

      const captionMatch = html.match(/"caption":"([^"]*)"/);
      const title = captionMatch ? captionMatch[1] : '无标题';

      const userNameMatch = html.match(/"userName":"([^"]*)"/);
      const author = userNameMatch ? userNameMatch[1] : '未知作者';

      // 检查是否为图文类型
      const photoTypeMatch = html.match(/"photoType":"([^"]*)"/);
      const photoType = photoTypeMatch ? photoTypeMatch[1] : '';

      if (photoType === 'HORIZONTAL_ATLAS' || photoType === 'VERTICAL_ATLAS') {
        // 图文类型
        console.log(`[Kuaishou] Detected atlas type: ${photoType}`);
        const images = this.extractAtlasImages(html);

        if (images.length > 0) {
          // 提取封面
          const coverUrlMatch = html.match(/"mainMvUrls":\[\{"[^"]*":"[^"]*","url":"([^"]+)"/);
          const cover = coverUrlMatch ? coverUrlMatch[1].replace(/\\u002F/g, '/') : images[0];

          // 提取音乐URL
          const musicUrl = this.extractAtlasMusic(html);

          console.log(`[Kuaishou] Successfully extracted atlas info: ${title}, ${images.length} images`);
          return {
            type: 'images',
            title,
            author,
            cover,
            images,
            musicUrl
          };
        }
      }

      // 视频类型
      const videoUrlMatch = html.match(/"mainMvUrls":\[\{"[^"]*":"[^"]*","url":"([^"]+)"/);
      const videoUrl = videoUrlMatch ? videoUrlMatch[1].replace(/\\u002F/g, '/') : '';

      const coverUrlMatch = html.match(/"coverUrls":\[\{"[^"]*":"[^"]*","url":"([^"]+)"/);
      const cover = coverUrlMatch ? coverUrlMatch[1].replace(/\\u002F/g, '/') : '';

      const durationMatch = html.match(/"duration":(\d+)/);
      const duration = durationMatch ? parseInt(durationMatch[1]) : undefined;

      if (videoUrl) {
        console.log(`[Kuaishou] Successfully extracted video info: ${title}`);
        return {
          type: 'video',
          title,
          author,
          cover,
          videoUrl,
          duration
        };
      }

      return null;
    } catch (error) {
      console.error(`[Kuaishou] 从重定向URL获取失败: ${error.message}`);
      return null;
    }
  }

  // 提取图文类型的图片列表
  extractAtlasImages(html) {
    try {
      // 查找 ext_params 中的 atlas 数据
      const extParamsMatch = html.match(/"ext_params":\{[^}]*"atlas":\{[\s\S]*?"list":\[(.*?)\]/);
      if (!extParamsMatch) {
        console.log('[Kuaishou] No atlas list found');
        return [];
      }

      // 提取图片路径列表
      const listMatch = extParamsMatch[0].match(/"list":\[(.*?)\]/);
      if (!listMatch) return [];

      const listStr = listMatch[1];
      const paths = listStr.match(/"([^"]+)"/g);
      if (!paths) return [];

      // 提取CDN列表
      const cdnMatch = html.match(/"cdn":\[(.*?)\]/);
      let cdns = ['p2.a.yximgs.com']; // 默认CDN
      if (cdnMatch) {
        const cdnStr = cdnMatch[1];
        const cdnList = cdnStr.match(/"([^"]+)"/g);
        if (cdnList && cdnList.length > 0) {
          cdns = cdnList.map(c => c.replace(/"/g, ''));
        }
      }

      // 构建图片URL列表
      const images = [];
      for (const path of paths) {
        const cleanPath = path.replace(/"/g, '');
        // 使用第一个CDN
        const imageUrl = `https://${cdns[0]}${cleanPath}`;
        images.push(imageUrl);
      }

      console.log(`[Kuaishou] Extracted ${images.length} atlas images`);
      return images;
    } catch (error) {
      console.error(`[Kuaishou] Extract atlas images failed: ${error.message}`);
      return [];
    }
  }

  // 提取图文类型的音乐URL
  extractAtlasMusic(html) {
    try {
      const musicMatch = html.match(/"music":"([^"]+)"/);
      if (!musicMatch) return null;

      const musicPath = musicMatch[1];

      // 提取音乐CDN
      const musicCdnMatch = html.match(/"musicCdnList":\[\{"cdn":"([^"]+)"/);
      const musicCdn = musicCdnMatch ? musicCdnMatch[1] : 'k0u24y88y58y1bzw2409x8c5cx110x1300xx1bz.djvod.ndcimgs.com';

      return `https://${musicCdn}${musicPath}`;
    } catch (error) {
      console.error(`[Kuaishou] Extract atlas music failed: ${error.message}`);
      return null;
    }
  }

  async getVideoDetail(photoId) {
    const shareUrl = `https://www.kuaishou.com/short-video/${photoId}`;

    try {
      console.log(`[Kuaishou] Fetching: ${shareUrl}`);
      const response = await axios.get(shareUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });

      const html = response.data;

      // 尝试从 __NEXT_DATA__ 中提取数据
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          console.log(`[Kuaishou] Found __NEXT_DATA__`);

          const props = nextData?.props?.initialState;
          if (props) {
            const photoInfo = props.photoInfo || props?.['short-video']?.photoInfo;
            if (photoInfo) {
              const photo = photoInfo.photo;
              return {
                title: photo.caption || photo.mainMvUrls?.[0]?.caption || '无标题',
                author: photo.userName || photo.user?.name || '未知作者',
                cover: photo.coverUrls?.[0]?.url || photo.mainMvUrls?.[0]?.coverUrl || '',
                videoUrl: photo.mainMvUrls?.[0]?.url || photo.photoUrl || '',
                duration: photo.duration,
              };
            }
          }
        } catch (parseError) {
          console.error(`[Kuaishou] 解析 __NEXT_DATA__ 失败: ${parseError.message}`);
        }
      }

      // 尝试从 window.__INITIAL_STATE__ 中提取
      const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
      if (initialStateMatch) {
        try {
          const initialState = JSON.parse(initialStateMatch[1]);
          console.log(`[Kuaishou] Found __INITIAL_STATE__`);

          const photo = initialState?.photoInfo?.photo;
          if (photo) {
            return {
              title: photo.caption || '无标题',
              author: photo.userName || '未知作者',
              cover: photo.coverUrls?.[0]?.url || '',
              videoUrl: photo.mainMvUrls?.[0]?.url || photo.photoUrl || '',
              duration: photo.duration,
            };
          }
        } catch (parseError) {
          console.error(`[Kuaishou] 解析 __INITIAL_STATE__ 失败: ${parseError.message}`);
        }
      }

      // 尝试调用快手 API
      const apiResult = await this.fetchFromApi(photoId);
      if (apiResult) {
        return apiResult;
      }

      throw new Error('获取视频信息失败');
    } catch (error) {
      console.error(`[Kuaishou] 获取视频详情失败: ${error.message}`);
      throw new Error('获取视频信息失败');
    }
  }

  async fetchFromApi(photoId) {
    try {
      const apiUrl = 'https://www.kuaishou.com/graphql';
      const query = `
        query visionVideoPhotoGraph($photoId: String) {
          visionVideoPhoto(photoId: $photoId) {
            photo {
              id
              caption
              duration
              coverUrls {
                url
              }
              mainMvUrls {
                url
                coverUrl
                caption
              }
              user {
                id
                name
              }
            }
          }
        }
      `;

      const response = await axios.post(apiUrl, {
        operationName: 'visionVideoPhotoGraph',
        query,
        variables: { photoId },
      }, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
          'Content-Type': 'application/json',
          'Referer': `https://www.kuaishou.com/short-video/${photoId}`,
        },
      });

      const data = response.data;
      const photo = data?.data?.visionVideoPhoto?.photo;

      if (photo) {
        return {
          title: photo.caption || '无标题',
          author: photo.user?.name || '未知作者',
          cover: photo.coverUrls?.[0]?.url || '',
          videoUrl: photo.mainMvUrls?.[0]?.url || '',
          duration: photo.duration,
        };
      }

      return null;
    } catch (error) {
      console.error(`[Kuaishou] API 获取失败: ${error.message}`);
      return null;
    }
  }

  // 下载资源（视频/图片）带重试机制
  async downloadResource(url, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Kuaishou] 下载尝试 ${attempt}/${maxRetries}: ${url.substring(0, 80)}...`);

        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 1800000, // 30分钟超时
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'Referer': 'https://www.kuaishou.com/',
          },
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const ext = contentType.includes('video') ? 'mp4' :
                    contentType.includes('jpeg') ? 'jpg' :
                    contentType.includes('png') ? 'png' :
                    contentType.includes('webp') ? 'webp' : 'jpg';

        const sizeMB = (response.data.byteLength / 1024 / 1024).toFixed(2);
        console.log(`[Kuaishou] 下载成功，大小: ${sizeMB}MB`);

        return {
          buffer: Buffer.from(response.data),
          contentType,
          ext,
          type: contentType.includes('video') ? 'video' : 'image',
        };
      } catch (error) {
        lastError = error;
        console.error(`[Kuaishou] 下载失败 (尝试 ${attempt}/${maxRetries}): ${error.code || error.message}`);

        const retryableErrors = ['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'];
        if (retryableErrors.includes(error.code) || error.message.includes('timeout')) {
          if (attempt < maxRetries) {
            const waitTime = attempt * 2000;
            console.log(`[Kuaishou] 等待 ${waitTime}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }

        if (attempt >= maxRetries) {
          break;
        }
      }
    }

    console.error(`[Kuaishou] 下载资源最终失败: ${lastError?.code || lastError?.message}`);
    const err = new Error('下载资源失败，请稍后重试');
    err.status = 500;
    throw err;
  }

  // 下载视频（保留向后兼容）
  async downloadVideo(videoUrl) {
    return this.downloadResource(videoUrl);
  }
}

module.exports = new KuaishouService();
