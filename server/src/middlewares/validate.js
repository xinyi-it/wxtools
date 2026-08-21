const Joi = require('joi');

// 参数验证中间件工厂函数
const validate = (schema, source = 'body') => {
  return async (ctx, next) => {
    const data = source === 'query' ? ctx.query : source === 'params' ? ctx.params : ctx.request.body;

    const { error, value } = schema.validate(data, { allowUnknown: true });

    if (error) {
      ctx.status = 400;
      ctx.body = {
        code: 400,
        message: error.details[0].message,
        data: null
      };
      return;
    }

    // 将验证后的值附加到上下文
    ctx.validatedData = value;
    await next();
  };
};

module.exports = validate;
