const sharp = require('sharp');

// 创建分享图片
async function createShareImage() {
  const width = 500;
  const height = 400;

  // 创建SVG
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#07c160"/>
          <stop offset="100%" style="stop-color:#06ad56"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <text x="50%" y="40%" text-anchor="middle" fill="white" font-size="48" font-family="Arial, sans-serif" font-weight="bold">小程序工具箱</text>
      <text x="50%" y="55%" text-anchor="middle" fill="rgba(255,255,255,0.9)" font-size="24" font-family="Arial, sans-serif">视频去水印 · PDF转换</text>
      <text x="50%" y="70%" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="18" font-family="Arial, sans-serif">抖音去水印 | 快手去水印 | PDF转图片</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile('./src/static/share.png');

  console.log('分享图片已创建: src/static/share.png');
}

createShareImage().catch(console.error);
