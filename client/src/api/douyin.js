/**
 * 抖音相关API
 */
import request from '@/utils/request'

/**
 * 检查Cookie状态
 * @param {string} cookie 抖音Cookie
 */
export function checkDouyinCookie(cookie) {
  return request.post('/douyin/cookie/check', { cookie })
}

/**
 * 解析抖音分享链接
 * @param {string} url 分享链接
 * @param {string} cookie 抖音Cookie（可选，各用户用自己的）
 */
export function parseDouyinUrl(url, cookie = '') {
  return request.post('/douyin/parse', { url, cookie })
}

/**
 * 获取抖音资源下载地址（视频/图片）
 * @param {string} resourceUrl 资源地址
 */
export function getDouyinDownloadUrl(resourceUrl) {
  return request.getFullUrl(`/douyin/download?url=${encodeURIComponent(resourceUrl)}`)
}

/**
 * 本地存储Cookie（仅存本机，不上传服务器持久化）
 */
const COOKIE_STORAGE_KEY = 'douyin_cookie'

export function saveCookieLocal(cookie) {
  try {
    uni.setStorageSync(COOKIE_STORAGE_KEY, cookie)
    return true
  } catch (e) {
    return false
  }
}

export function getCookieLocal() {
  try {
    return uni.getStorageSync(COOKIE_STORAGE_KEY) || ''
  } catch (e) {
    return ''
  }
}

export function clearCookieLocal() {
  try {
    uni.removeStorageSync(COOKIE_STORAGE_KEY)
    return true
  } catch (e) {
    return false
  }
}
