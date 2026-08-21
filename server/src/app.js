require('dotenv').config();
const Koa = require('koa');
const cors = require('@koa/cors');
const logger = require('koa-logger');
const bodyParser = require('koa-bodyparser');
const serve = require('koa-static');
const mongoose = require('mongoose');
const config = require('./config');
const { getRedis, closeRedis } = require('./config/redis');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/error');
const responseMiddleware = require('./middlewares/response');
const menuService = require('./services/menu.service');
const pdfService = require('./services/pdf.service');
const CleanupService = require('./services/cleanup.service');

const app = new Koa();

// 中间件
app.use(logger());
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(bodyParser());
app.use(errorMiddleware);
app.use(responseMiddleware);

// 静态文件服务
app.use(serve('./uploads'));

// 路由 - 设置全局前缀
routes.prefix(config.apiPrefix);
app.use(routes.routes()).use(routes.allowedMethods());

// 连接数据库并启动服务
const startServer = async () => {
  try {
    await mongoose.connect(config.mongodbUri);
    console.log('[MongoDB] Connected successfully');

    // 初始化 Redis 连接
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      console.log('[Redis] Connected successfully');
    } else {
      console.log('[Redis] Not configured, caching disabled');
    }

    // 初始化默认菜单
    await menuService.initDefaultMenus();

    // 启动清理服务
    const cleanupService = new CleanupService(pdfService, config.pdfCleanup);
    cleanupService.start();

    // 优雅关闭
    const gracefulShutdown = async () => {
      console.log('[Server] Shutting down...');
      cleanupService.stop();
      await closeRedis();
      await mongoose.connection.close(false);
      console.log('[MongoDB] Connection closed');
      process.exit(0);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    app.listen(config.port, () => {
      console.log(`[Server] Running on http://localhost:${config.port}`);
      console.log(`[API] Prefix: ${config.apiPrefix}`);
    });
  } catch (error) {
    console.error('[MongoDB] Connection error:', error.message);
    process.exit(1);
  }
};

startServer();
