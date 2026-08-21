const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema({
  name: { type: String, required: true },
  desc: { type: String, required: true },
  icon: { type: String, required: true },
  path: { type: String, required: true },
  visible: { type: Boolean, default: true },
  sort: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  collection: 'menus'
});

module.exports = mongoose.model('Menu', menuSchema);
