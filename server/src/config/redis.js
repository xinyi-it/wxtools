const Redis = require('ioredis');
const config = require('./index');

let redis = null;

/**
 * 获取 Redis 客户端实例
 */
function getRedis() {
  if (!redis && config.redisUrl) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
  }
  return redis;
}

/**
 * 关闭 Redis 连接
 */
async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
    console.log('[Redis] Connection closed');
  }
}

module.exports = {
  getRedis,
  closeRedis,
};
