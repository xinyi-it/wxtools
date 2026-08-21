/**
 * 小红书相关API
 */
import request from '@/utils/request'

/**
 * 解析小红书分享链接
 * @param {string} url 分享链接
 */
export function parseXiaohongshuUrl(url) {
  return request.post('/xiaohongshu/parse', { url })
}

/**
 * 获取小红书资源下载地址
 * @param {string} resourceUrl 资源地址
 */
export function getXiaohongshuDownloadUrl(resourceUrl) {
  return request.getFullUrl(`/xiaohongshu/download?url=${encodeURIComponent(resourceUrl)}`)
}
