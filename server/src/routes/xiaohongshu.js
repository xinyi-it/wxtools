const Router = require('@koa/router');
const Joi = require('joi');
const xiaohongshuService = require('../services/xiaohongshu.service');

const router = new Router();

// 解析小红书分享链接
router.post('/parse', async (ctx) => {
  const { url } = ctx.request.body;

  const schema = Joi.object({
    url: Joi.string().required().messages({
      'string.empty': '请输入小红书分享链接',
      'any.required': '请输入小红书分享链接'
    })
  });

  const { error } = schema.validate({ url });
  if (error) {
    ctx.status = 400;
    ctx.body = { code: 400, message: error.details[0].message, data: null };
    return;
  }

  const result = await xiaohongshuService.parseShareUrl(url);
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

  const result = await xiaohongshuService.downloadResource(url);
  ctx.set('Content-Type', result.contentType);
  ctx.set('Content-Disposition', `attachment; filename=xiaohongshu_${result.type}.${result.ext}`);
  ctx.body = result.buffer;
});

module.exports = router;
