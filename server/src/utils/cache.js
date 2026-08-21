const CryptoJS = require('crypto-js');
const { getRedis } = require('../config/redis');
const config = require('../config/index');

/**
 * 生成缓存 key 的 MD5 哈希
 * @param {string} str 原始字符串
 * @returns {string} MD5 哈希值
 */
function md5(str) {
  return CryptoJS.MD5(str).toString();
}

/**
 * 缓存装饰器 - 包装异步函数，添加缓存层
 * @param {string} prefix 缓存 key 前缀
 * @param {number} ttl 缓存时间（秒），默认使用配置值
 * @returns {Function} 装饰器函数
 */
function withCache(prefix, ttl = null) {
  const cacheTtl = ttl || config.cache.ttlSeconds;

  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      // 缓存未启用或 Redis 不可用，直接执行原方法
      if (!config.cache.enabled) {
        return originalMethod.apply(this, args);
      }

      const redis = getRedis();
      if (!redis) {
        return originalMethod.apply(this, args);
      }

      // 生成缓存 key
      const key = `${prefix}:${md5(JSON.stringify(args))}`;

      try {
        // 尝试从缓存获取
        const cached = await redis.get(key);
        if (cached) {
          console.log(`[Cache] HIT: ${key}`);
          return JSON.parse(cached);
        }

        console.log(`[Cache] MISS: ${key}`);

        // 执行原方法
        const result = await originalMethod.apply(this, args);

        // 存入缓存（异步，不阻塞响应）
        redis.setex(key, cacheTtl, JSON.stringify(result)).catch((err) => {
          console.error(`[Cache] SET error: ${err.message}`);
        });

        return result;
      } catch (err) {
        console.error(`[Cache] Error: ${err.message}`);
        // 缓存出错时，降级执行原方法
        return originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}

/**
 * 手动缓存操作
 */
const cache = {
  /**
   * 获取缓存
   */
  async get(key) {
    const redis = getRedis();
    if (!redis) return null;

    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  },

  /**
   * 设置缓存
   */
  async set(key, value, ttl = config.cache.ttlSeconds) {
    const redis = getRedis();
    if (!redis) return false;

    await redis.setex(key, ttl, JSON.stringify(value));
    return true;
  },

  /**
   * 删除缓存
   */
  async del(key) {
    const redis = getRedis();
    if (!redis) return false;

    await redis.del(key);
    return true;
  },

  /**
   * 生成带前缀的 key
   */
  key(prefix, ...parts) {
    return `${prefix}:${md5(parts.join(':'))}`;
  }
};

module.exports = {
  md5,
  withCache,
  cache,
};
