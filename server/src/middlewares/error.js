// 错误处理中间件
module.exports = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status = err.status || 500;
    ctx.body = {
      code: err.status || 500,
      message: err.message || '服务器内部错误',
      data: null
    };
    console.error('Error:', err.message);
  }
};
