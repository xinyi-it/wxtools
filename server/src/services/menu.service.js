const Menu = require('../models/menu');

class MenuService {
  // 初始化默认菜单
  async initDefaultMenus() {
    const count = await Menu.countDocuments();
    if (count === 0) {
      const defaultMenus = [
        {
          name: '抖音去水印',
          desc: '解析抖音视频，无水印下载',
          icon: '🎬',
          path: '/pages/douyin/douyin',
          visible: true,
          sort: 1,
        },
        {
          name: '快手去水印',
          desc: '解析快手视频，无水印下载',
          icon: '🎥',
          path: '/pages/kuaishou/kuaishou',
          visible: true,
          sort: 2,
        },
        {
          name: '小红书下载',
          desc: '解析小红书视频/图文',
          icon: '📕',
          path: '/pages/xiaohongshu/xiaohongshu',
          visible: true,
          sort: 3,
        },
        {
          name: 'PDF转图片',
          desc: '将PDF文件转换为图片',
          icon: '📄',
          path: '/pages/pdf/pdf',
          visible: true,
          sort: 4,
        },
        {
          name: 'B站视频下载',
          desc: '解析B站视频，高清下载',
          icon: '📺',
          path: '/pages/bilibili/bilibili',
          visible: true,
          sort: 5,
        },
      ];

      try {
        await Menu.insertMany(defaultMenus, { ordered: false });
        console.log('[Menu] Default menus initialized');
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }
      }
    }
  }

  // 获取所有可见菜单
  async getVisibleMenus() {
    return Menu.find({ visible: true })
      .sort({ sort: 1 })
      .select('-__v')
      .exec();
  }

  // 获取所有菜单
  async getAllMenus() {
    return Menu.find()
      .sort({ sort: 1 })
      .select('-__v')
      .exec();
  }

  // 创建菜单
  async create(dto) {
    const menu = new Menu(dto);
    return menu.save();
  }

  // 更新菜单
  async update(id, dto) {
    return Menu.findByIdAndUpdate(
      id,
      { ...dto, updatedAt: new Date() },
      { new: true }
    ).exec();
  }

  // 删除菜单
  async delete(id) {
    const result = await Menu.findByIdAndDelete(id).exec();
    return !!result;
  }

  // 切换菜单显示状态
  async toggleVisible(id) {
    const menu = await Menu.findById(id).exec();
    if (!menu) return null;

    menu.visible = !menu.visible;
    menu.updatedAt = new Date();
    return menu.save();
  }

  // 清理重复菜单
  async cleanDuplicates() {
    const menus = await Menu.find().sort({ createdAt: 1 }).exec();
    const seen = new Map();
    const toDelete = [];

    for (const menu of menus) {
      const key = menu.path;
      if (seen.has(key)) {
        toDelete.push(menu._id.toString());
      } else {
        seen.set(key, menu._id.toString());
      }
    }

    if (toDelete.length > 0) {
      await Menu.deleteMany({ _id: { $in: toDelete } });
    }

    return { deleted: toDelete.length };
  }
}

module.exports = new MenuService();
