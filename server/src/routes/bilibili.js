const Router = require('@koa/router');
const Joi = require('joi');
const axios = require('axios');
const bilibiliService = require('../services/bilibili.service');

const router = new Router();

// 检查Cookie状态
router.post('/cookie/check', async (ctx) => {
  const { cookie } = ctx.request.body;

  if (!cookie) {
    ctx.success({
      valid: false,
      isLogin: false,
      message: '未设置Cookie',
      hasCookie: false,
    });
    return;
  }

  const status = await bilibiliService.checkCookieStatus(cookie);
  ctx.success(status);
});

// 解析B站分享链接
router.post('/parse', async (ctx) => {
  const { url, cookie } = ctx.request.body;

  const schema = Joi.object({
    url: Joi.string().required().messages({
      'string.empty': '请输入B站分享链接',
      'any.required': '请输入B站分享链接'
    })
  });

  const { error } = schema.validate({ url });
  if (error) {
    ctx.status = 400;
    ctx.body = { code: 400, message: error.details[0].message, data: null };
    return;
  }

  const result = await bilibiliService.parseShareUrl(url, cookie || '');
  ctx.success(result);
});

// 代理封面图片（解决小程序域名白名单问题）
router.get('/cover', async (ctx) => {
  const { url } = ctx.query;

  if (!url) {
    ctx.status = 400;
    ctx.body = { code: 400, message: '请提供图片URL', data: null };
    return;
  }

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
      timeout: 10000,
    });

    ctx.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    ctx.set('Cache-Control', 'public, max-age=86400'); // 缓存1天
    ctx.body = response.data;
  } catch (error) {
    ctx.status = 500;
    ctx.body = { code: 500, message: '图片获取失败', data: null };
  }
});

// 代理视频流（解决小程序域名白名单问题）
router.get('/video', async (ctx) => {
  const { url } = ctx.query;

  if (!url) {
    ctx.status = 400;
    ctx.body = { code: 400, message: '请提供视频URL', data: null };
    return;
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.bilibili.com/',
    };

    // 支持Range请求（视频拖动）
    if (ctx.headers.range) {
      headers['Range'] = ctx.headers.range;
    }

    const response = await axios.get(url, {
      responseType: 'stream',
      headers,
      timeout: 60000,
    });

    // 转发响应头
    const contentType = response.headers['content-type'];
    const contentLength = response.headers['content-length'];
    const contentRange = response.headers['content-range'];

    if (contentType) ctx.set('Content-Type', contentType);
    if (contentLength) ctx.set('Content-Length', contentLength);
    if (contentRange) ctx.set('Content-Rage', contentRange);
    ctx.set('Cache-Control', 'public, max-age=3600');

    // 流式响应
    ctx.status = response.status;
    ctx.body = response.data;
  } catch (error) {
    console.error('[Bilibili] 视频代理失败:', error.message);
    ctx.status = 500;
    ctx.body = { code: 500, message: '视频获取失败', data: null };
  }
});

// 下载视频
router.get('/download', async (ctx) => {
  const { url } = ctx.query;

  if (!url) {
    ctx.status = 400;
    ctx.body = { code: 400, message: '请提供资源URL', data: null };
    return;
  }

  const result = await bilibiliService.downloadResource(url);
  ctx.set('Content-Type', result.contentType);
  ctx.set('Content-Disposition', `attachment; filename=bilibili_${result.type}.${result.ext}`);
  ctx.body = result.buffer;
});

module.exports = router;
