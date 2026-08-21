const path = require('path');
const fs = require('fs/promises');
const { fromBuffer } = require('pdf2pic');

class PdfService {
  constructor() {
    this.uploadDir = './uploads';
    this.fileRegistry = new Map(); // 文件元数据: filename -> { createdAt, size }
    this.maxTotalSizeGB = 10;      // 最大存储容量 10GB
  }

  /**
   * 获取当前总存储大小
   */
  getTotalSize() {
    let total = 0;
    for (const meta of this.fileRegistry.values()) {
      total += meta.size;
    }
    return total;
  }

  /**
   * 检查容量是否充足
   * @param {number} additionalSize 需要额外存储的大小
   * @returns {boolean} 是否有足够空间
   */
  checkCapacity(additionalSize = 0) {
    const maxTotalSize = this.maxTotalSizeGB * 1024 * 1024 * 1024;
    const currentSize = this.getTotalSize();
    return currentSize + additionalSize <= maxTotalSize;
  }

  /**
   * 注册文件到元数据表
   */
  registerFile(filename, size) {
    this.fileRegistry.set(filename, {
      createdAt: Date.now(),
      size,
    });
    console.log(`[PDF] Registered: ${filename}, size: ${this.formatSize(size)}`);
  }

  /**
   * 删除文件
   */
  async deleteFile(filename) {
    const filepath = path.join(this.uploadDir, filename);
    try {
      await fs.unlink(filepath);
      this.fileRegistry.delete(filename);
      console.log(`[PDF] Deleted: ${filename}`);
    } catch (err) {
      // 文件可能已不存在，从注册表中移除
      this.fileRegistry.delete(filename);
      throw err;
    }
  }

  /**
   * 格式化文件大小
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
  }

  async convertPdfToImages(file, dto) {
    const width = dto.width || 1224; // 默认宽度 1224px (约 2x 缩放)

    try {
      console.log(`[PDF] Converting PDF: ${file.originalname}, size: ${file.size}`);

      // 检查存储容量
      if (!this.checkCapacity()) {
        const err = new Error('服务空间不足，请30分钟后再试');
        err.status = 507;
        throw err;
      }

      await fs.mkdir(this.uploadDir, { recursive: true });

      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 8);

      // 配置 pdf2pic
      const convert = fromBuffer(file.buffer, {
        density: 150,           // DPI，影响清晰度
        saveFilename: `img${timestamp}${randomStr}`,
        savePath: this.uploadDir,
        format: 'png',
        width: width,
        height: undefined,      // 自动计算高度
        preserveAspectRatio: true,
      });

      // 转换所有页面
      const results = await convert.bulk(-1, { responseType: 'buffer' });

      const imageUrls = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const pageNum = i + 1;
        const filename = `img${timestamp}${randomStr}p${pageNum}.png`;
        const filepath = path.join(this.uploadDir, filename);

        // pdf2pic 返回的是 buffer，需要保存到文件
        if (result.buffer) {
          await fs.writeFile(filepath, result.buffer);
          const fileSize = result.buffer.length;

          // 注册文件到元数据表
          this.registerFile(filename, fileSize);

          imageUrls.push(`/pdf/image/${filename}`);
        }
      }

      console.log(`[PDF] Converted ${results.length} pages, total size: ${this.formatSize(this.getTotalSize())}`);

      return {
        images: imageUrls,
        pageCount: results.length,
      };
    } catch (error) {
      console.error(`[PDF] PDF conversion failed: ${error.message}`);
      // 如果是容量错误，直接抛出
      if (error.status === 507) {
        throw error;
      }
      const err = new Error('PDF转换失败，请检查文件是否有效');
      err.status = 400;
      throw err;
    }
  }

  async getImage(filename) {
    const filepath = path.join(this.uploadDir, filename);
    try {
      return await fs.readFile(filepath);
    } catch {
      const err = new Error('图片不存在');
      err.status = 404;
      throw err;
    }
  }
}

module.exports = new PdfService();
