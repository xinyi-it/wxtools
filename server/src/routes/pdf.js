const Router = require('@koa/router');
const multer = require('@koa/multer');
const pdfService = require('../services/pdf.service');
const { convertPdfSchema } = require('../utils/validator');

const router = new Router();

// 配置 multer
const upload = multer({
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
});

// 转换 PDF
router.post('/convert', upload.single('file'), async (ctx) => {
  if (!ctx.file) {
    ctx.status = 400;
    ctx.body = { code: 400, message: '请上传PDF文件', data: null };
    return;
  }

  const { error, value } = convertPdfSchema.validate(ctx.request.body);
  if (error) {
    ctx.status = 400;
    ctx.body = { code: 400, message: error.details[0].message, data: null };
    return;
  }

  const result = await pdfService.convertPdfToImages(ctx.file, value);
  ctx.success(result);
});

// 获取图片
router.get('/image/:filename', async (ctx) => {
  const { filename } = ctx.params;
  const buffer = await pdfService.getImage(filename);
  ctx.set('Content-Type', 'image/png');
  ctx.body = buffer;
});

module.exports = router;
