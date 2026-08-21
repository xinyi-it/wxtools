// 统一响应格式中间件
module.exports = async (ctx, next) => {
  ctx.success = (data, message = '获取成功') => {
    ctx.body = {
      code: 0,
      message,
      data
    };
  };

  ctx.fail = (message, code = 400) => {
    ctx.status = code;
    ctx.body = {
      code,
      message,
      data: null
    };
  };

  await next();
};
