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
        <view class="images-count">
          {{ imagesCountText }}
        </view>
        <scroll-view scroll-x class="image-scroll">
          <view class="image-list">
            <view
              class="image-item"
              v-for="(item, index) in imageItems"
              :key="index"
              @click="previewImage(index)"
            >
              <!-- 动图：静帧当封面，点击进全屏看动态 -->
              <image class="preview-img" :src="item.thumb" mode="aspectFit" />
              <view class="page-num">{{ index + 1 }}</view>
              <view v-if="item.live" class="live-badge">动图</view>
              <view v-if="item.live" class="live-play">
                <text class="live-play-icon">▶</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <!-- 动图全屏播放：一次播一张，播完/关闭回列表 -->
        <view v-if="activeLive" class="live-player-mask" @click="closeLivePlayer">
          <view class="live-player-box" @click.stop>
            <video
              class="live-player"
              :src="activeLive.proxyUrl"
              :autoplay="true"
              :controls="true"
              :loop="true"
              :show-center-play-btn="false"
              object-fit="contain"
            />
            <view class="live-player-bar">
              <text class="live-player-label">
                动图 {{ activeLive.index + 1 }}/{{ imageItems.length }}
                （{{ activeLive.duration }}秒）
              </text>
              <text class="live-player-close" @click="closeLivePlayer">关闭</text>
            </view>
          </view>
        </view>

        <view class="btn-wrapper" @click="saveAllImages">
          <view class="btn-save" :class="{ disabled: saving }">
            <view class="btn-progress-bg save-progress" :style="{ width: (savingIndex / savingTotal * 100) + '%' }"></view>
            <text class="btn-text">{{ saveBtnText }}</text>
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
import { parseDouyinUrl, queryDouyinTask, getDouyinDownloadUrl } from '@/api/douyin';
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

// ---------- 图文 / 动图合集 ----------
//
// 抖音的「图文」有两种：
//   1. 纯图文：每张就是一张静态图
//   2. 动图合集（实况照片）：每张自带一个 1.5~2.8 秒的小视频，
//      后端在 imagesDetail 里用 live + videoUrl 标出来
//
// 所以列表项要按 imagesDetail 组装，不能只读 images —— 只读 images 会把
// 动图全部降级成静态图，用户就看不到动态部分。
const activeLive = ref(null);

const imageItems = computed(() => {
  const info = videoInfo.value;
  if (!info) return [];
  const detail = Array.isArray(info.imagesDetail) ? info.imagesDetail : [];
  const flat = Array.isArray(info.images) ? info.images : [];

  // 后端没给 imagesDetail（旧数据 / 纯图文）时，退回纯图片列表
  if (!detail.length) {
    return flat.map((url) => ({ thumb: url, live: false, videoUrl: '', duration: 0 }));
  }

  return detail.map((it, i) => ({
    thumb: it.url || flat[i] || '',
    live: !!it.live,
    videoUrl: it.videoUrl || '',
    duration: it.duration ? Math.round(it.duration * 10) / 10 : 0,
  }));
});

const imagesCountText = computed(() => {
  const info = videoInfo.value;
  if (!info) return '';
  const total = imageItems.value.length;
  const liveCount = imageItems.value.filter((x) => x.live).length;
  if (liveCount > 0) {
    return `共 ${total} 项（${liveCount} 个动图 + ${total - liveCount} 张图片）`;
  }
  return `共 ${total} 张图片`;
});

