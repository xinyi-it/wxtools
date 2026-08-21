<template>
  <view class="banner-notice" v-if="shouldShow">
    <view class="banner-icon">
      <text class="icon-horn">📢</text>
    </view>
    <view class="banner-content">
      <view class="scroll-wrapper">
        <text class="scroll-text" :key="content">{{ content }}</text>
      </view>
    </view>
    <view class="banner-close" @click="handleClose">
      <text class="close-icon">×</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  content: {
    type: String,
    default: ''
  },
  visible: {
    type: Boolean,
    default: false
  },
  updatedAt: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['close']);

// 本地存储 key
const STORAGE_KEY = 'banner_closed_at';

// 本地关闭状态
const localClosed = ref(false);

// 是否应该显示
const shouldShow = computed(() => {
  // 如果本地已关闭，不显示
  if (localClosed.value) return false;

  // 如果后端设置为不显示，则不显示
  if (!props.visible) return false;

  // 如果没有内容，不显示
  if (!props.content) return false;

  // 如果没有 updatedAt，直接显示
  if (!props.updatedAt) return true;

  // 读取本地存储的关闭时间戳
  const closedAt = uni.getStorageSync(STORAGE_KEY);
  if (!closedAt) return true;

  // 对比时间戳，如果公告更新时间晚于关闭时间，则显示
  return new Date(props.updatedAt).getTime() > new Date(closedAt).getTime();
});

// 处理关闭
const handleClose = () => {
  // 设置本地关闭状态
  localClosed.value = true;

  // 将当前 updatedAt 存入本地存储
  if (props.updatedAt) {
    uni.setStorageSync(STORAGE_KEY, props.updatedAt);
  }
  emit('close');
};
</script>

<style scoped>
.banner-notice {
  display: flex;
  align-items: center;
  background-color: #FFF3E0;
  padding: 16rpx 20rpx;
  position: relative;
  overflow: hidden;
}

.banner-icon {
  margin-right: 12rpx;
  display: flex;
  align-items: center;
}

.icon-horn {
  font-size: 28rpx;
  transform: scaleX(-1);
}

.banner-content {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
}

.scroll-wrapper {
  display: inline-block;
  animation: scroll 10s linear infinite;
  padding-right: 100rpx;
}

.scroll-text {
  font-size: 26rpx;
  color: #E65100;
  white-space: nowrap;
}

.banner-close {
  padding: 0 16rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 16rpx;
}

.close-icon {
  font-size: 36rpx;
  color: #E65100;
  line-height: 1;
}

@keyframes scroll {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-50%);
  }
}
</style>
