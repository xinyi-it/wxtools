/**
 * 横幅公告 API
 */
import request from '@/utils/request';

/**
 * 获取横幅配置
 */
export const getBanner = () => request.get('/banner');
