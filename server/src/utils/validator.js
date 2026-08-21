const Joi = require('joi');

// 抖音解析验证
const parseDouyinUrlSchema = Joi.object({
  url: Joi.string().required().messages({
    'string.empty': '请输入抖音分享链接',
    'any.required': '请输入抖音分享链接'
  })
});

// 快手解析验证
const parseKuaishouUrlSchema = Joi.object({
  url: Joi.string().required().messages({
    'string.empty': '请输入快手分享链接',
    'any.required': '请输入快手分享链接'
  })
});

// PDF转换验证
const convertPdfSchema = Joi.object({
  width: Joi.number().integer().min(1).max(300).optional(),
  height: Joi.number().integer().min(1).max(300).optional()
});

// 菜单验证
const createMenuSchema = Joi.object({
  name: Joi.string().required(),
  desc: Joi.string().required(),
  icon: Joi.string().required(),
  path: Joi.string().required(),
  visible: Joi.boolean().optional(),
  sort: Joi.number().optional()
});

const updateMenuSchema = Joi.object({
  name: Joi.string().optional(),
  desc: Joi.string().optional(),
  icon: Joi.string().optional(),
  path: Joi.string().optional(),
  visible: Joi.boolean().optional(),
  sort: Joi.number().optional()
});

module.exports = {
  parseDouyinUrlSchema,
  parseKuaishouUrlSchema,
  convertPdfSchema,
  createMenuSchema,
  updateMenuSchema
};
