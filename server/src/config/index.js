require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/wxtools',
  redisUrl: process.env.REDIS_URL || null,
  apiPrefix: '/wxtools/api',

  // PDF文件清理配置
  pdfCleanup: {
    enabled: true,
    ttlMinutes: 30,        // 文件保留时间（分钟）
    intervalMinutes: 15,   // 清理间隔（分钟）
    maxTotalSizeGB: 10,    // 最大总容量（GB）
  },

  // Redis 缓存配置
  cache: {
    enabled: true,         // 是否启用缓存
    ttlSeconds: 3600,      // 默认缓存时间 1 小时
  }
};
