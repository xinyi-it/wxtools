<template>
  <view class="container">
    <!-- 输入区域 -->
    <view class="input-section">
      <view class="section-title">粘贴抖音分享链接</view>
      <textarea
        v-model="shareUrl"
        class="url-input"
        placeholder="请粘贴抖音分享链接，如：https://v.douyin.com/xxx/"
        :maxlength="500"
      />
      <view class="btn-group">
        <button class="btn-paste" @click="pasteFromClipboard">粘贴</button>
        <button class="btn-parse" @click="parseUrl" :disabled="loading">
          {{ loading ? '解析中...' : '解析' }}
        </button>
      </view>
    </view>

    <!-- 视频预览区域 -->
    <view class="preview-section" v-if="videoInfo">
      <view class="section-header">
        <view class="section-title">{{ videoInfo.type === 'images' ? '图文预览' : '视频预览' }}</view>
        <view class="copy-btn" @click="copyText">复制文字</view>
      </view>
      <view class="video-card">
        <image class="video-cover" :src="videoInfo.cover" mode="aspectFill" />
        <view class="video-info">
          <view class="video-title">{{ videoInfo.title }}</view>
          <view class="video-author">@{{ videoInfo.author }}</view>
        </view>
      </view>

      <!-- 图文类型：显示图片列表 -->
      <view v-if="videoInfo.type === 'images'" class="images-section">
        <view class="images-count">共 {{ videoInfo.images?.length || 0 }} 张图片</view>
        <scroll-view scroll-x class="image-scroll">
          <view class="image-list">
            <view
              class="image-item"
              v-for="(img, index) in videoInfo.images"
              :key="index"
              @click="previewImage(index)"
            >
              <image class="preview-img" :src="img" mode="aspectFit" />
              <view class="page-num">{{ index + 1 }}</view>
            </view>
          </view>
        </scroll-view>
        <view class="btn-wrapper" @click="saveAllImages">
          <view class="btn-save" :class="{ disabled: saving }">
            <view class="btn-progress-bg save-progress" :style="{ width: (savingIndex / savingTotal * 100) + '%' }"></view>
            <text class="btn-text">{{ saving ? `保存中 ${savingIndex}/${savingTotal}` : '保存全部图片' }}</text>
          </view>
        </view>
      </view>

      <!-- 视频类型：显示视频播放器 -->
      <view v-else>
        <video
          class="video-player"
          :src="proxyVideoUrl"
          :poster="videoInfo.cover"
          controls
          :show-center-play-btn="true"
          object-fit="contain"
        />

        <!-- 操作按钮 -->
        <view class="action-btns">
          <view class="btn-wrapper" @click="downloadVideo">
            <view class="btn-download" :class="{ disabled: downloading }">
              <view class="btn-progress-bg" :style="{ width: downloadProgress + '%' }"></view>
              <text class="btn-text">{{ downloading ? `下载中 ${downloadProgress}%` : '保存到相册' }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 使用说明 -->
    <view class="tips-section">
      <view class="section-title">使用说明</view>
      <view class="tips-list">
        <view class="tip-item">1. 打开抖音APP，找到要下载的视频</view>
        <view class="tip-item">2. 点击分享按钮，选择"分享链接"</view>
        <view class="tip-item">3. 返回本小程序，粘贴链接并解析</view>
        <view class="tip-item">4. 预览视频后点击保存到相册</view>
        <view class="tip-item tip-notice">视频归平台及作者所有，本应用不存储任何视频及图片</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import { parseDouyinUrl, getDouyinDownloadUrl } from '@/api/douyin';
import request from '@/utils/request';

const shareUrl = ref('');
const loading = ref(false);
const downloading = ref(false);
const downloadProgress = ref(0);
const saving = ref(false);
const savingIndex = ref(0);
const savingTotal = ref(0);
const videoInfo = ref(null);

// 分享给朋友
onShareAppMessage(() => {
  return {
    title: '抖音视频去水印下载 - 小程序工具箱',
    path: '/pages/douyin/douyin',
    imageUrl: '/static/share.png'
  };
});

// 分享到朋友圈
onShareTimeline(() => {
  return {
    title: '抖音视频去水印下载 - 小程序工具箱',
    query: '',
    imageUrl: '/static/share.png'
  };
});

// 代理视频URL（通过后端代理访问，解决防盗链问题）
const proxyVideoUrl = computed(() => {
  if (!videoInfo.value?.videoUrl) return '';
  return getDouyinDownloadUrl(videoInfo.value.videoUrl);
});

// 从剪贴板粘贴
const pasteFromClipboard = () => {
  uni.getClipboardData({
    success: (res) => {
      shareUrl.value = res.data;
      uni.showToast({ title: '已粘贴', icon: 'success' });
    },
    fail: () => {
      uni.showToast({ title: '粘贴失败', icon: 'none' });
    },
  });
};

// 复制文案
const copyText = () => {
  if (!videoInfo.value?.title) {
    uni.showToast({ title: '没有可复制的文案', icon: 'none' });
    return;
  }

  uni.setClipboardData({
    data: videoInfo.value.title,
    success: () => {
      uni.showToast({ title: '已复制', icon: 'success' });
    },
    fail: () => {
      uni.showToast({ title: '复制失败', icon: 'none' });
    }
  });
};

// 解析链接
const parseUrl = async () => {
  if (!shareUrl.value.trim()) {
    uni.showToast({ title: '请输入链接', icon: 'none' });
    return;
  }

  loading.value = true;

  try {
    const res = await parseDouyinUrl(shareUrl.value.trim());
    videoInfo.value = res.data;
    uni.showToast({ title: '解析成功', icon: 'success' });
  } catch (e) {
    console.error('解析失败:', e);
  } finally {
    loading.value = false;
  }
};

// 下载视频到相册
const downloadVideo = async () => {
  // 防抖：如果正在下载则直接返回
  if (downloading.value) return;

  if (!videoInfo.value?.videoUrl) {
    uni.showToast({ title: '没有可下载的视频', icon: 'none' });
    return;
  }

  downloading.value = true;
  downloadProgress.value = 0;

  try {
    const tempFilePath = await request.download(
      getDouyinDownloadUrl(videoInfo.value.videoUrl),
      (progress) => {
        downloadProgress.value = progress;
      }
    );

    await new Promise((resolve, reject) => {
      uni.saveVideoToPhotosAlbum({
        filePath: tempFilePath,
        success: () => {
          uni.showToast({ title: '已保存到相册', icon: 'success' });
          resolve();
        },
        fail: (err) => {
          if (err.errMsg?.includes('auth deny')) {
            uni.showModal({
              title: '提示',
              content: '需要授权保存到相册权限',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  uni.openSetting();
                }
              },
            });
          } else {
            uni.showToast({ title: '保存失败', icon: 'none' });
          }
          reject(err);
        }
      });
    });
  } catch (e) {
    console.error('下载失败:', e);
  } finally {
    downloading.value = false;
    downloadProgress.value = 0;
  }
};

