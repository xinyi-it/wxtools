/**
 * 抖音相关API
 */
import request from '@/utils/request'

/**
 * 解析抖音分享链接
 *
 * 无需传 cookie —— 后端优先走接口，被风控挡住时自动切浏览器通道，
 * 用服务端浏览器的登录态取无水印直链。
 *
 * ⚠️ 现在走异步接口（原来同步的 /douyin/parse）：
 *   解析要几十秒，公网经过 Cloudflare 代理会被 100 秒超时掐断连接，
 *   同步接口拿不到结果。所以改成提交任务 + 轮询。
 *
 * @param {string} url 分享链接
 */
export function parseDouyinUrl(url) {
  return request.post('/douyin/parse/async', { url })
}

/**
 * 查询解析任务状态
 *
 * 返回字段：
 *   status = 'pending' 解析中
 *   status = 'done'    解析完成，结果在 data.data
 * @param {string} taskId 任务ID
 */
export function queryDouyinTask(taskId) {
  return request.get('/douyin/parse/task', { params: { taskId } })
}

/**
 * 获取抖音资源下载地址（视频/图片）
 * @param {string} resourceUrl 资源地址
 */
export function getDouyinDownloadUrl(resourceUrl) {
  return request.getFullUrl(`/douyin/download?url=${encodeURIComponent(resourceUrl)}`)
}
