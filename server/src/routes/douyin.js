const Router = require('@koa/router');
const Joi = require('joi');
const douyinService = require('../services/douyin.service');

const router = new Router();

// 检查用户抖音 Cookie 状态（不存储，各用户用自己的）
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
  const status = await douyinService.checkCookieStatus(cookie);
  ctx.success(status);
});

// 解析抖音分享链接
router.post('/parse', async (ctx) => {
  const { url, cookie = '' } = ctx.request.body;

  const schema = Joi.object({
    url: Joi.string().required().messages({
      'string.empty': '请输入抖音分享链接',
      'any.required': '请输入抖音分享链接'
    })
  });

  const { error } = schema.validate({ url });
  if (error) {
    ctx.status = 400;
    ctx.body = { code: 400, message: error.details[0].message, data: null };
    return;
  }

  const result = await douyinService.parseShareUrl(url, cookie);
  ctx.success(result);
});

// 下载资源（视频/图片）
router.get('/download', async (ctx) => {
  const { url } = ctx.query;

  if (!url) {
    ctx.status = 400;
    ctx.body = { code: 400, message: '请提供资源URL', data: null };
    return;
  }

  const result = await douyinService.downloadResource(url);
  ctx.set('Content-Type', result.contentType);
  ctx.set('Content-Disposition', `attachment; filename=douyin_${result.type}.${result.ext}`);
  ctx.body = result.buffer;
});

module.exports = router;