// 预览图片
const previewImage = (index) => {
  if (!videoInfo.value?.images) return;
  uni.previewImage({
    urls: videoInfo.value.images,
    current: index
  });
};

// 保存全部图片到相册
const saveAllImages = async () => {
  // 防抖：如果正在保存则直接返回
  if (saving.value) return;

  if (!videoInfo.value?.images || videoInfo.value.images.length === 0) {
    uni.showToast({ title: '没有可保存的图片', icon: 'none' });
    return;
  }

  saving.value = true;
  savingTotal.value = videoInfo.value.images.length;
  savingIndex.value = 0;
  let saved = 0;

  for (let i = 0; i < videoInfo.value.images.length; i++) {
    savingIndex.value = i + 1;
    try {
      // 使用后端代理下载图片，解决防盗链问题
      const tempFilePath = await request.download(
        getDouyinDownloadUrl(videoInfo.value.images[i])
      );

      await new Promise((resolve, reject) => {
        uni.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => {
            saved++;
            resolve();
          },
          fail: (err) => {
            if (err.errMsg?.includes('auth deny')) {
              uni.showModal({
                title: '提示',
                content: '需要授权保存到相册权限',
                success: (modalRes) => {
                  if (modalRes.confirm) {
                    uni.openSetting();
                  }
                }
              });
            }
            reject(err);
          }
        });
      });
    } catch (e) {
      console.error('保存失败:', e);
    }
  }

  saving.value = false;
  savingIndex.value = 0;
  if (saved > 0) {
    uni.showToast({ title: `已保存${saved}张图片`, icon: 'success' });
  }
};
</script>

