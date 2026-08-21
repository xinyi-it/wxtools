/**
 * 快手相关API
 */
import request from '@/utils/request'

/**
 * 解析快手分享链接
 * @param {string} url 分享链接
 */
export function parseKuaishouUrl(url) {
  return request.post('/kuaishou/parse', { url })
}

/**
 * 获取快手资源下载地址（视频/图片）
 * @param {string} resourceUrl 资源地址
 */
export function getKuaishouDownloadUrl(resourceUrl) {
  return request.getFullUrl(`/kuaishou/download?url=${encodeURIComponent(resourceUrl)}`)
}
