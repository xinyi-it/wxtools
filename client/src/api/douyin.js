/**
 * 抖音相关API
 */
import request from '@/utils/request'

/**
 * 解析抖音分享链接
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
