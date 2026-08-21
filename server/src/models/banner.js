const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  content: { type: String, default: '' },                       // 滚动内容
  visible: { type: Boolean, default: false },                   // 是否显示，默认不显示
  updatedAt: { type: Date, default: Date.now }                  // 更新时间戳（用于差异对比）
}, {
  collection: 'banner'
});

module.exports = mongoose.model('Banner', bannerSchema);
