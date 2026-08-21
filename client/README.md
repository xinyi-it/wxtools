# wxtools-client

小程序工具箱前端，基于 UniApp (Vue 3) 构建，支持微信小程序和 H5 平台。

## 技术栈

- **框架**: UniApp (Vue 3 + Vite)
- **UI**: 原生组件
- **编译目标**: 微信小程序、H5

## 目录结构

```
client/
├── index.html                  # H5入口
├── src/
│   ├── pages/
│   │   ├── index/              # 首页
│   │   │   └── index.vue
│   │   ├── douyin/             # 抖音功能页
│   │   │   └── douyin.vue
│   │   ├── kuaishou/           # 快手功能页
│   │   │   └── kuaishou.vue
│   │   └── pdf/                # PDF功能页
│   │       └── pdf.vue
│   │
│   ├── static/                 # 静态资源
│   │   └── share.png           # 分享图片
│   │
│   ├── App.vue                 # 应用入口
│   ├── main.js                 # 主入口
│   ├── pages.json              # 页面配置
│   └── manifest.json           # 应用配置
│
└── package.json
```

## 启动命令

```bash
# 微信小程序开发模式
npm run dev:mp-weixin

# 微信小程序构建
npm run build:mp-weixin

# H5开发模式
npm run dev:h5

# H5构建
npm run build:h5
```

## 配置说明

### API 地址配置

在各页面中修改 `API_BASE` 常量：

```javascript
const API_BASE = 'http://localhost:3000/api';
// 生产环境改为实际服务器地址
// const API_BASE = 'https://api.example.com/api';
```

### 页面配置 (pages.json)

```json
{
  "pages": [
    {
      "path": "pages/index/index",
      "style": {
        "navigationBarTitleText": "工具箱"
      }
    }
  ],
  "globalStyle": {
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "工具箱",
    "navigationBarBackgroundColor": "#ffffff",
    "backgroundColor": "#f5f5f5"
  }
}
```

## 页面开发

### 页面模板

```vue
<template>
  <view class="container">
    <!-- 页面内容 -->
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';

const API_BASE = 'http://localhost:3000/api';

// 响应式数据
const loading = ref(false);
const data = ref(null);

// 分享配置
onShareAppMessage(() => ({
  title: '分享标题',
  path: '/pages/xxx/xxx',
  imageUrl: '/static/share.png'
}));

onShareTimeline(() => ({
  title: '分享标题',
  imageUrl: '/static/share.png'
}));

// 生命周期
onMounted(() => {
  // 初始化
});
</script>

<style scoped>
.container {
  padding: 20rpx;
}
</style>
```

### 条件编译

支持平台特定代码：

```vue
<script setup>
// #ifdef MP-WEIXIN
// 微信小程序专用代码
uni.chooseMessageFile({
  count: 1,
  type: 'file'
});
// #endif

// #ifndef MP-WEIXIN
// 非微信小程序代码（H5等）
const input = document.createElement('input');
// #endif
</script>
```

### 平台标识

| 标识 | 平台 |
|------|------|
| `MP-WEIXIN` | 微信小程序 |
| `H5` | H5网页 |
| `APP-PLUS` | App |

## 功能页面说明

### 首页 (index)

- 从后端 API 动态获取菜单列表
- 只显示 `visible: true` 的菜单项
- 点击菜单项跳转到对应功能页面

### 抖音去水印 (douyin)

1. 粘贴抖音分享链接
2. 调用解析 API 获取视频信息
3. 预览视频并支持下载

### 快手去水印 (kuaishou)

1. 粘贴快手分享链接
2. 调用解析 API 获取视频信息
3. 预览视频并支持下载

### PDF转图片 (pdf)

1. 选择 PDF 文件（小程序从聊天记录选择，H5 使用文件选择器）
2. 上传并转换为图片
3. 预览和保存图片

## 常见问题

### 1. 微信小程序请求失败

确保在小程序管理后台配置合法域名：
- `request合法域名`: 后端API地址
- `downloadFile合法域名`: 视频下载地址

### 2. H5跨域问题

后端已配置 CORS，允许跨域请求。

### 3. 视频播放问题

视频通过后端代理下载，解决防盗链问题。播放时使用代理地址：
```javascript
const proxyUrl = `${API_BASE}/xxx/download?url=${encodeURIComponent(videoUrl)}`;
```

### 4. PDF文件选择

- **微信小程序**: 使用 `uni.chooseMessageFile` 从聊天记录选择
- **H5**: 使用 `document.createElement('input')` 创建文件选择器

## 发布

### 微信小程序

1. 修改 `manifest.json` 中的 `appid`
2. 运行 `npm run build:mp-weixin`
3. 使用微信开发者工具上传代码

### H5

1. 修改 API 地址为生产环境地址
2. 运行 `npm run build:h5`
3. 部署 `dist/build/h5` 目录到服务器
