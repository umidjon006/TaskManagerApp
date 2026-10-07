// Tabiiy ilova (Android/iOS): zaxira faylini kesh papkasiga yozib, tizimning "Ulashish" oynasini ochadi —
// foydalanuvchi Telegram, Drive, email va h.k. ni o'zi tanlaydi. web-files.js bilan bir xil interfeys.
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { pickFile as pickWithInput } from './web-files.js';

export async function saveAndShare(filename, text) {
  // Kesh — vaqtinchalik joy: Android uni o'zi tozalashi mumkin, Auto Backup'ga ham tushmaydi.
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Zaxira nusxani yuborish' });
  } catch (err) {
    // Foydalanuvchi ulashish oynasini yopdi — xato emas.
    if (/cancel/i.test(err?.message || '')) return { shared: false };
    throw err;
  }
  return { shared: true };
}

// Capacitor WebView <input type="file"> ni tizim fayl tanlash oynasiga ulaydi (BridgeWebChromeClient) —
// alohida plagin kerak emas. Filtr yo'q: kontent baribir parseBackup'da tekshiriladi.
export function pickFile() {
  return pickWithInput({ accept: '' });
}
