/**
 * B站相关API
 */
import request from '@/utils/request'

/**
 * 检查Cookie状态
 * @param {string} cookie B站Cookie
 */
export function checkBilibiliCookie(cookie) {
  return request.post('/bilibili/cookie/check', { cookie })
}

/**
 * 解析B站分享链接
 * @param {string} url 分享链接
 * @param {string} cookie B站Cookie（可选）
 */
export function parseBilibiliUrl(url, cookie = '') {
  return request.post('/bilibili/parse', { url, cookie })
}

/**
 * 获取B站资源下载地址
 * @param {string} resourceUrl 资源地址
 */
export function getBilibiliDownloadUrl(resourceUrl) {
  return request.getFullUrl(`/bilibili/download?url=${encodeURIComponent(resourceUrl)}`)
}

/**
 * 获取代理后的封面图片URL（解决小程序域名白名单问题）
 * @param {string} coverUrl 原始封面URL
 */
export function getBilibiliCoverUrl(coverUrl) {
  if (!coverUrl) return ''
  return request.getFullUrl(`/bilibili/cover?url=${encodeURIComponent(coverUrl)}`)
}

/**
 * 获取代理后的视频流URL（解决小程序域名白名单问题）
 * @param {string} videoUrl 原始视频URL
 */
export function getBilibiliVideoUrl(videoUrl) {
  if (!videoUrl) return ''
  return request.getFullUrl(`/bilibili/video?url=${encodeURIComponent(videoUrl)}`)
}

/**
 * 本地存储Cookie
 */
const COOKIE_STORAGE_KEY = 'bilibili_cookie'

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
