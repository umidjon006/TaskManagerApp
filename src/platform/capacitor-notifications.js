// Mahalliy eslatmalar (Android/iOS): @capacitor/local-notifications o'rami.
// Plaginni FAQAT shu fayl import qiladi. web-notifications.js bilan bir xil interfeys.
//
// Kanal: Android 8+ da ovoz kanalning xossasi va kanal yaratilgandan keyin koddan
// o'zgartirib bo'lmaydi — foydalanuvchi uni Android sozlamalarida tanlaydi
// (openChannelSettings). Shuning uchun `sound` berilmaydi: tizimning standart ovozi.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

// Android'dagi o'zimizning kichik plagin (MainActivity'da ro'yxatdan o'tgan): kanal sozlamalarini ochadi.
const NotificationSettings = registerPlugin('NotificationSettings');

const CHANNEL_ID = 'vazifalar';
const IMPORTANCE_HIGH = 4;
const isAndroid = () => Capacitor.getPlatform() === 'android';

// 'prompt-with-rationale' — Android "yana so'rash mumkin" holati; biz uchun bu ham 'prompt'.
function normalize(state) {
  if (state === 'granted' || state === 'denied') return state;
  return 'prompt';
}

async function exactAlarmState() {
  // iOS'da aniq budilnik tushunchasi yo'q — eslatmalar doim o'z vaqtida.
  if (!isAndroid()) return 'granted';
  const { exact_alarm: state } = await LocalNotifications.checkExactNotificationSetting();
  return normalize(state);
}

export async function isSupported() {
  return Capacitor.isNativePlatform();
}

export async function checkPermissions() {
  const { display } = await LocalNotifications.checkPermissions();
  return { notifications: normalize(display), exactAlarm: await exactAlarmState() };
}

// Faqat bildirishnoma ruxsati so'raladi. Aniq budilnik ruxsati alohida sozlamalar oynasi —
// uni foydalanuvchi o'zi ochadi (5c), bu yerda majburlab ochilmaydi.
export async function requestPermissions() {
  const { display } = await LocalNotifications.requestPermissions();
  return { notifications: normalize(display), exactAlarm: await exactAlarmState() };
}

export async function ensureChannel() {
  if (!isAndroid()) return;
  // createChannel mavjud kanalni qayta yaratmaydi: foydalanuvchi tanlagan ovoz saqlanib qoladi.
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Vazifalar',
    description: "Deadline va kunlik eslatmalar",
    importance: IMPORTANCE_HIGH,
    vibration: true,
  });
}

export async function cancelAll() {
  await LocalNotifications.cancelAll();
}

// items — core/schedule.js buildSchedule() natijasi (≤ 60 ta). id = massivdagi o'rni + 1.
export async function schedule(items) {
  if (!items.length) return;
  // isExactNotification standart true: ruxsat bo'lmasa plagin HAR schedule()'da tizim
  // sozlamalar oynasini ochadi. Ruxsat yo'q bo'lsa — jimgina noaniq budilnik.
  const exact = (await exactAlarmState()) === 'granted';
  await LocalNotifications.schedule({
    notifications: items.map((item, i) => ({
      id: i + 1,
      title: item.title,
      body: item.body,
      schedule: { at: new Date(item.at), allowWhileIdle: true },
      channelId: CHANNEL_ID,
      isExactNotification: exact,
      extra: { taskId: item.taskId, kind: item.kind },
    })),
  });
}

export async function pending() {
  const { notifications } = await LocalNotifications.getPending();
  return notifications;
}

export async function openChannelSettings() {
  if (!isAndroid()) return false;
  await ensureChannel(); // kanal yo'q bo'lsa, Android umumiy ilova sahifasini ochadi
  await NotificationSettings.openChannel({ channelId: CHANNEL_ID });
  return true;
}

// Ilovaning bildirishnoma sozlamalari (ruxsat butunlay rad etilganda — faqat shu yerdan yoqiladi).
export async function openNotificationSettings() {
  if (!isAndroid()) return false;
  await NotificationSettings.openChannel({});
  return true;
}

// "Signal va eslatmalar" (aniq budilnik) sozlamalari. Android 12 dan pastda — hech narsa ochmaydi.
export async function openExactAlarmSettings() {
  if (!isAndroid()) return false;
  await LocalNotifications.changeExactNotificationSetting();
  return true;
}
