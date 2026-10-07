// Brauzer (va keyinchalik desktop): fayl saqlash — blob havola orqali yuklab olish,
// tanlash — yashirin <input type="file">. capacitor-files.js bilan bir xil interfeys.

export async function saveAndShare(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Yuklab olish boshlanguncha URL tirik tursin.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { shared: true };
}

// Foydalanuvchi fayl tanlasa — { name, text }, bekor qilsa — null.
// accept — tanlash oynasidagi filtr. Android WebView'da filtr berilmaydi: Telegram/Drive'dan
// kelgan fayl ko'pincha application/octet-stream bo'ladi va filtr uni yashirib qo'yardi.
export function pickFile({ accept = '.json,application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    const done = () => input.remove();
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      done();
      if (!file) return resolve(null);
      try {
        resolve({ name: file.name, text: await file.text() });
      } catch (err) {
        reject(err);
      }
    });
    input.addEventListener('cancel', () => { done(); resolve(null); });
    document.body.append(input);
    input.click();
  });
}
