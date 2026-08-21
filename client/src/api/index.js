/**
 * API统一入口
 */
export * from './menu'
export * from './douyin'
export * from './kuaishou'
export * from './pdf'
export * from './banner'

// 默认导出request，方便直接使用
import request from '@/utils/request'
export default request