const saveBtnText = computed(() => {
  if (saving.value) return `保存中 ${savingIndex.value}/${savingTotal.value}`;
  const liveCount = imageItems.value.filter((x) => x.live).length;
  return liveCount > 0 ? '保存全部（动图存为视频）' : '保存全部图片';
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
//
// 走异步流程：提交任务拿 taskId → 轮询取结果。
// 解析要几十秒，公网经过 Cloudflare 代理会被 100 秒超时掐断，
// 同步接口在公网拿不到结果，只能这么来。
const POLL_INTERVAL = 3000;   // 轮询间隔 3 秒
const POLL_MAX_WAIT = 180000; // 最多等 3 分钟

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseUrl = async () => {
  if (!shareUrl.value.trim()) {
    uni.showToast({ title: '请输入链接', icon: 'none' });
    return;
  }

  loading.value = true;
  // 立刻清掉上一条结果：否则解析失败或超时时，界面上还挂着上一个视频，
  // 看着就像「换了链接还是上一个视频」。
  videoInfo.value = null;

  try {
    // 1. 提交任务，秒回 taskId
    const submitRes = await parseDouyinUrl(shareUrl.value.trim());
    const task = submitRes?.data || {};

    // 命中缓存：后端直接给了终态，不用轮询
    if (task.status === 'done' && task.data) {
      videoInfo.value = task.data;
      uni.showToast({ title: '解析成功', icon: 'success' });
      return;
    }

    if (!task.taskId) {
      throw new Error('提交解析失败，请重试');
    }

    // 2. 轮询取结果
    const deadline = Date.now() + POLL_MAX_WAIT;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL);

      let res;
      try {
        res = await queryDouyinTask(task.taskId);
      } catch (e) {
        // 单次轮询失败（网络抖动）不打断整体流程，继续试
        console.warn('轮询失败，继续重试:', e?.message);
        continue;
      }

      const info = res?.data || {};

      if (info.status === 'done' && info.data) {
        videoInfo.value = info.data;
        uni.showToast({ title: '解析成功', icon: 'success' });
        return;
      }

      if (info.status === 'failed') {
        throw new Error(info.error || '解析失败');
      }
      // status === 'pending' -> 继续等
    }

    throw new Error('解析超时，请稍后重试');
  } catch (e) {
    console.error('解析失败:', e);
    uni.showToast({ title: e?.message || '解析失败', icon: 'none' });
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

// 预览图片 / 动图
//
// 动图不能走 uni.previewImage —— 那是纯图片查看器，动图会显示成一张静图。
// 动图改为打开全屏 video 播放器（activeLive），静图照旧走 previewImage。
const previewImage = (index) => {
  const item = imageItems.value[index];
  if (!item) return;

  if (item.live && item.videoUrl) {
    activeLive.value = {
      index,
      proxyUrl: getDouyinDownloadUrl(item.videoUrl),
      duration: item.duration,
    };
    return;
  }

  const urls = imageItems.value.filter((x) => !x.live).map((x) => x.thumb);
  const cur = urls.indexOf(item.thumb);
  uni.previewImage({
    urls,
    current: cur >= 0 ? cur : 0,
  });
};

const closeLivePlayer = () => {
  activeLive.value = null;
};

// 保存全部：静图存相册，动图存为视频
//
// 动图的 videoUrl 是视频直链，用 downloadFile + saveVideoToPhotosAlbum 落盘，
// 存下来是一个 ~500KB 的短视频，正好还原「动图」效果。
const saveAllImages = async () => {
  // 防抖：如果正在保存则直接返回
  if (saving.value) return;

  const items = imageItems.value;
  if (!items.length) {
    uni.showToast({ title: '没有可保存的内容', icon: 'none' });
    return;
  }

  saving.value = true;
  savingTotal.value = items.length;
  savingIndex.value = 0;
  let saved = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    savingIndex.value = i + 1;
    try {
      // 使用后端代理下载，解决防盗链问题
      const tempFilePath = await request.download(
        getDouyinDownloadUrl(item.live ? item.videoUrl : item.thumb)
      );

      await new Promise((resolve, reject) => {
        const onOk = () => {
          saved++;
          resolve();
        };
        const onFail = (err) => {
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
        };

        if (item.live) {
          uni.saveVideoToPhotosAlbum({
            filePath: tempFilePath,
            success: onOk,
            fail: onFail,
          });
        } else {
          uni.saveImageToPhotosAlbum({
            filePath: tempFilePath,
            success: onOk,
            fail: onFail,
          });
        }
      });
    } catch (e) {
      console.error('保存失败:', e);
    }
  }

  saving.value = false;
  savingIndex.value = 0;
  if (saved > 0) {
    uni.showToast({ title: `已保存${saved}项`, icon: 'success' });
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

/* 弹窗样式 */
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  width: 90%;
  max-width: 600rpx;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
}

.modal-title {
  font-size: 32rpx;
  font-weight: 500;
  color: #333;
  text-align: center;
  margin-bottom: 20rpx;
}

/* 指引弹窗 */
.guide-modal {
  max-width: 650rpx;
}

.modal-btns {
  display: flex;
  gap: 20rpx;
  margin-top: 30rpx;
}

.btn-cancel {
  flex: 1;
  background-color: #f0f0f0;
  color: #333;
  border: none;
  border-radius: 8rpx;
  padding: 20rpx;
  font-size: 28rpx;
}

.btn-confirm {
  flex: 1;
  background-color: #fe2c55;
  color: #fff;
  border: none;
  border-radius: 8rpx;
  padding: 20rpx;
  font-size: 28rpx;
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

/* 动图标记：左上角角标 + 中央播放按钮 */
.live-badge {
  position: absolute;
  top: 10rpx;
  left: 10rpx;
  background-color: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
}

.live-play {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.live-play-icon {
  width: 64rpx;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 26rpx;
  padding-left: 6rpx;
  box-sizing: border-box;
}

/* 动图全屏播放 */
.live-player-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.live-player-box {
  width: 90%;
  max-width: 660rpx;
}

.live-player {
  width: 100%;
  height: 880rpx;
  border-radius: 12rpx;
  background-color: #000;
}

.live-player-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24rpx;
}

.live-player-label {
  color: #ddd;
  font-size: 24rpx;
}

.live-player-close {
  color: #fff;
  font-size: 26rpx;
  padding: 8rpx 28rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.5);
  border-radius: 30rpx;
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
