/**
 * PDF相关API
 */
import request from '@/utils/request'

/**
 * 转换PDF为图片
 * @param {string} filePath 文件路径
 * @param {Object} options 转换选项 { width, height }
 */
export function convertPdf(filePath, options = {}) {
  return request.upload({
    url: '/pdf/convert',
    filePath,
    name: 'file',
    formData: options
  })
}

/**
 * 获取PDF图片地址
 * @param {string} filename 文件名
 */
export function getPdfImageUrl(filename) {
  return request.getFullUrl(`/pdf/image/${filename}`)
}
