const Router = require('@koa/router');
const Joi = require('joi');
const douyinService = require('../services/douyin.service');
const douyinTask = require('../services/douyin.task');

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

// 解析抖音分享链接（同步：公网会被 Cloudflare 100 秒超时掐断，仅内网/本地使用）
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

/**
 * 提交解析任务（异步，公网走这个）
 * 立刻返回 taskId，解析在后台跑，前端拿 taskId 去轮询 /parse/task
 *
 * POST /douyin/parse/async  body: { url, cookie? }
 *   -> { code:0, data: { taskId, status: 'pending'|'done', cached } }
 */
router.post('/parse/async', async (ctx) => {
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

  // 校验链接里到底有没有抖音地址，别让后台白跑一趟
  if (!douyinService.extractUrl(url)) {
    ctx.status = 400;
    ctx.body = { code: 400, message: '未找到有效的抖音链接', data: null };
    return;
  }

  const task = await douyinTask.submit(url, cookie);
  ctx.success(task, task.status === 'done' ? '获取成功' : '已提交解析');
});

/**
 * 查询解析任务状态
 *
 * GET /douyin/parse/task?taskId=xxx
 *   pending -> { code:0, data: { taskId, status:'pending' } }
 *   done    -> { code:0, data: { taskId, status:'done', data:{...} } }
 *   failed  -> { code:500, message: 失败原因, data:null }
 *   任务不存在/已过期 -> 404
 */
router.get('/parse/task', async (ctx) => {
  const { taskId } = ctx.query;

  if (!taskId) {
    ctx.status = 400;
    ctx.body = { code: 400, message: '请提供 taskId', data: null };
    return;
  }

  const task = await douyinTask.query(taskId);

  if (!task) {
    ctx.status = 404;
    ctx.body = { code: 404, message: '任务不存在或已过期，请重新解析', data: null };
    return;
  }

  if (task.status === 'failed') {
    ctx.status = 500;
    ctx.body = { code: 500, message: task.error, data: null };
    return;
  }

  ctx.success(task, task.status === 'done' ? '获取成功' : '解析中');
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
