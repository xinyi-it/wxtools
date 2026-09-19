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
 * @param {string} url 分享链接
 */
export function parseDouyinUrl(url) {
  return request.post('/douyin/parse', { url })
}

/**
 * 获取抖音资源下载地址（视频/图片）
 * @param {string} resourceUrl 资源地址
 */
export function getDouyinDownloadUrl(resourceUrl) {
  return request.getFullUrl(`/douyin/download?url=${encodeURIComponent(resourceUrl)}`)
}
