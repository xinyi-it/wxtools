<template>
  <view class="page-wrapper">
    <!-- 横幅公告 -->
    <BannerNotice
      :content="bannerData.content"
      :visible="bannerData.visible"
      :updated-at="bannerData.updatedAt"
    />
    <view class="container">
      <!-- 骨架屏 -->
      <view class="skeleton-list" v-if="loading">
        <view class="skeleton-item" v-for="i in 3" :key="i">
          <view class="skeleton-icon"></view>
          <view class="skeleton-info">
            <view class="skeleton-name"></view>
            <view class="skeleton-desc"></view>
          </view>
        </view>
      </view>
      <!-- 实际内容 -->
      <view class="tool-list" v-else>
        <view class="tool-item" v-for="item in tools" :key="item._id" @click="navigateTo(item.path)">
          <view class="tool-icon">{{ item.icon }}</view>
          <view class="tool-info">
            <view class="tool-name">{{ item.name }}</view>
            <view class="tool-desc">{{ item.desc }}</view>
          </view>
          <view class="tool-arrow">›</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { onShareAppMessage, onShareTimeline, onPullDownRefresh } from '@dcloudio/uni-app';
import { getMenuList } from '@/api/menu';
import BannerNotice from '@/components/banner-notice/banner-notice.vue';

const tools = ref([]);
const loading = ref(true);
const bannerData = ref({
  content: '',
  visible: false,
  updatedAt: ''
});

// 获取菜单列表
const fetchMenus = async () => {
  loading.value = true;
  try {
    const res = await getMenuList();
    tools.value = res.data;
  } catch (e) {
    console.error('获取菜单失败:', e);
  } finally {
    loading.value = false;
  }
};

// 获取横幅配置
const fetchBanner = () => {
  const app = getApp();
  if (app && app.globalData && app.globalData.banner) {
    bannerData.value = app.globalData.banner;
  }
};

onMounted(() => {
  fetchMenus();
  fetchBanner();
});

// 下拉刷新
onPullDownRefresh(async () => {
  await fetchMenus();
  fetchBanner();
  uni.stopPullDownRefresh();
});

const navigateTo = (path) => {
  uni.navigateTo({ url: path });
};

// 分享给朋友
onShareAppMessage(() => {
  return {
    title: '小程序工具箱 - 视频去水印、PDF转换',
    path: '/pages/index/index',
    imageUrl: '/static/share.png'
  };
});

// 分享到朋友圈
onShareTimeline(() => {
  return {
    title: '小程序工具箱 - 视频去水印、PDF转换',
    query: '',
    imageUrl: '/static/share.png'
  };
});
</script>

<style scoped>
.tool-list {
  padding: 20rpx;
}

.tool-item {
  display: flex;
  align-items: center;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.tool-icon {
  width: 80rpx;
  height: 80rpx;
  background-color: #f0f0f0;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  margin-right: 24rpx;
}

.tool-info {
  flex: 1;
}

.tool-name {
  font-size: 32rpx;
  font-weight: 500;
  color: #333;
  margin-bottom: 8rpx;
}

.tool-desc {
  font-size: 24rpx;
  color: #999;
}

.tool-arrow {
  font-size: 36rpx;
  color: #ccc;
}

/* 骨架屏样式 */
.skeleton-list {
  padding: 20rpx;
}

.skeleton-item {
  display: flex;
  align-items: center;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.skeleton-icon {
  width: 80rpx;
  height: 80rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 16rpx;
  margin-right: 24rpx;
  animation: skeleton-loading 1.5s infinite;
}

.skeleton-info {
  flex: 1;
}

.skeleton-name {
  width: 160rpx;
  height: 32rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 8rpx;
  margin-bottom: 16rpx;
  animation: skeleton-loading 1.5s infinite;
}

.skeleton-desc {
  width: 240rpx;
  height: 24rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 8rpx;
  animation: skeleton-loading 1.5s infinite;
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