<style scoped>
.container {
  padding: 20rpx;
  background-color: #f5f5f5;
  min-height: 100vh;
}

.section-title {
  font-size: 28rpx;
  font-weight: 500;
  color: #333;
  margin-bottom: 20rpx;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.section-header .section-title {
  margin-bottom: 0;
}

.copy-btn {
  font-size: 26rpx;
  color: #07c160;
  padding: 8rpx 16rpx;
}

.input-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
}

.url-input {
  width: 100%;
  height: 200rpx;
  background-color: #f8f8f8;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}

.btn-group {
  display: flex;
  gap: 20rpx;
  margin-top: 20rpx;
}

.btn-paste {
  flex: 1;
  background-color: #f0f0f0;
  color: #333;
  border: none;
  border-radius: 8rpx;
  padding: 20rpx;
  font-size: 28rpx;
}

.btn-parse {
  flex: 2;
  background-color: #07c160;
  color: #fff;
  border: none;
  border-radius: 8rpx;
  padding: 20rpx;
  font-size: 28rpx;
}

.btn-parse[disabled] {
  background-color: #ccc;
}

.preview-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
}

.video-card {
  display: flex;
  margin-bottom: 20rpx;
}

.video-cover {
  width: 200rpx;
  height: 280rpx;
  border-radius: 12rpx;
  margin-right: 20rpx;
}

.video-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.video-title {
  font-size: 28rpx;
  color: #333;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.video-author {
  font-size: 24rpx;
  color: #999;
  margin-top: 10rpx;
}

.video-player {
  width: 100%;
  height: 400rpx;
  border-radius: 12rpx;
  margin-bottom: 20rpx;
}

.action-btns {
  display: flex;
  justify-content: center;
}

.btn-download {
  width: 80%;
  background-color: #07c160;
  color: #fff;
  border: none;
  border-radius: 8rpx;
  padding: 24rpx;
  font-size: 30rpx;
}

.btn-download[disabled] {
  background-color: #ccc;
}

.tips-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
}

.tips-list {
  padding-left: 20rpx;
}

.tip-item {
  font-size: 24rpx;
  color: #666;
  line-height: 2;
}

.tip-notice {
  color: #999;
  font-size: 22rpx;
  margin-top: 10rpx;
}

.images-section {
  margin-top: 20rpx;
}

.images-count {
  font-size: 24rpx;
  color: #666;
  margin-bottom: 16rpx;
}

.image-scroll {
  white-space: nowrap;
  margin-bottom: 20rpx;
}

.image-list {
  display: inline-flex;
  gap: 16rpx;
}

.image-item {
  position: relative;
  width: 200rpx;
  height: 280rpx;
  flex-shrink: 0;
}

.preview-img {
  width: 100%;
  height: 100%;
  border-radius: 12rpx;
  background-color: #f5f5f5;
}

.page-num {
  position: absolute;
  bottom: 10rpx;
  right: 10rpx;
  background-color: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 20rpx;
}

.btn-save {
  width: 100%;
  background-color: #576b95;
  color: #fff;
  border: none;
  border-radius: 8rpx;
  padding: 24rpx;
  font-size: 30rpx;
}

.btn-save[disabled] {
  background-color: #ccc;
}

/* 进度条按钮样式 */
.btn-wrapper {
  width: 100%;
  border-radius: 8rpx;
  overflow: hidden;
}

.action-btns .btn-wrapper {
  width: 80%;
}

.btn-download, .btn-save {
  position: relative;
  width: 100%;
  text-align: center;
  border-radius: 8rpx;
  padding: 24rpx;
  font-size: 30rpx;
  box-sizing: border-box;
  overflow: hidden;
}

.btn-download {
  background-color: #07c160;
  color: #fff;
}

.btn-save {
  background-color: #576b95;
  color: #fff;
}

.btn-text {
  position: relative;
  z-index: 2;
}

.btn-progress-bg {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.25);
  transition: width 0.15s ease;
  z-index: 1;
}

.btn-download.disabled, .btn-save.disabled {
  opacity: 1;
}
</style>
