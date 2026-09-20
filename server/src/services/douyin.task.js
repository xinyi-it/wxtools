/**
 * 抖音解析 - 异步任务管理器
 *
 * 为什么需要它：
 *   解析要几十秒（接口被风控后走浏览器兜底渲染页面，实测 50-90 秒）。
 *   但公网走 Cloudflare 代理，CF 对免费版有 100 秒响应超时，实测 60 秒就掐断连接，
 *   同步接口在公网必定拿不到结果（本地测都通，一上公网就断）。
 *   所以改成异步任务：提交立刻返回 taskId，前端轮询取结果，每次请求都是秒回。
 *
 * 存储：Redis（容器重建不丢，多个实例可共享）
 *   douyin:task:<taskId> -> JSON { status, data, error, createdAt, updatedAt }
 *
 * status 取值：pending | done | failed
 */
const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const douyinService = require('./douyin.service');

const TASK_PREFIX = 'douyin:task';
// 任务结果保留时长（秒）：够前端取走即可，不给 Redis 添堵
const TASK_TTL = 600;
// 终态是否也走缓存（解析结果本身也缓存一份，同一链接再解析秒回）
const RESULT_TTL = 1800;

// 内存兜底：Redis 不可用时至少同进程内能查到任务状态
const memoryTasks = new Map();
// 内存任务清理定时器（只起一次）
let memorySweeper = null;

function startMemorySweeper() {
  if (memorySweeper) return;
  memorySweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, task] of memoryTasks) {
      if (now - task.createdAt > TASK_TTL * 1000) memoryTasks.delete(id);
    }
  }, 60 * 1000);
  // 别让它吊着进程不退
  if (memorySweeper.unref) memorySweeper.unref();
}

function newTaskId() {
  return crypto.randomBytes(12).toString('hex');
}

async function saveTask(taskId, payload) {
  const record = { ...payload, updatedAt: Date.now() };
  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(`${TASK_PREFIX}:${taskId}`, TASK_TTL, JSON.stringify(record));
      return;
    } catch (e) {
      console.error(`[DouyinTask] Redis 写入失败，降级到内存: ${e.message}`);
    }
  }
  startMemorySweeper();
  memoryTasks.set(taskId, record);
}

async function loadTask(taskId) {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`${TASK_PREFIX}:${taskId}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error(`[DouyinTask] Redis 读取失败，降级到内存: ${e.message}`);
    }
  }
  return memoryTasks.get(taskId) || null;
}

/**
 * 提交解析任务：立刻返回 taskId，解析在后台跑
 * @returns {Promise<{taskId: string, status: string, cached: boolean}>}
 */
async function submit(url, cookie = '') {
  // 统一规范化（提取真实链接 + 去尾斜杠）。
  // 必须和 parseShareUrl 用同一个口径，否则两边算出的缓存 key 对不上，
  // 会出现「换链接仍返回上一条视频」的串用问题。
  const realUrl = douyinService.normalizeUrl(url);

  // 已解析过的链接：直接给终态任务，前端第一次轮询就拿到结果
  const redis = getRedis();
  if (redis) {
    try {
      const hitKey = `${TASK_PREFIX}:hit:${douyinService.cacheKeyOf(realUrl, cookie)}`;
      const hit = await redis.get(hitKey);
      if (hit) {
        const taskId = newTaskId();
        await saveTask(taskId, { status: 'done', data: JSON.parse(hit), url: realUrl });
        console.log(`[DouyinTask] 命中已解析缓存，直接返回终态: ${taskId}`);
        return { taskId, status: 'done', cached: true };
      }
    } catch (e) {
      console.error(`[DouyinTask] 查历史结果失败: ${e.message}`);
    }
  }

  const taskId = newTaskId();
  await saveTask(taskId, { status: 'pending', url: realUrl, createdAt: Date.now() });

  // 后台跑，不 await —— 请求立刻返回
  runTask(taskId, realUrl, cookie);

  return { taskId, status: 'pending', cached: false };
}

/**
 * 后台执行解析（异常全部吞掉并写进任务状态，不能影响进程）
 */
async function runTask(taskId, url, cookie) {
  const started = Date.now();
  console.log(`[DouyinTask] 开始解析 ${taskId} url=${url}`);
  try {
    const data = await douyinService.parseShareUrl(url, cookie);
    await saveTask(taskId, { status: 'done', data, url, createdAt: started });
    console.log(`[DouyinTask] 解析成功 ${taskId}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

    // 存一份结果缓存，同一链接下次秒回
    const redis = getRedis();
    if (redis) {
      try {
        await redis.setex(
          `${TASK_PREFIX}:hit:${douyinService.cacheKeyOf(url, cookie)}`,
          RESULT_TTL,
          JSON.stringify(data)
        );
      } catch (e) {
        console.error(`[DouyinTask] 结果缓存写入失败: ${e.message}`);
      }
    }
  } catch (e) {
    const msg = e.message || '解析失败';
    await saveTask(taskId, { status: 'failed', error: msg, url, createdAt: started });
    console.error(`[DouyinTask] 解析失败 ${taskId}: ${msg}`);
  }
}

/**
 * 查询任务状态
 * @returns {Promise<{taskId: string, status: string, data?: object, error?: string} | null>}
 */
async function query(taskId) {
  if (!taskId) return null;
  const task = await loadTask(taskId);
  if (!task) return null;
  const out = { taskId, status: task.status };
  if (task.status === 'done') out.data = task.data;
  if (task.status === 'failed') out.error = task.error || '解析失败';
  return out;
}

module.exports = { submit, query, TASK_TTL };
