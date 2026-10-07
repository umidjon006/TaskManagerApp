// Release APK: web build → cap sync → gradle assembleRelease. Oxirida APK yo'li va hajmi.
//   npm run release:android
// Imzo android/keystore.properties dan (namuna — keystore.properties.example). Parol hech qayerga yozilmaydi.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');
const APK = join(ANDROID, 'app/build/outputs/apk/release/app-release.apk');

function run(cmd, args, cwd = ROOT) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\n✖ To'xtadi: ${cmd} ${args.join(' ')} (kod ${r.status ?? r.signal})`);
    process.exit(r.status || 1);
  }
}

// Web build'dan oldin tez tekshiruv — Gradle ham tekshiradi, lekin bir daqiqa keyin.
if (!existsSync(join(ANDROID, 'keystore.properties'))) {
  console.error("✖ android/keystore.properties yo'q.\n  cp android/keystore.properties.example android/keystore.properties\nva parollarni to'ldiring (fayl commit qilinmaydi).");
  process.exit(1);
}

run('npm', ['run', 'build']);
run('npx', ['cap', 'sync', 'android']);
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleRelease'], ANDROID);

if (!existsSync(APK)) {
  console.error(`\n✖ Build tugadi, lekin APK topilmadi: ${relative(ROOT, APK)}`);
  process.exit(1);
}
const mb = (statSync(APK).size / 1024 / 1024).toFixed(2);
console.log(`\n✔ Release APK: ${relative(ROOT, APK)} (${mb} MB)`);
