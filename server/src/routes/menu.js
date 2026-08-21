const Router = require('@koa/router');
const menuService = require('../services/menu.service');
const { createMenuSchema, updateMenuSchema } = require('../utils/validator');

const router = new Router();

// 获取可见菜单列表
router.get('/list', async (ctx) => {
  const menus = await menuService.getVisibleMenus();
  ctx.success(menus);
});

// 获取所有菜单
router.get('/all', async (ctx) => {
  const menus = await menuService.getAllMenus();
  ctx.success(menus);
});

// 创建菜单
router.post('/', async (ctx) => {
  const { error, value } = createMenuSchema.validate(ctx.request.body);
  if (error) {
    ctx.status = 400;
    ctx.body = { code: 400, message: error.details[0].message, data: null };
    return;
  }

  const menu = await menuService.create(value);
  ctx.success(menu);
});

// 更新菜单
router.put('/:id', async (ctx) => {
  const { id } = ctx.params;
  const { error, value } = updateMenuSchema.validate(ctx.request.body);
  if (error) {
    ctx.status = 400;
    ctx.body = { code: 400, message: error.details[0].message, data: null };
    return;
  }

  const menu = await menuService.update(id, value);
  if (!menu) {
    ctx.status = 404;
    ctx.body = { code: 404, message: '菜单不存在', data: null };
    return;
  }

  ctx.success(menu);
});

// 切换菜单显示状态
router.put('/:id/toggle', async (ctx) => {
  const { id } = ctx.params;
  const menu = await menuService.toggleVisible(id);

  if (!menu) {
    ctx.status = 404;
    ctx.body = { code: 404, message: '菜单不存在', data: null };
    return;
  }

  ctx.success(menu);
});

// 删除菜单
router.delete('/:id', async (ctx) => {
  const { id } = ctx.params;
  const result = await menuService.delete(id);

  if (!result) {
    ctx.status = 404;
    ctx.body = { code: 404, message: '菜单不存在', data: null };
    return;
  }

  ctx.success({ deleted: true });
});

// 清理重复菜单
router.delete('/clean/duplicates', async (ctx) => {
  const result = await menuService.cleanDuplicates();
  ctx.success(result);
});

module.exports = router;
