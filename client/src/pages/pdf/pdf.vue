<template>
  <view class="container">
    <!-- 上传区域 -->
    <view class="upload-section">
      <view class="section-title">选择PDF文件</view>
      <view class="upload-box" @click="showChooseOptions">
        <view class="upload-icon">+</view>
        <view class="upload-text">{{ fileName || '点击选择PDF文件' }}</view>
      </view>
      <button class="btn-convert" @click="handleConvertPdf" :disabled="loading || !file">
        {{ loading ? '转换中...' : '开始转换' }}
      </button>
    </view>

    <!-- 图片预览区域 -->
    <view class="preview-section" v-if="images.length > 0">
      <view class="section-title">转换结果 (共{{ pageCount }}页)</view>
      <scroll-view scroll-x class="image-scroll">
        <view class="image-list">
          <view
            class="image-item"
            v-for="(img, index) in images"
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
          <view class="btn-progress-bg" :style="{ width: (savingIndex / savingTotal * 100) + '%' }"></view>
          <text class="btn-text">{{ saving ? `保存中 ${savingIndex}/${savingTotal}` : '保存全部图片' }}</text>
        </view>
      </view>
    </view>

    <!-- 使用说明 -->
    <view class="tips-section">
      <view class="section-title">使用说明</view>
      <view class="tips-list">
        <view class="tip-item">1. 点击上方区域选择PDF文件来源</view>
        <view class="tip-item">2. 从聊天记录选择：选择微信聊天中的PDF文件</view>
        <view class="tip-item">3. 从本地选择：选择手机本地存储的PDF文件</view>
        <view class="tip-item">4. 等待转换完成后预览图片</view>
        <view class="tip-item">5. 点击图片可放大查看，支持保存全部图片</view>
        <view class="tip-item tip-notice">文件大小限制20MB，转换时间取决于页数</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import { convertPdf as convertPdfApi, getPdfImageUrl } from '@/api/pdf';
import request from '@/utils/request';

const file = ref(null);
const fileName = ref('');
const loading = ref(false);
const saving = ref(false);
const savingIndex = ref(0);
const savingTotal = ref(0);
const images = ref([]);
const pageCount = ref(0);

onShareAppMessage(() => ({
  title: 'PDF转图片 - 小程序工具箱',
  path: '/pages/pdf/pdf',
  imageUrl: '/static/share.png'
}));

onShareTimeline(() => ({
  title: 'PDF转图片 - 小程序工具箱',
  query: '',
  imageUrl: '/static/share.png'
}));

const choosePdf = () => {
  // #ifdef MP-WEIXIN
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['pdf'],
    success: (res) => {
      const tempFile = res.tempFiles[0];
      file.value = tempFile;
      fileName.value = tempFile.name;
    },
    fail: () => {
      uni.showToast({ title: '选择文件失败', icon: 'none' });
    }
  });
  // #endif
  // #ifndef MP-WEIXIN
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,application/pdf';
  input.onchange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      file.value = selectedFile;
      fileName.value = selectedFile.name;
    }
  };
  input.click();
  // #endif
};

// 显示选择方式弹窗
const showChooseOptions = () => {
  // #ifdef MP-WEIXIN
  uni.showActionSheet({
    itemList: ['从聊天记录选择', '从本地文件选择'],
    success: (res) => {
      if (res.tapIndex === 0) {
        chooseFromChat();
      } else if (res.tapIndex === 1) {
        chooseFromLocal();
      }
    }
  });
  // #endif
  // #ifndef MP-WEIXIN
  choosePdf();
  // #endif
};

// 从聊天记录选择文件
const chooseFromChat = () => {
  // #ifdef MP-WEIXIN
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['pdf'],
    success: (res) => {
      const tempFile = res.tempFiles[0];
      file.value = tempFile;
      fileName.value = tempFile.name;
    },
    fail: () => {
      uni.showToast({ title: '选择文件失败', icon: 'none' });
    }
  });
  // #endif
};

// 从本地文件选择
const chooseFromLocal = () => {
  // #ifdef MP-WEIXIN
  uni.showModal({
    title: '提示',
    content: '微信小程序暂不支持直接选择本地文件，请先将PDF文件发送到微信聊天中，然后从聊天记录选择',
    showCancel: false
  });
  // #endif
};

const handleConvertPdf = async () => {
  if (!file.value) {
    uni.showToast({ title: '请先选择PDF文件', icon: 'none' });
    return;
  }

  loading.value = true;
  images.value = [];

  try {
    // #ifdef MP-WEIXIN
    const res = await convertPdfApi(file.value.path);
    // 拼接完整图片URL
    images.value = res.data.images.map((img) => request.getFullUrl(img));
    pageCount.value = res.data.pageCount;
    uni.showToast({ title: `转换成功，共${res.data.pageCount}页`, icon: 'success' });
    // #endif

    // #ifndef MP-WEIXIN
    const formData = new FormData();
    formData.append('file', file.value);
    const res = await fetch(request.getFullUrl('/pdf/convert'), {
      method: 'POST',
      body: formData,
    }).then(r => r.json());

    if (res.code === 0) {
      images.value = res.data.images.map((img) => request.getFullUrl(img));
      pageCount.value = res.data.pageCount;
      uni.showToast({ title: `转换成功，共${res.data.pageCount}页`, icon: 'success' });
    } else {
      uni.showToast({ title: '转换失败', icon: 'none' });
    }
    // #endif
  } catch (e) {
    console.error('转换失败:', e);
  } finally {
    loading.value = false;
  }
};

const previewImage = (index) => {
  uni.previewImage({
    urls: images.value,
    current: index
  });
};

const saveAllImages = async () => {
  // 防抖：如果正在保存则直接返回
  if (saving.value) return;

  saving.value = true;
  savingTotal.value = images.value.length;
  savingIndex.value = 0;
  let saved = 0;

  for (let i = 0; i < images.value.length; i++) {
    savingIndex.value = i + 1;
    try {
      const tempFilePath = await request.download(images.value[i]);

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

.upload-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
}

.upload-box {
  border: 2rpx dashed #ddd;
  border-radius: 12rpx;
  padding: 60rpx;
  text-align: center;
  margin-bottom: 20rpx;
}

.upload-icon {
  font-size: 60rpx;
  color: #ccc;
  line-height: 1;
}

.upload-text {
  font-size: 26rpx;
  color: #999;
  margin-top: 16rpx;
}

.btn-convert {
  width: 100%;
  background-color: #07c160;
  color: #fff;
  border: none;
  border-radius: 8rpx;
  padding: 24rpx;
  font-size: 30rpx;
}

.btn-convert[disabled] {
  background-color: #ccc;
}

.preview-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
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

.btn-save {
  position: relative;
  width: 100%;
  text-align: center;
  border-radius: 8rpx;
  padding: 24rpx;
  font-size: 30rpx;
  box-sizing: border-box;
  background-color: #576b95;
  color: #fff;
  overflow: hidden;
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

.btn-save.disabled {
  opacity: 1;
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
</style>
