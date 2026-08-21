<script>
import { getBanner } from '@/api/banner';

export default {
  globalData: {
    banner: {
      content: '',
      visible: false,
      updatedAt: ''
    }
  },

  onLaunch() {
    console.log('App Launch');
    this.fetchBanner();
  },

  onShow() {
    console.log('App Show');
  },

  onHide() {
    console.log('App Hide');
  },

  methods: {
    async fetchBanner() {
      try {
        const res = await getBanner();
        this.globalData.banner = {
          content: res.data.content || '',
          visible: res.data.visible || false,
          updatedAt: res.data.updatedAt || ''
        };
      } catch (e) {
        console.error('获取横幅配置失败:', e);
      }
    }
  }
};
</script>

<style>
page {
  background-color: #f5f5f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}

.container {
  padding: 20rpx;
}

.btn-primary {
  background-color: #07c160;
  color: #fff;
  border: none;
  border-radius: 8rpx;
  padding: 20rpx 40rpx;
  font-size: 28rpx;
}

.btn-primary:active {
  background-color: #06ad56;
}
</style>
