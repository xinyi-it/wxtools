const Banner = require('../models/banner');

class BannerService {
  /**
   * 获取横幅配置（单例模式，全局只有一条记录）
   */
  async getBanner() {
    let banner = await Banner.findOne().exec();
    // 如果不存在，创建默认横幅
    if (!banner) {
      banner = new Banner({ content: '', visible: false });
      await banner.save();
    }
    return banner;
  }

  /**
   * 更新横幅内容（自动更新 updatedAt）
   */
  async updateBanner(dto) {
    let banner = await Banner.findOne().exec();
    if (!banner) {
      banner = new Banner({
        content: dto.content || '',
        visible: dto.visible !== undefined ? dto.visible : false
      });
    } else {
      banner.content = dto.content !== undefined ? dto.content : banner.content;
      banner.visible = dto.visible !== undefined ? dto.visible : banner.visible;
      banner.updatedAt = new Date();
    }
    return banner.save();
  }

  /**
   * 切换显示状态
   */
  async toggleVisible() {
    const banner = await Banner.findOne().exec();
    if (!banner) return null;

    banner.visible = !banner.visible;
    banner.updatedAt = new Date();
    return banner.save();
  }
}

module.exports = new BannerService();
