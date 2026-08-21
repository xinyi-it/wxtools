const Router = require('@koa/router');
const douyinRouter = require('./douyin');
const kuaishouRouter = require('./kuaishou');
const xiaohongshuRouter = require('./xiaohongshu');
const bilibiliRouter = require('./bilibili');
const pdfRouter = require('./pdf');
const menuRouter = require('./menu');
const bannerRouter = require('./banner');

const router = new Router();

router.use('/douyin', douyinRouter.routes(), douyinRouter.allowedMethods());
router.use('/kuaishou', kuaishouRouter.routes(), kuaishouRouter.allowedMethods());
router.use('/xiaohongshu', xiaohongshuRouter.routes(), xiaohongshuRouter.allowedMethods());
router.use('/bilibili', bilibiliRouter.routes(), bilibiliRouter.allowedMethods());
router.use('/pdf', pdfRouter.routes(), pdfRouter.allowedMethods());
router.use('/menu', menuRouter.routes(), menuRouter.allowedMethods());
router.use('/banner', bannerRouter.routes(), bannerRouter.allowedMethods());

module.exports = router;
