const fs = require('fs/promises');
const path = require('path');

class CleanupService {
  constructor(pdfService, config = {}) {
    this.pdfService = pdfService;
    this.ttlMinutes = config.ttlMinutes || 30;
    this.intervalMinutes = config.intervalMinutes || 15;
    this.maxTotalSizeGB = config.maxTotalSizeGB || 10;
    this.enabled = config.enabled !== false;
    this.timer = null;
  }

  /**
   * 启动清理服务
   */
  start() {
    if (!this.enabled) {
      console.log('[Cleanup] Service disabled');
      return;
    }

    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => this.cleanup(), intervalMs);
    console.log(`[Cleanup] Service started, TTL=${this.ttlMinutes}min, interval=${this.intervalMinutes}min, max=${this.maxTotalSizeGB}GB`);

    // 启动时执行一次清理
    this.cleanup().catch(err => console.error('[Cleanup] Initial cleanup failed:', err.message));
  }

  /**
   * 停止清理服务
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Cleanup] Service stopped');
    }
  }

  /**
   * 执行清理
   */
  async cleanup() {
    try {
      console.log('[Cleanup] Starting cleanup...');
      const ttlDeleted = await this.cleanupByTTL();
      const capacityDeleted = await this.cleanupByCapacity();
      console.log(`[Cleanup] Completed: TTL deleted ${ttlDeleted}, capacity deleted ${capacityDeleted}`);
    } catch (error) {
      console.error('[Cleanup] Cleanup failed:', error.message);
    }
  }

  /**
   * 按TTL清理过期文件
   */
  async cleanupByTTL() {
    const now = Date.now();
    const ttlMs = this.ttlMinutes * 60 * 1000;
    let deletedCount = 0;

    for (const [filename, meta] of this.pdfService.fileRegistry) {
      if (now - meta.createdAt > ttlMs) {
        try {
          await this.pdfService.deleteFile(filename);
          deletedCount++;
        } catch (err) {
          console.error(`[Cleanup] Failed to delete ${filename}:`, err.message);
        }
      }
    }

    return deletedCount;
  }

  /**
   * 按容量清理文件
   */
  async cleanupByCapacity() {
    const maxTotalSize = this.maxTotalSizeGB * 1024 * 1024 * 1024;
    let totalSize = this.pdfService.getTotalSize();

    if (totalSize <= maxTotalSize) {
      return 0;
    }

    console.log(`[Cleanup] Capacity exceeded: ${this.formatSize(totalSize)} > ${this.maxTotalSizeGB}GB`);

    // 按创建时间排序，最旧的在前
    const files = Array.from(this.pdfService.fileRegistry.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    let deletedCount = 0;
    for (const [filename, meta] of files) {
      if (totalSize <= maxTotalSize) {
        break;
      }

      try {
        await this.pdfService.deleteFile(filename);
        totalSize -= meta.size;
        deletedCount++;
      } catch (err) {
        console.error(`[Cleanup] Failed to delete ${filename}:`, err.message);
      }
    }

    return deletedCount;
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
}

module.exports = CleanupService;
