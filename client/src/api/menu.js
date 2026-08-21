/**
 * 菜单相关API
 */
import request from '@/utils/request'

/**
 * 获取可见菜单列表
 */
export function getMenuList() {
  return request.get('/menu/list')
}

/**
 * 获取所有菜单（管理用）
 */
export function getAllMenus() {
  return request.get('/menu/all')
}

/**
 * 创建菜单
 * @param {Object} data 菜单数据
 */
export function createMenu(data) {
  return request.post('/menu', data)
}

/**
 * 更新菜单
 * @param {string} id 菜单ID
 * @param {Object} data 菜单数据
 */
export function updateMenu(id, data) {
  return request.put(`/menu/${id}`, data)
}

/**
 * 切换菜单显示状态
 * @param {string} id 菜单ID
 */
export function toggleMenuVisible(id) {
  return request.put(`/menu/${id}/toggle`)
}

/**
 * 删除菜单
 * @param {string} id 菜单ID
 */
export function deleteMenu(id) {
  return request.delete(`/menu/${id}`)
}
