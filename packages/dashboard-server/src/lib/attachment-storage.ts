import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AttachmentStorageSetup {
  attachmentsDir: string;
  uploadsDir: string;
  stopEviction: () => void;
}

/**
 * Prepare uploads/attachments directories and start periodic attachment eviction.
 */
export function initializeAttachmentStorage(dataDir: string): AttachmentStorageSetup {
  const attachmentsDir = path.join(os.homedir(), '.relay', 'attachments');
  if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }

  const uploadsDir = path.join(dataDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

  const evictOldAttachments = async () => {
    try {
      const files = await fs.promises.readdir(attachmentsDir);
      const now = Date.now();
      let evictedCount = 0;

      for (const file of files) {
        const filePath = path.join(attachmentsDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
            await fs.promises.unlink(filePath);
            evictedCount++;
          }
        } catch {
          // Ignore per-file errors (deleted concurrently, permission changes, etc).
        }
      }

      if (evictedCount > 0) {
        console.log(`[dashboard] Evicted ${evictedCount} old attachment(s)`);
      }
    } catch (err) {
      console.error('[dashboard] Failed to evict old attachments:', err);
    }
  };

  void evictOldAttachments();
  const evictionInterval = setInterval(() => {
    void evictOldAttachments();
  }, 60 * 60 * 1000);

  return {
    attachmentsDir,
    uploadsDir,
    stopEviction: () => clearInterval(evictionInterval),
  };
}
