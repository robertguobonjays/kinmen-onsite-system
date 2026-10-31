// 附件由瀏覽器直接上傳到 Vercel Blob（不經過 Vercel 函式，才能傳超過 4.5MB 的檔案）
import { put } from '@vercel/blob/client';
window.blobPut = put;
