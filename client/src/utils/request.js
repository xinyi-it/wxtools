/**
 * 统一请求封装
 * 参考若依框架的设计模式
 */

// API基础地址 - 根据环境自动切换
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/wxtools/api'

// 请求超时时间
const TIMEOUT = 30000

// 下载文件超时时间（5分钟，适合大文件）
const DOWNLOAD_TIMEOUT = 300000

/**
 * 核心请求方法
 * @param {Object} config 请求配置
 * @returns {Promise}
 */
const request = (config) => {
  return new Promise((resolve, reject) => {
    // 构建完整URL
    const url = config.url.startsWith('http') ? config.url : BASE_URL + config.url

    // 请求配置
    const requestConfig = {
      url,
      method: config.method || 'GET',
      data: config.data,
      header: {
        'Content-Type': 'application/json',
        ...config.header
      },
      timeout: config.timeout || TIMEOUT
    }

    // 发起请求
    uni.request({
      ...requestConfig,
      success: (response) => {
        const { statusCode, data } = response

        // HTTP状态码判断
        if (statusCode === 200 || statusCode === 201) {
          // 业务状态码判断 (code: 0 表示成功)
          if (data.code === 0) {
            resolve(data)
          } else {
            // 业务错误
            const errorMsg = data.message || '请求失败'
            uni.showToast({ title: errorMsg, icon: 'none' })
            reject(new Error(errorMsg))
          }
        } else {
          // HTTP错误
          const errorMsg = `请求失败(${statusCode})`
          uni.showToast({ title: errorMsg, icon: 'none' })
          reject(new Error(errorMsg))
        }
      },
      fail: (error) => {
        // 网络错误
        const errorMsg = '网络请求失败'
        uni.showToast({ title: errorMsg, icon: 'none' })
        reject(error)
      }
    })
  })
}

/**
 * 上传文件
 * @param {Object} config 上传配置
 * @returns {Promise}
 */
const upload = (config) => {
  return new Promise((resolve, reject) => {
    const url = config.url.startsWith('http') ? config.url : BASE_URL + config.url

    uni.uploadFile({
      url,
      filePath: config.filePath,
      name: config.name || 'file',
      formData: config.formData,
      timeout: config.timeout || TIMEOUT,
      success: (response) => {
        const { statusCode, data } = response

        if (statusCode === 200 || statusCode === 201) {
          // 解析响应数据
          let result
          try {
            const rawData = typeof data === 'string' ? data : JSON.stringify(data)
            let jsonStr = rawData
            // 处理可能的编码问题
            if (/[\u00C0-\u00FF][\u0080-\u00BF]/.test(jsonStr)) {
              try {
                jsonStr = decodeURIComponent(escape(jsonStr))
              } catch (_) {}
            }
            result = JSON.parse(jsonStr)
          } catch (e) {
            reject(new Error('数据解析失败'))
            return
          }

          if (result.code === 0) {
            resolve(result)
          } else {
            uni.showToast({ title: result.message || '上传失败', icon: 'none' })
            reject(new Error(result.message || '上传失败'))
          }
        } else {
          uni.showToast({ title: '上传失败', icon: 'none' })
          reject(new Error('上传失败'))
        }
      },
      fail: (error) => {
        uni.showToast({ title: '上传失败', icon: 'none' })
        reject(error)
      }
    })
  })
}

/**
 * 下载文件
 * @param {string} url 下载地址
 * @param {function} onProgress 进度回调函数 => void
 * @returns {Promise<string>} 临时文件路径
 */
const download = (url, onProgress) => {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : BASE_URL + url

    const downloadTask = uni.downloadFile({
      url: fullUrl,
      timeout: DOWNLOAD_TIMEOUT,
      success: (response) => {
        if (response.statusCode === 200) {
          resolve(response.tempFilePath)
        } else {
          uni.showToast({ title: '下载失败', icon: 'none' })
          reject(new Error('下载失败'))
        }
      },
      fail: (error) => {
        // 更详细的错误提示
        let errorMsg = '下载失败'
        if (error.errMsg?.includes('timeout')) {
          errorMsg = '下载超时，请检查网络后重试'
        } else if (error.errMsg?.includes('network')) {
          errorMsg = '网络错误，请检查网络连接'
        }
        uni.showToast({ title: errorMsg, icon: 'none' })
        reject(error)
      }
    })

    // 注册进度回调
    if (onProgress && typeof onProgress === 'function') {
      downloadTask.onProgressUpdate((res) => {
        onProgress(res.progress)
      })
    }
  })
}

// 导出请求方法
export default {
  // GET请求
  get: (url, params, config = {}) => {
    return request({
      url,
      method: 'GET',
      data: params,
      ...config
    })
  },

  // POST请求
  post: (url, data, config = {}) => {
    return request({
      url,
      method: 'POST',
      data,
      ...config
    })
  },

  // PUT请求
  put: (url, data, config = {}) => {
    return request({
      url,
      method: 'PUT',
      data,
      ...config
    })
  },

  // DELETE请求
  delete: (url, data, config = {}) => {
    return request({
      url,
      method: 'DELETE',
      data,
      ...config
    })
  },

  // 上传文件
  upload,

  // 下载文件
  download,

  // 获取完整URL
  getFullUrl: (path) => {
    return BASE_URL + path
  }
}
