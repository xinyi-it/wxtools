const Router = require('@koa/router');
const bannerService = require('../services/banner.service');

const router = new Router();

/**
 * 格式化日期时间为标准格式
 * @param {Date} date
 * @returns {string} YYYY-MM-DD HH:mm:ss
 */
const formatDateTime = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * 获取横幅配置
 * GET /banner
 */
router.get('/', async (ctx) => {
  const banner = await bannerService.getBanner();
  ctx.success({
    content: banner.content,
    visible: banner.visible,
    updatedAt: formatDateTime(banner.updatedAt)
  });
});

/**
 * 更新横幅配置
 * PUT /banner
 */
router.put('/', async (ctx) => {
  const { content, visible } = ctx.request.body;
  const banner = await bannerService.updateBanner({ content, visible });
  ctx.success({
    content: banner.content,
    visible: banner.visible,
    updatedAt: formatDateTime(banner.updatedAt)
  });
});

/**
 * 切换显示状态
 * PUT /banner/toggle
 */
router.put('/toggle', async (ctx) => {
  const banner = await bannerService.toggleVisible();
  if (!banner) {
    ctx.status = 404;
    ctx.body = { code: 404, message: '横幅配置不存在', data: null };
    return;
  }
  ctx.success({
    content: banner.content,
    visible: banner.visible,
    updatedAt: formatDateTime(banner.updatedAt)
  });
});

module.exports = router;
